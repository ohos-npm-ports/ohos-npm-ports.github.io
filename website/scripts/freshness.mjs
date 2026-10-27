import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listOrgPackages } from "./sync.mjs";

const siteUrl = process.env.SITE_URL ?? "https://ohos-npm-ports.github.io";

async function fetchSnapshot() {
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/data.json`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`snapshot returned ${response.status}`);
  return response.json();
}

async function fetchLatest(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${name}: registry returned ${response.status}`);
  return (await response.json())["dist-tags"]?.latest ?? null;
}

export async function checkFreshness({
  fetchSnapshot: loadSnapshot = fetchSnapshot,
  fetchOrg = listOrgPackages,
  fetchLatest: loadLatest = fetchLatest,
} = {}) {
  try {
    const snapshot = new Map((await loadSnapshot()).packages.map((p) => [p.name, p.version]));
    const names = await fetchOrg();
    const missing = names.filter((name) => !snapshot.has(name));
    if (missing.length) return { stale: true, reason: `not in snapshot: ${missing.join(", ")}` };
    const changed = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < names.length) {
          const name = names[next++];
          const latest = await loadLatest(name);
          if (latest !== snapshot.get(name))
            changed.push(`${name.split("/")[1]}: ${snapshot.get(name)} -> ${latest}`);
        }
      }),
    );
    if (changed.length)
      return { stale: true, reason: `latest changed: ${changed.sort().join(", ")}` };
    return { stale: false, reason: "up to date" };
  } catch (error) {
    return { stale: true, reason: `check failed: ${error.message}` };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { stale, reason } = await checkFreshness();
  console.log(`stale=${stale} (${reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `stale=${stale}\n`);
}
