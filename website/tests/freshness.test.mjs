import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { checkFreshness } from "../scripts/freshness.mjs";

const snapshot = {
  packages: [
    { name: "@ohos-npm-ports/a", version: "1.0.0-1" },
    { name: "@ohos-npm-ports/b", version: "2.0.0-1" },
  ],
};
const latest = { "@ohos-npm-ports/a": "1.0.0-1", "@ohos-npm-ports/b": "2.0.0-1" };
const deps = (overrides = {}) => ({
  fetchSnapshot: async () => snapshot,
  fetchOrg: async () => Object.keys(latest),
  fetchLatest: async (name) => latest[name] ?? "0.0.1-1",
  ...overrides,
});

test("an identical snapshot is fresh", async () => {
  assert.deepEqual(await checkFreshness(deps()), { stale: false, reason: "up to date" });
});
test("a package missing from the snapshot makes it stale", async () => {
  const result = await checkFreshness(
    deps({ fetchOrg: async () => [...Object.keys(latest), "@ohos-npm-ports/c"] }),
  );
  assert.equal(result.stale, true);
  assert.match(result.reason, /@ohos-npm-ports\/c/);
});
test("a changed latest version makes it stale", async () => {
  const result = await checkFreshness(
    deps({ fetchLatest: async (name) => (name.endsWith("/b") ? "2.0.0-2" : latest[name]) }),
  );
  assert.equal(result.stale, true);
  assert.match(result.reason, /b: 2\.0\.0-1 -> 2\.0\.0-2/);
});
test("a failing check reports stale instead of throwing", async () => {
  const result = await checkFreshness(
    deps({
      fetchOrg: async () => {
        throw new Error("org unavailable");
      },
    }),
  );
  assert.equal(result.stale, true);
  assert.match(result.reason, /org unavailable/);
});
