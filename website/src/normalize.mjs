import { enrichPackage } from "./catalog.mjs";
function runtimeOf(manifest) {
  return (
    Object.entries(manifest?.engines || {})
      .filter(([name, value]) => ["node", "bun"].includes(name) && typeof value === "string")
      .map(([name, value]) => `${name === "node" ? "Node" : "Bun"} ${value}`)
      .join(" / ") || null
  );
}
function cpuOf(manifest) {
  return Array.isArray(manifest?.cpu)
    ? manifest.cpu.filter((v) => typeof v === "string").join(" / ") || null
    : null;
}
export function normalizePackage(metadata, source = {}) {
  const version = metadata["dist-tags"]?.latest ?? null;
  const current = metadata.versions?.[version] ?? {};
  const deprecated = current.deprecated || null;
  const retained = Object.fromEntries(
    [
      "kind",
      "keywords",
      "notes",
      "verification",
      "sources",
      "entry",
      "installPolicy",
      "nativeSupport",
      "runtime",
      "architecture",
    ]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  return enrichPackage({
    ...retained,
    name: metadata.name,
    shortName: metadata.name.replace("@ohos-npm-ports/", ""),
    upstream: source.upstream ?? null,
    directories: source.directories ?? [],
    description:
      current.description || metadata.description || source.description || "暂无包描述。",
    version,
    runtime: runtimeOf(current) || (version === source.version ? (source.runtime ?? null) : null),
    architecture:
      cpuOf(current) || (version === source.version ? (source.architecture ?? null) : null),
    deprecated,
    status: deprecated ? "deprecated" : version ? "active" : "untagged",
    license: typeof current.license === "string" ? current.license : (source.license ?? null),
    publishedAt:
      metadata.time?.[version] ??
      (version === source.version ? (source.publishedAt ?? null) : null),
    versions: Object.keys(metadata.versions ?? {})
      .map((v) => ({
        version: v,
        runtime:
          runtimeOf(metadata.versions[v]) ||
          source.versions?.find((item) => item.version === v)?.runtime ||
          null,
        architecture:
          cpuOf(metadata.versions[v]) ||
          source.versions?.find((item) => item.version === v)?.architecture ||
          null,
        publishedAt:
          metadata.time?.[v] ||
          source.versions?.find((item) => item.version === v)?.publishedAt ||
          null,
        tags: Object.keys(metadata["dist-tags"] ?? {}).filter(
          (t) => metadata["dist-tags"][t] === v,
        ),
        deprecated: metadata.versions[v].deprecated || null,
      }))
      .reverse(),
  });
}
