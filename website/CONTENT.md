# 包信息维护

`src/package-info.json` 是网站的人工维护资料，不改变 ports 构建或 npm 发布。

- `kind`：仅供内部安装判断使用。platform（平台槽位）默认不进入普通列表，搜索和直达链接仍可找到；已确认的特殊包使用 manual 安装策略。页面不展示维护分类标签。
- `keywords`：中文用途及同义检索词，一个包可有多个用途。以源码、包描述为依据，不等于兼容承诺；不维护单选用途分类。
- `entry`：平台槽位的完整入口包名。必须有 loader / optionalDependencies 来源，不能只按名字猜；没有确认关系就不填。
- `sources`：资料来源，使用固定 commit 的源码链接，或 npm 包页面。更新资料时复核来源仍支持相关表述。
- `notes`：`text`、`url`、可选的精确 `version`。版本特有的限制必须带版本，避免误套到其他发布。
- `verification`：每项必须带精确 `version`、`environment`（设备/系统/运行时）、`date`、`result` 和公开 HTTPS 证据 `url`。只展示与所选版本对应的记录；发布成功、CI 脚本存在或网站测试成功均不能充当真机通过。
- `runtime`、`architecture`：没有资料时不要填写，前端显示“未记录”。
- `nativeSupport`：`text` 和官方来源 `url`；只有核实上游原生支持及迁回方式后才填写。
- `installPolicy: manual`：必须专门接线的辅助包不生成通用 alias。

新发现包不自动推断上游别名、入口关联或验证结果。实时版本刷新保留人工资料。npm 元数据中 latest 未废弃只代表发布状态。

## 安装配置依据

- npm / Bun 的间接依赖使用根 `package.json` 的 overrides：
  [npm 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides)、[Bun 文档](https://bun.sh/docs/pm/overrides)。
- pnpm 的 overrides 写在根 `pnpm-workspace.yaml`：
  [pnpm 文档](https://pnpm.io/settings#overrides)。
- overrides 用于间接依赖；直接依赖使用 alias 命令或 dependencies 配置，不生成会触发 npm EOVERRIDE 的混合配置。

## 静态页面和缓存

构建插件以同一包数据、安装生成器输出首页和 `packages/<shortName>/index.html`，无 JavaScript 可读。启用 JavaScript 后由 Vue 增强为交互目录。兼容旧 `?package=` 链接；版本、包管理器、接入方式、搜索和发布状态保存在查询参数。旧 kind/category 参数忽略，不应用隐藏筛选；新生成的链接会移除它们。

交互详情和静态详情仅围绕配置和复制，保留废弃、平台安装提醒和有证据的已知限制。配置相同则共用展示：dependencies 对三个包管理器只生成一份；overrides 的 npm/bun 共用 JSON，pnpm 使用 YAML；alias 按命令分别展示。页签中的 bun 一律小写。复制操作放在代码框右上角，分享操作放在 npm/上游链接旁，不设底部主按钮区。

目录中的移植包在发布前签名，消费说明不再要求额外安装 ohos-signpost 或添加 postinstall。网站工程自身开发依赖的 postinstall 不受影响。

旧 dependency=direct/indirect 分享链接分别映射为 mode=alias/overrides；新链接只保存 mode。

`SITE_ORIGIN` 可覆盖 canonical 来源，默认按 `GITHUB_REPOSITORY` 的 owner 生成 GitHub Pages 域名；路径由现有 `pagesBase` 统一决定。构建同时产生 sitemap 和 robots。

registry 的 compact/full 响应分开缓存五分钟，复用进行中请求；存储失败不影响访问，手动刷新跳过已完成的缓存。包查询全局最多四并发，详情排队优先；新包发现失败不清空目录。

## 验证

`pnpm run check && pnpm test && pnpm run sync-data && pnpm run build && pnpm run test:e2e`

CI 分别验证域名根路径、仓库子路径；浏览器覆盖桌面/手机、分享与历史导航、缓存、失败恢复及禁用 JavaScript。页面测试不代表对包逐一真机验收。
