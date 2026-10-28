import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vite-plus/test";
const app = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
test("copy belongs to the code frame and sharing belongs to the source links", () => {
  const frame = app.slice(
    app.indexOf('<div class="code-frame">'),
    app.indexOf('<p v-if="code" class="dialog-note">'),
  );
  assert.ok(frame.includes('id="copy-detail"'));
  assert.ok(frame.includes('id="install-code"'));
  assert.ok(!frame.includes("button primary"));
  const links = app.slice(
    app.indexOf('<div id="detail-links"'),
    app.indexOf('<p class="warning" v-for="item in notes"'),
  );
  assert.ok(links.includes('id="share-detail"'));
  assert.ok(links.includes('aria-label="复制分享链接"'));
});
