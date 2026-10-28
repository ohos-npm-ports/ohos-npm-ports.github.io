import { normalizePackage } from "./normalize.mjs";

export async function fetchPackage(source, { full = false, fetcher = fetch } = {}) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(source.name)}`, {
    headers: { Accept: full ? "application/json" : "application/vnd.npm.install-v1+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.name !== source.name) throw new Error("Registry name mismatch");
  return {
    ...normalizePackage(metadata, source),
    ...(source.discovered && { discovered: true }),
    checkedAt: new Date().toISOString(),
  };
}

const scope = "@ohos-npm-ports/";
export const fallbackMaintainers = ["hqzing"];

export function catalogMaintainers(data) {
  return Array.isArray(data.maintainers) && data.maintainers.length
    ? data.maintainers
    : fallbackMaintainers;
}

export async function discoverPackages(
  known,
  {
    fetcher = fetch,
    maintainers: names = fallbackMaintainers,
    query = fetchPackage,
    force = false,
  } = {},
) {
  const knownNames = new Set(known.map((p) => p.name));
  const candidates = new Set();
  let failed = 0;
  let truncated = false;
  await Promise.all(
    names.map(async (maintainer) => {
      try {
        const response = await fetcher(
          `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(`maintainer:${maintainer}`)}&size=250`,
          { cache: "no-store", signal: AbortSignal.timeout(10000) },
        );
        if (!response.ok) throw new Error(`Registry HTTP ${response.status}`);
        const { objects, total } = await response.json();
        if (total > objects.length) truncated = true;
        for (const { package: pkg } of objects) {
          if (
            pkg.name.startsWith(scope) &&
            !knownNames.has(pkg.name) &&
            !pkg.version?.startsWith("0.0.0")
          )
            candidates.add(pkg.name);
        }
      } catch {
        failed++;
      }
    }),
  );
  const packages = [];
  const report = await refreshCatalog(
    [...candidates].map((name) => ({ name, discovered: true })),
    (_, pkg) => {
      if (pkg.version && !pkg.version.startsWith("0.0.0")) packages.push(pkg);
    },
    { fetcher, query, force },
  );
  return { packages, failed: failed + report.failed, truncated };
}

export async function refreshCatalog(packages, update, options = {}) {
  let next = 0;
  let failed = 0;
  let completed = 0;
  const query = options.query ?? fetchPackage;
  const order = packages
    .map((_, index) => index)
    .sort(
      (a, b) =>
        Number(options.priority?.includes(packages[b].name)) -
        Number(options.priority?.includes(packages[a].name)),
    );
  await Promise.all(
    Array.from({ length: Math.min(4, packages.length) }, async () => {
      while (next < packages.length) {
        const index = order[next++];
        try {
          update(index, await query(packages[index], options));
        } catch {
          failed++;
        } finally {
          options.progress?.(++completed, packages.length);
        }
      }
    }),
  );
  return { failed };
}

export function createRegistryClient({ fetcher = fetch, now = Date.now, storage } = {}) {
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }
  const memory = new Map(),
    pending = new Map(),
    queue = [];
  let active = 0;
  function schedule(task, priority) {
    return new Promise((resolve, reject) => {
      const job = () => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < 4) job();
      else if (priority) queue.unshift(job);
      else queue.push(job);
    });
  }
  return {
    invalidate(name) {
      for (const mode of ["full", "compact"]) {
        const key = `ohos-npm-registry-v1:${mode}:${name}`;
        memory.delete(key);
        try {
          storage?.removeItem(key);
        } catch {
          /* optional storage */
        }
      }
    },
    async fetchPackage(source, { full = false, force = false } = {}) {
      const key = `ohos-npm-registry-v1:${full ? "full" : "compact"}:${source.name}`;
      const merge = (result) => ({
        ...source,
        ...result,
        upstream: source.upstream ?? result.upstream,
        directories: source.directories ?? result.directories,
      });
      if (pending.has(key)) return merge(await pending.get(key));
      let cached = memory.get(key);
      if (!cached) {
        try {
          cached = JSON.parse(storage?.getItem(key) || "null");
        } catch {
          /* storage is optional */
        }
      }
      if (
        !force &&
        cached &&
        Number.isFinite(cached.time) &&
        now() >= cached.time &&
        now() - cached.time < 300000 &&
        cached.value?.name === source.name &&
        Array.isArray(cached.value.versions) &&
        cached.value.checkedAt
      )
        return merge(cached.value);
      const request = schedule(() => fetchPackage(source, { full, fetcher }), full);
      pending.set(key, request);
      try {
        const value = await request;
        const entry = { time: now(), value };
        memory.set(key, entry);
        try {
          storage?.setItem(key, JSON.stringify(entry));
        } catch {
          /* quota or privacy mode */
        }
        return merge(value);
      } finally {
        pending.delete(key);
      }
    },
  };
}
