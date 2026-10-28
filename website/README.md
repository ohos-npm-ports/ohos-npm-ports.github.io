# 包目录网站

Vue Vapor + Vite+ 静态站，保留原有响应式版型、深浅主题、搜索筛选和版本详情。不引入 Router、Pinia 或 UI 组件库。

## 开发与验证

需要 Node.js 24。已安装全局 Vite+ 时，在 `website/` 内执行：

```sh
vp install
vp run sync-data
vp dev
vp check
vp test
vp build
vp preview
```

没有全局 vp 时先安装 package.json 指定的 pnpm，执行 `pnpm install --frozen-lockfile`，之后使用同名 scripts（例如 `pnpm run dev`）。`build` 执行 Vite 构建，并从同一份快照输出可无 JavaScript 阅读的首页、逐包页面、元信息和 sitemap；首次开发与刷新数据时先运行 `sync-data`。数据写入忽略跟踪的 `public/data.json`；不提交生成物。

浏览器测试使用同一份构建结果：

```sh
pnpm exec playwright install --with-deps chromium
pnpm run test:e2e
```

Linux 上已有 Chromium 时，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` 运行浏览器测试；CI 默认使用 Playwright 下载的浏览器。

## 源码

- `src/App.vue`：交互版面、详情弹窗、历史导航、主题与复制。
- `src/catalog.mjs` / `src/package-info.json`：共享的接入配置、搜索、URL 状态与有来源的包资料。
- `src/registry.mjs`：实时查询、请求复用、缓存和新包发现。
- `scripts/sync.mjs`：从仓库发现候选包，查询 npm 并生成数据快照。
- `scripts/static-pages.mjs` / `vite.config.mjs`：静态内容生成、Vue Vapor 编译与 Vite+ 测试配置。

不做排序控件或分页，所有匹配包直接展示。默认隐藏通常自动安装的平台子包，搜索和详情直达仍可找到它们。不提供包类型或用途下拉框，普通包不展示维护分类标签；中文用途通过可多值的关键词检索。

搜索与发布状态同步到 URL；旧 kind/category 参数不再应用。旧 `?package=包名` 链接继续可用，分享链接可携带精确版本、包管理器和接入方式。目录内打开详情可用返回键关闭，前进键恢复选择；独立页面位于 `packages/<shortName>/`。无需 Router。

接入配置支持 npm、pnpm 和 Bun。pnpm 的间接依赖配置写入 `pnpm-workspace.yaml`，npm/Bun 写入 `package.json`；平台子包优先指向经源码确认的入口，不自动生成业务安装命令。详情只呈现名称、版本、接入配置与复制操作。接入方式为 npm alias / dependencies / overrides：alias 显示 npm/pnpm/bun 页签，dependencies 共用一份配置，overrides 合并 npm/bun、单独展示 pnpm。重要安装警告仍直接显示。资料字段、证据标准及配置来源见 [CONTENT.md](CONTENT.md)。

组件全部使用 `<script setup vapor>`，入口使用 `createVaporApp`，不是普通 Vue Virtual DOM 应用。Vue 与编译器通过 lockfile 对齐并锁定 RC；升级时必须重跑浏览器验证。

## 鸿蒙与跨平台

上游 Vite+ 尚未发布 openharmony 平台包，因此使用完整、保留其他平台产物的 `@ohos-npm-ports/vite-plus`。相关 yuku、lightningcss 和 tsgolint 通过 overrides 使用社区 port；Vite/Vitest 与工具链版本对齐。Rolldown 的原生 openharmony binding 以 optionalDependency 补充，不影响其他平台安装；`ohos-signpost` postinstall 处理本机原生模块签名。所有平台使用同一份依赖与 lockfile。

## 实时查询

浏览器先加载快照，再从 registry.npmjs.org 更新版本与废弃状态。包元数据查询全局最多四并发，优先处理当前详情及可见包；精简和完整响应分开缓存五分钟，复用进行中请求，存储不可用时照常查询。手动刷新跳过已有缓存并清理详情缓存。详情打开时读取完整元数据；异步响应不会重置用户选择的版本，也不会覆盖已经切换或关闭的详情。失败的包保留原有数据，页面显示失败数量并可重试；详情也单独提示失败。npm 的 latest 未废弃不等于通过设备验证。

构建时结合源码候选和 npm 组织清单生成快照；浏览器还按快照中的维护者发现新发布的 scope 包，并逐包核对 registry、标记“新发现（未进快照）”。发现失败或搜索截断时会提示，不删除现有目录，也不猜测新包的上游映射。快照、查询及发布时间分别标注。首次开发先将源码仓库克隆到本仓库的 `.sources/`，或设置 `PORTS_ROOT` 指向其 `ports/` 目录，再执行 `sync-data`。

## 数据与部署

版本与废弃状态来自官方 npm registry，不猜测稳定性、发布来源或设备兼容性。仅收录仓库相关且 registry 确认存在的候选包；不是整个 scope 的历史归档。无法确认上游包名时，不生成猜测的 alias。网络错误重试后终止同步，不发布不完整快照。

GitHub Pages 的来源须设为 **GitHub Actions**。Website CI 仅在 Linux 执行安装、检查、测试、同步数据、构建与桌面/手机浏览器验证；PR 仅上传页面和截图，本仓库 main 更新、每日定时和手动触发可部署。构建时另行 checkout 源码仓库的 ports 目录生成快照。构建根据 `GITHUB_REPOSITORY` 自动选择 Pages 路径：`<owner>/<owner>.github.io` 使用 `/`，普通仓库使用 `/<repository>/`，本地开发缺省为 `/`。自定义域名或手工预览可用 `PAGES_BASE_PATH=/`（或其他带首尾斜杠的路径）覆盖；构建与浏览器测试必须使用相同值。CI 先验证根路径，再重新构建并验证当前仓库路径；仅上传最后这份与部署地址匹配的产物。不修改 port 或 npm 发布流程。
