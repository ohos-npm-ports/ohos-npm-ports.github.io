import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import { generateStatic } from "./scripts/static-pages.mjs";
import { resolve } from "node:path";
import { pagesBase } from "./scripts/pages-base.mjs";

export default defineConfig({
  base: pagesBase(process.env.GITHUB_REPOSITORY, process.env.PAGES_BASE_PATH),
  plugins: [
    vue(),
    {
      name: "catalog-static-pages",
      apply: "build",
      async closeBundle() {
        const owner = process.env.GITHUB_REPOSITORY?.split("/")[0] || "ohos-npm-ports";
        await generateStatic({
          outDir: resolve(import.meta.dirname, "dist"),
          base: pagesBase(process.env.GITHUB_REPOSITORY, process.env.PAGES_BASE_PATH),
          siteOrigin: process.env.SITE_ORIGIN || `https://${owner}.github.io`,
        });
      },
    },
  ],
  test: { include: ["tests/*.test.mjs"], pool: "threads" },
});
