import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  catalogMaintainers,
  discoverPackages,
  fallbackMaintainers,
  fetchPackage,
  refreshCatalog,
} from "../src/registry.mjs";
const pkg = {
  name: "@ohos-npm-ports/example",
  upstream: "example",
  directories: ["ports/example/1"],
  version: "1",
  versions: [],
};
test("live query bypasses cache and uses compact metadata for the catalog", async () => {
  const result = await fetchPackage(pkg, {
    fetcher: async (url, options) => {
      assert.equal(new URL(url).hostname, "registry.npmjs.org");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.Accept, "application/vnd.npm.install-v1+json");
      return {
        ok: true,
        json: async () => ({
          name: pkg.name,
          "dist-tags": { latest: "2" },
          versions: { 2: { deprecated: "Use upstream" } },
        }),
      };
    },
  });
  assert.equal(result.version, "2");
  assert.equal(result.status, "deprecated");
  assert.equal(result.upstream, "example");
});
test("failed queries preserve snapshot and bound request concurrency", async () => {
  let active = 0,
    maximum = 0;
  const results = [];
  const report = await refreshCatalog(
    Array.from({ length: 9 }, () => pkg),
    (index, value) => results.push([index, value]),
    {
      fetcher: async () => {
        active++;
        maximum = Math.max(active, maximum);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        throw Error("offline");
      },
    },
  );
  assert.equal(maximum, 4);
  assert.equal(report.failed, 9);
  assert.equal(results.length, 0);
});
test("mismatched metadata and missing packages do not erase a snapshot", async () => {
  await assert.rejects(
    fetchPackage(pkg, {
      fetcher: async () => ({ ok: true, json: async () => ({ name: "other" }) }),
    }),
  );
  await assert.rejects(fetchPackage(pkg, { fetcher: async () => ({ ok: false, status: 404 }) }));
});
test("detail requests ask for full metadata", async () => {
  await fetchPackage(pkg, {
    full: true,
    fetcher: async (_, options) => {
      assert.equal(options.headers.Accept, "application/json");
      return { ok: true, json: async () => ({ name: pkg.name }) };
    },
  });
});

test("compact responses preserve repository descriptions and do not retain stale deprecation", async () => {
  const source = {
    ...pkg,
    description: "Useful tool",
    license: "MIT",
    deprecated: "Old warning",
    status: "deprecated",
  };
  const current = await fetchPackage(source, {
    fetcher: async () => ({
      ok: true,
      json: async () => ({ name: pkg.name, "dist-tags": { latest: "2" }, versions: { 2: {} } }),
    }),
  });
  assert.equal(current.description, "Useful tool");
  assert.equal(current.license, "MIT");
  assert.equal(current.deprecated, null);
  assert.equal(current.status, "active");
});

const search = (objects, total = objects.length) => ({
  ok: true,
  json: async () => ({
    total,
    objects: objects.map(([name, version]) => ({ package: { name, version } })),
  }),
});
const packument = (name, latest) => ({
  ok: true,
  json: async () => ({
    name,
    description: "Fresh port",
    "dist-tags": latest ? { latest } : {},
    versions: latest ? { [latest]: {} } : { "0.0.0-stage": {} },
  }),
});

test("discovery keeps only new scoped packages with a real latest and marks them", async () => {
  const urls = [];
  const result = await discoverPackages([pkg], {
    fetcher: async (url, options) => {
      urls.push(url);
      if (new URL(url).pathname === "/-/v1/search") {
        assert.equal(new URL(url).searchParams.get("text"), "maintainer:hqzing");
        assert.equal(options.cache, "no-store");
        return search([
          [pkg.name, "1"],
          ["@ohos-npm-ports/fresh", "1.0.0-1"],
          ["@ohos-npm-ports/staged", "0.0.0-stage"],
          ["@ohos-npm-ports/untagged", "3.0.0-1"],
          ["ohos-signpost", "1.1.2"],
          ["@other/tool", "1.0.0"],
        ]);
      }
      if (url.endsWith("fresh")) return packument("@ohos-npm-ports/fresh", "1.0.0-1");
      if (url.endsWith("untagged")) return packument("@ohos-npm-ports/untagged", null);
      throw Error(`unexpected ${url}`);
    },
  });
  assert.deepEqual(
    result.packages.map((p) => [p.name, p.version, p.discovered, p.status]),
    [["@ohos-npm-ports/fresh", "1.0.0-1", true, "active"]],
  );
  assert.equal(result.failed, 0);
  assert.equal(result.truncated, false);
  assert.equal(
    urls.some((u) => u.includes("staged") || u.includes("signpost")),
    false,
  );
  assert.equal(
    urls.some((u) => u.endsWith(encodeURIComponent(pkg.name))),
    false,
  );
});

test("discovery failures never throw and report truncation", async () => {
  const offline = await discoverPackages([], {
    fetcher: async () => {
      throw Error("offline");
    },
  });
  assert.deepEqual(offline, { packages: [], failed: 1, truncated: false });
  const limited = await discoverPackages([], {
    fetcher: async () => search([["@ohos-npm-ports/a", "0.0.0-stage"]], 300),
  });
  assert.equal(limited.truncated, true);
  const blocked = await discoverPackages([], { fetcher: async () => ({ ok: false, status: 429 }) });
  assert.equal(blocked.failed, 1);
});

test("a discovered package stays marked after a later live refresh", async () => {
  const current = await fetchPackage(
    { name: "@ohos-npm-ports/fresh", discovered: true },
    { fetcher: async () => packument("@ohos-npm-ports/fresh", "2.0.0-1") },
  );
  assert.equal(current.discovered, true);
  assert.equal(current.version, "2.0.0-1");
  const snapshot = await fetchPackage(pkg, {
    fetcher: async () => packument(pkg.name, "2"),
  });
  assert.equal("discovered" in snapshot, false);
});

test("discovery searches every maintainer given and deduplicates their packages", async () => {
  const searched = [];
  const hit = (name) => ({ package: { name, version: "1.0.0-1" } });
  const found = await discoverPackages([], {
    maintainers: ["amy", "zed"],
    fetcher: async (url) => {
      const text = decodeURIComponent(new URL(url).searchParams.get("text") ?? "");
      if (text.startsWith("maintainer:")) {
        searched.push(text);
        return {
          ok: true,
          json: async () => ({
            total: 2,
            objects: [hit("@ohos-npm-ports/shared"), hit(`@ohos-npm-ports/${text.slice(11)}-only`)],
          }),
        };
      }
      const name = decodeURIComponent(new URL(url).pathname.slice(1));
      return {
        ok: true,
        json: async () => ({
          name,
          "dist-tags": { latest: "1.0.0-1" },
          versions: { "1.0.0-1": {} },
        }),
      };
    },
  });
  assert.deepEqual(searched.sort(), ["maintainer:amy", "maintainer:zed"]);
  assert.deepEqual(found.packages.map((p) => p.name).sort(), [
    "@ohos-npm-ports/amy-only",
    "@ohos-npm-ports/shared",
    "@ohos-npm-ports/zed-only",
  ]);
});
test("the built-in maintainer list only applies when the snapshot has none", () => {
  assert.deepEqual(fallbackMaintainers, ["hqzing"]);
  assert.deepEqual(catalogMaintainers({ maintainers: ["amy"] }), ["amy"]);
  assert.deepEqual(catalogMaintainers({}), ["hqzing"]);
  assert.deepEqual(catalogMaintainers({ maintainers: [] }), ["hqzing"]);
});

test("cache reuses fresh responses, expires, deduplicates and separates full metadata", async () => {
  const { createRegistryClient } = await import("../src/registry.mjs");
  let calls = 0,
    now = 1000;
  const fetcher = async () => {
    calls++;
    return packument(pkg.name, "2");
  };
  const client = createRegistryClient({ fetcher, now: () => now, storage: null });
  await Promise.all([client.fetchPackage(pkg), client.fetchPackage(pkg)]);
  assert.equal(calls, 1);
  await client.fetchPackage(pkg);
  assert.equal(calls, 1);
  await client.fetchPackage(pkg, { full: true });
  assert.equal(calls, 2);
  now += 300001;
  await client.fetchPackage(pkg);
  assert.equal(calls, 3);
  await client.fetchPackage(pkg, { force: true });
  assert.equal(calls, 4);
});
test("corrupt or inaccessible persistent cache never blocks network requests", async () => {
  const { createRegistryClient } = await import("../src/registry.mjs");
  for (const storage of [
    {
      getItem: () => "{broken",
      setItem: () => {
        throw Error("quota");
      },
    },
    {
      getItem: () => {
        throw Error("denied");
      },
    },
  ]) {
    const client = createRegistryClient({ storage, fetcher: async () => packument(pkg.name, "2") });
    assert.equal((await client.fetchPackage(pkg)).version, "2");
  }
});

test("manual catalog invalidation also removes full detail cache", async () => {
  const { createRegistryClient } = await import("../src/registry.mjs");
  const saved = new Map();
  let calls = 0;
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  const client = createRegistryClient({
    storage,
    fetcher: async () => {
      calls++;
      return packument(pkg.name, "2");
    },
  });
  await client.fetchPackage(pkg, { full: true });
  client.invalidate(pkg.name);
  await client.fetchPackage(pkg, { full: true });
  assert.equal(calls, 2);
  assert.equal(saved.size, 1);
});
