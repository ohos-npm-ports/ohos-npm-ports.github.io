import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncData, discoverSources } from "../scripts/sync.mjs";
test("source discovery keeps scoped upstream names and platform packages separate", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-sources-"));
  try {
    await mkdir(join(root, "original-tool/1.0.0/patchs"), { recursive: true });
    await writeFile(
      join(root, "original-tool/1.0.0/patchs/0001.patch"),
      '-  "name": "@original/tool",\n+  "name": "@ohos-npm-ports/original-tool",\n+ "@ohos-npm-ports/original-tool-openharmony-arm64": "1.0.0-1"',
    );
    await mkdir(join(root, "aaa-consumer/1.0.0"), { recursive: true });
    await writeFile(
      join(root, "aaa-consumer/1.0.0/build.sh"),
      "npm install @ohos-npm-ports/original-tool",
    );
    const sources = await discoverSources(root);
    assert.equal(sources.get("@ohos-npm-ports/original-tool").upstream, "@original/tool");
    assert.equal(sources.get("@ohos-npm-ports/original-tool-openharmony-arm64").upstream, null);
    assert.deepEqual(sources.get("@ohos-npm-ports/original-tool").directories, [
      "ports/original-tool/1.0.0",
      "ports/aaa-consumer/1.0.0",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("source discovery reads upstream names from NPMBUILD in the bucketed layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-sources-"));
  try {
    await mkdir(join(root, "s/sqlite3"), { recursive: true });
    await writeFile(
      join(root, "s/sqlite3/NPMBUILD"),
      '#!/usr/bin/env bash\npkgname="sqlite3"\nupstream="sqlite3"\nversion="5.1.7"\n',
    );
    await mkdir(join(root, "d/datadog-pprof"), { recursive: true });
    await writeFile(
      join(root, "d/datadog-pprof/NPMBUILD"),
      'pkgname="datadog-pprof"\nupstream="@datadog/pprof"\n',
    );
    await mkdir(join(root, "l/lightningcss@1.32"), { recursive: true });
    await writeFile(
      join(root, "l/lightningcss@1.32/NPMBUILD"),
      'pkgname="lightningcss"\nupstream="lightningcss"\n',
    );
    await mkdir(join(root, "l/lightningcss"), { recursive: true });
    await writeFile(
      join(root, "l/lightningcss/NPMBUILD"),
      'pkgname="lightningcss"\nupstream="lightningcss"\n',
    );
    const sources = await discoverSources(root);
    assert.equal(sources.get("@ohos-npm-ports/sqlite3").upstream, "sqlite3");
    assert.equal(sources.get("@ohos-npm-ports/datadog-pprof").upstream, "@datadog/pprof");
    assert.deepEqual(sources.get("@ohos-npm-ports/sqlite3").directories, ["ports/s/sqlite3"]);
    assert.deepEqual(sources.get("@ohos-npm-ports/lightningcss").directories, [
      "ports/l/lightningcss",
      "ports/l/lightningcss@1.32",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("data sync emits only confirmed published metadata", async () => {
  const output = await mkdtemp(join(tmpdir(), "catalog-build-"));
  try {
    await syncData({
      output,
      portsRoot: new URL("../fixtures/ports", import.meta.url).pathname,
      fetchOrg: async () => [],
      fetchMetadata: async (name) =>
        name.endsWith("/bufferutil")
          ? {
              name,
              "dist-tags": { latest: "4.0.9-7" },
              versions: { "4.0.9-7": {} },
            }
          : null,
    });
    const data = JSON.parse(await readFile(join(output, "data.json"), "utf8"));
    assert.equal(data.packages.length, 1);
    assert.equal(data.packages[0].name, "@ohos-npm-ports/bufferutil");
    assert.deepEqual(await readdir(output), ["data.json"]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
test("registry failures stop deployment rather than silently dropping packages", async () => {
  await assert.rejects(
    syncData({
      portsRoot: new URL("../fixtures/ports", import.meta.url).pathname,
      fetchOrg: async () => [],
      fetchMetadata: async () => {
        throw new Error("registry unavailable");
      },
    }),
    /registry unavailable/,
  );
});

const published = (name, maintainers) => ({
  name,
  maintainers: maintainers.map((n) => ({ name: n })),
  "dist-tags": { latest: "1.0.0-1" },
  versions: { "1.0.0-1": {} },
});
test("org listing adds packages outside ports/ and records the maintainers", async () => {
  const output = await mkdtemp(join(tmpdir(), "catalog-build-"));
  try {
    await syncData({
      output,
      portsRoot: new URL("../fixtures/ports", import.meta.url).pathname,
      fetchOrg: async () => [
        "@ohos-npm-ports/bufferutil",
        "@ohos-npm-ports/pnpm-openharmony-arm64",
      ],
      fetchMetadata: async (name) =>
        published(name, name.endsWith("/bufferutil") ? ["zed", "hqzing"] : ["hqzing", "amy"]),
    });
    const data = JSON.parse(await readFile(join(output, "data.json"), "utf8"));
    assert.deepEqual(
      data.packages.map((p) => p.name),
      ["@ohos-npm-ports/bufferutil", "@ohos-npm-ports/pnpm-openharmony-arm64"],
    );
    const extra = data.packages[1];
    assert.equal(extra.upstream, null);
    assert.deepEqual(extra.directories, []);
    assert.deepEqual(data.maintainers, ["amy", "hqzing", "zed"]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
test("org listing failure falls back to ports/ and does not fail the build", async () => {
  const output = await mkdtemp(join(tmpdir(), "catalog-build-"));
  try {
    await syncData({
      output,
      portsRoot: new URL("../fixtures/ports", import.meta.url).pathname,
      fetchOrg: async () => {
        throw new Error("org unavailable");
      },
      fetchMetadata: async (name) =>
        name.endsWith("/bufferutil") ? published(name, ["hqzing"]) : null,
    });
    const data = JSON.parse(await readFile(join(output, "data.json"), "utf8"));
    assert.equal(data.packages.length, 1);
    assert.deepEqual(data.maintainers, ["hqzing"]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
