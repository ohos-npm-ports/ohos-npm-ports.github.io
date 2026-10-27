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
export const maintainers = ["hqzing"];

export async function discoverPackages(
  known,
  { fetcher = fetch, maintainers: names = maintainers } = {},
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
    { fetcher },
  );
  return { packages, failed: failed + report.failed, truncated };
}

export async function refreshCatalog(packages, update, options = {}) {
  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, packages.length) }, async () => {
      while (next < packages.length) {
        const index = next++;
        try {
          update(index, await fetchPackage(packages[index], options));
        } catch {
          failed++;
        }
      }
    }),
  );
  return { failed };
}
