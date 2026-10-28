<script setup vapor>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  catalogMaintainers,
  discoverPackages,
  createRegistryClient,
  refreshCatalog,
} from "./registry.mjs";
import {
  enrichPackage,
  installGuide,
  installModes,
  managerGroups,
  searchPackages,
  readRoute,
  routeUrl,
  statusLabels,
} from "./catalog.mjs";
const registry = createRegistryClient();
const base = new URL(import.meta.env.BASE_URL, location.origin).href;
const initial = readRoute(location.href);
const packages = ref([]),
  refreshing = ref(false),
  liveMessage = ref(""),
  detailMessage = ref("");
const loading = ref(true),
  error = ref(false),
  ready = ref(false),
  generatedAt = ref("");
const maintainers = ref(catalogMaintainers({})),
  selected = ref(null),
  toast = ref(""),
  dialog = ref(null);
const query = ref(initial.query),
  status = ref(initial.status);
const version = ref(initial.version),
  manager = ref(initial.manager),
  mode = ref(initial.mode);
const menuOpen = ref(false);
let ignoredCloseEvents = 0;
let detailRequest = 0,
  timer,
  versionChanged = false,
  routing = false;
const labels = statusLabels;
const activeCount = computed(() => packages.value.filter((p) => p.status === "active").length);
const versionsCount = computed(() => packages.value.reduce((sum, p) => sum + p.versions.length, 0));
const filtered = computed(() =>
  searchPackages(packages.value, {
    query: query.value,
    status: status.value,
  }),
);
const guide = computed(() =>
  selected.value
    ? installGuide(selected.value, {
        manager: manager.value,
        mode: mode.value,
        version: version.value,
      })
    : {},
);
const groups = computed(() => managerGroups(mode.value));
const activeManager = computed(
  () => groups.value.find((group) => group.members.includes(manager.value))?.key,
);
function moveTab(event, keys, active, prefix) {
  let index = keys.indexOf(active);
  if (event.key === "ArrowRight") index = (index + 1) % keys.length;
  else if (event.key === "ArrowLeft") index = (index + keys.length - 1) % keys.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = keys.length - 1;
  else return;
  event.preventDefault();
  if (prefix === "mode-tab-") mode.value = keys[index];
  else manager.value = keys[index];
  void nextTick(() => document.getElementById(prefix + keys[index])?.focus());
}
function modeKeydown(event) {
  moveTab(event, Object.keys(installModes), mode.value, "mode-tab-");
}
function managerKeydown(event) {
  moveTab(
    event,
    groups.value.map((group) => group.key),
    activeManager.value,
    "manager-tab-",
  );
}
const code = computed(() => guide.value.code);
const deprecated = computed(
  () => selected.value?.versions.find((v) => v.version === version.value)?.deprecated,
);
const notes = computed(() =>
  (selected.value?.notes || []).filter((n) => !n.version || n.version === version.value),
);
const theme = ref(initialTheme());
const favicon = computed(
  () => `${import.meta.env.BASE_URL}favicon${theme.value === "dark" ? "-dark" : ""}.svg`,
);
function initialTheme() {
  try {
    const saved = localStorage.getItem("theme");
    return ["light", "dark"].includes(saved)
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  } catch {
    return "light";
  }
}
watch(
  theme,
  (value) => {
    document.body.dataset.theme = value;
    document.querySelector('link[rel="icon"]').href = favicon.value;
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* optional storage */
    }
  },
  { immediate: true },
);
function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}
function routeState(pkg = selected.value) {
  return {
    query: query.value,
    status: status.value,
    package: pkg?.name || "",
    version: pkg ? version.value : "",
    manager: manager.value,
    mode: mode.value,
  };
}
function syncUrl() {
  if (ready.value && !routing)
    history.replaceState(history.state, "", routeUrl(routeState(), base));
}
watch([query, status, version, manager, mode], syncUrl);
function packageUrl(pkg) {
  return routeUrl({ ...routeState(pkg), version: version.value }, base).href;
}
function staticUrl(pkg) {
  return `${base}packages/${encodeURIComponent(pkg.shortName)}/`;
}
function scrollToCatalog() {
  document.getElementById("catalog").scrollIntoView();
}
function clear() {
  query.value = "";
  status.value = "all";
}
async function refresh(force = false) {
  if (refreshing.value) return;
  if (force) for (const pkg of packages.value) registry.invalidate(pkg.name);
  refreshing.value = true;
  liveMessage.value = "正在查询 npm registry…";
  const visible = [...document.querySelectorAll(".package-row")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    })
    .map((el) => el.dataset.name);
  try {
    const [result, found] = await Promise.all([
      refreshCatalog(
        [...packages.value],
        (index, pkg) => {
          packages.value[index] = enrichPackage(pkg);
        },
        {
          query: registry.fetchPackage,
          force,
          priority: [selected.value?.name, ...visible],
          progress: (done, total) => {
            liveMessage.value = `正在查询 npm registry… ${done} / ${total}`;
          },
        },
      ),
      discoverPackages(packages.value, {
        maintainers: maintainers.value,
        query: registry.fetchPackage,
        force,
      }),
    ]);
    const known = new Set(packages.value.map((p) => p.name));
    packages.value.push(...found.packages.filter((p) => !known.has(p.name)).map(enrichPackage));
    const messages = [];
    if (found.packages.length) messages.push(`发现 ${found.packages.length} 个未进快照的新包`);
    if (found.failed) messages.push("新包发现未完整完成");
    if (found.truncated) messages.push("搜索结果已截断");
    liveMessage.value =
      (result.failed
        ? `${result.failed} 个包实时查询失败，保留原有数据；其余已更新。`
        : "全部包已实时查询（五分钟内复用缓存）") +
      (messages.length ? ` · ${messages.join("；")}` : "");
  } catch {
    liveMessage.value = "查询失败，保留已有目录，可稍后重试。";
  } finally {
    refreshing.value = false;
  }
}
async function load() {
  loading.value = true;
  error.value = false;
  try {
    const response = await fetch(`${base}data.json`, {
      signal: AbortSignal.timeout(15000),
      cache: "no-cache",
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.packages)) throw Error("Invalid catalog");
    packages.value = data.packages.map(enrichPackage);
    generatedAt.value = data.generatedAt;
    maintainers.value = catalogMaintainers(data);
    ready.value = true;
    loading.value = false;
    const pkg = packages.value.find(
      (p) => p.name === initial.package || p.shortName === initial.package,
    );
    if (pkg) {
      const opening = openDetail(pkg, { navigation: false, route: initial });
      void refresh();
      await opening;
    } else {
      await refresh();
      if (initial.package) {
        const found = packages.value.find(
          (p) => p.name === initial.package || p.shortName === initial.package,
        );
        if (found) await openDetail(found, { navigation: false, route: initial });
        else toast.value = "未找到该包，请在目录中搜索其他包。";
      }
    }
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
async function openDetail(pkg, { navigation = true, route } = {}) {
  if (!pkg) return;
  const request = ++detailRequest;
  routing = true;
  versionChanged = !!route?.version;
  detailMessage.value = "正在查询完整版本信息…";
  if (navigation)
    history.replaceState(
      { ...history.state, scrollY: window.scrollY, focus: pkg.shortName },
      "",
      location.href,
    );
  selected.value = pkg;
  version.value = route?.version || pkg.version || pkg.versions[0]?.version || "";
  manager.value = route?.manager || manager.value;
  mode.value = route?.mode || mode.value;
  await nextTick();
  if (!dialog.value.open) dialog.value.showModal();
  if (navigation) history.pushState({ catalogModal: true }, "", routeUrl(routeState(), base));
  routing = false;
  try {
    const current = enrichPackage(await registry.fetchPackage(pkg, { full: true }));
    if (request !== detailRequest) return;
    selected.value = current;
    if (!versionChanged) version.value = current.version || current.versions[0]?.version || "";
    detailMessage.value = `npm 实时查询 · ${new Date(current.checkedAt).toLocaleString("zh-CN")}（五分钟缓存）`;
  } catch {
    if (request === detailRequest) detailMessage.value = "实时查询失败，当前显示原有版本信息。";
  }
}
function openEntry(event, name) {
  const pkg = packages.value.find((p) => p.name === name);
  if (pkg) {
    event.preventDefault();
    void openDetail(pkg);
  }
}
function closeDialog() {
  if (dialog.value.open) {
    ignoredCloseEvents++;
    dialog.value.close();
  }
}
function onDialogClosed() {
  if (ignoredCloseEvents > 0) {
    ignoredCloseEvents--;
    return;
  }
  closeDetail();
}
function closeDetail() {
  if (!selected.value) return;
  if (history.state?.catalogModal) {
    history.back();
    return;
  }
  detailRequest++;
  selected.value = null;
  closeDialog();
  history.replaceState(null, "", routeUrl(routeState(null), base));
}
async function restoreRoute() {
  const state = readRoute(location.href);
  routing = true;
  query.value = state.query;
  status.value = state.status;
  manager.value = state.manager;
  mode.value = state.mode;
  await nextTick();
  const pkg = packages.value.find((p) => p.name === state.package || p.shortName === state.package);
  if (pkg) await openDetail(pkg, { navigation: false, route: state });
  else {
    detailRequest++;
    selected.value = null;
    closeDialog();
    await nextTick();
    if (history.state?.focus)
      [...document.querySelectorAll(".package-name")]
        .find((el) => el.textContent.trim() === history.state.focus)
        ?.focus({ preventScroll: true });
    window.scrollTo(0, history.state?.scrollY ?? 0);
  }
  routing = false;
}
async function copy(text) {
  clearTimeout(timer);
  try {
    if (!text) throw Error("No command");
    await navigator.clipboard.writeText(text);
    toast.value = "已复制到剪贴板";
  } catch {
    toast.value = "无法写入剪贴板，请在包详情中选中并复制命令。";
  }
  timer = setTimeout(() => {
    toast.value = "";
  }, 3500);
}
onMounted(() => {
  window.addEventListener("popstate", restoreRoute);
  void load();
});
onUnmounted(() => {
  clearTimeout(timer);
  window.removeEventListener("popstate", restoreRoute);
});
</script>

<template>
  <a class="skip" href="#catalog">跳到包目录</a>
  <header class="header">
    <div class="shell nav">
      <a class="brand" :href="base" aria-label="ohos-npm-ports 首页"
        ><img :src="favicon" width="34" height="34" alt="" /><span
          >ohos<span class="brand-light"> / </span>npm-ports</span
        ></a
      >
      <button
        class="mobile-menu icon-button"
        aria-label="展开导航"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        ☰
      </button>
      <nav aria-label="主导航" :class="{ expanded: menuOpen }">
        <a class="nav-current" href="#catalog">包目录</a
        ><a
          href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/user/usage.md"
          >使用指南 ↗</a
        ><a href="https://github.com/ohos-npm-ports/ohos-npm-ports">GitHub ↗</a
        ><button
          id="theme"
          @click="toggleTheme"
          class="icon-button"
          aria-label="切换深浅主题"
          title="切换深浅主题"
        >
          ◐
        </button>
      </nav>
    </div>
  </header>
  <main class="shell">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="dot"></span> OPEN SOURCE · OPENHARMONY</div>
        <h1 id="hero-title">
          熟悉的 npm 包，<br />也能在<span class="highlight">鸿蒙上运行。</span>
        </h1>
        <p class="hero-description">
          查找社区移植包，确认版本，复制接入配置。<br />让你的下一个项目，从这里开始。
        </p>
        <form class="hero-search" @submit.prevent="scrollToCatalog()">
          <label for="hero-search">先找找项目需要的包</label
          ><input
            id="hero-search"
            type="search"
            v-model="query"
            placeholder="包名或用途，如 sqlite3、数据库"
          /><button class="button primary" type="submit">搜索目录 ↓</button>
        </form>
        <div class="hero-actions">
          <a class="button primary" href="#catalog">探索包目录 <span>↓</span></a
          ><a
            class="text-link"
            href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/contributor/contributing.md"
            >参与移植 <span>↗</span></a
          >
        </div>
        <div class="hero-note">优先使用上游原生支持；社区 port 是过渡方案。</div>
      </div>
      <div class="terminal" aria-label="通过 npm alias 保持原有导入名的接入示例">
        <div class="terminal-bar">
          <span class="terminal-dots"><i></i><i></i><i></i></span><span>~/your-next-project</span
          ><span>⌘</span>
        </div>
        <div class="terminal-content">
          <div class="terminal-comment"># 保留原来的 import，换上适配后的包</div>
          <div class="terminal-command">
            <span>❯</span> npm install \<br /><span class="terminal-indent"
              >sqlite3@npm:@ohos-npm-ports/sqlite3</span
            >
          </div>
          <div class="terminal-divider"></div>
          <div class="terminal-comment">// package.json</div>
          <pre v-pre><span class="code-muted">{</span>
  <span class="code-key">"dependencies"</span>: {
    <span class="code-key">"sqlite3"</span>: <span class="code-value">"npm:@ohos-npm-ports/sqlite3"</span>
  }
<span class="code-muted">}</span></pre>
          <div class="terminal-foot"><span class="dot"></span> 一个别名，连接你的开发环境。</div>
        </div>
      </div>
    </section>
    <section class="stats" aria-label="包目录统计">
      <div>
        <strong id="total-count">{{ ready ? packages.length : "—" }}</strong
        ><span>已发布的包</span>
      </div>
      <div>
        <strong id="active-count">{{ ready ? activeCount : "—" }}</strong
        ><span>latest 未废弃</span>
      </div>
      <div>
        <strong id="versions-count">{{ ready ? versionsCount : "—" }}</strong
        ><span>已发布的版本</span>
      </div>
      <p>
        <span class="dot"></span> 包清单快照（版本会实时刷新）<br /><time
          id="updated"
          :datetime="generatedAt"
          >{{
            generatedAt
              ? new Date(generatedAt).toLocaleString("zh-CN", { hour12: false }) + " 更新"
              : "正在读取更新信息"
          }}</time
        >
      </p>
    </section>

    <div class="live-status" role="status">
      <p>{{ liveMessage }}</p>
      <button class="button" :disabled="refreshing || !ready" @click="refresh(true)">
        刷新 npm 数据
      </button>
    </div>
    <section class="catalog-section" id="catalog" aria-labelledby="catalog-title">
      <div class="section-heading">
        <div class="eyebrow">THE PACKAGE DIRECTORY</div>
        <div class="heading-line">
          <h2 id="catalog-title">找到你需要的工具。</h2>
          <a href="https://www.npmjs.com/org/ohos-npm-ports">在 npm 上查看 ↗</a>
        </div>
      </div>
      <div class="catalog-layout">
        <aside class="sidebar">
          <h3>发布状态</h3>
          <div id="filters" class="filters" role="group" aria-label="按发布状态筛选">
            <button
              v-for="(label, value) in labels"
              :key="value"
              :data-status="value"
              :aria-pressed="status === value"
              @click="status = value"
            >
              {{ label }}
              <span :id="'filter-' + value">{{
                value === "all"
                  ? packages.length
                  : packages.filter((p) => p.status === value).length
              }}</span>
            </button>
          </div>
          <div class="sidebar-note">
            <span class="note-icon">↗</span>
            <h3>把适配带回上游</h3>
            <p>上游已支持 OpenHarmony？请优先使用官方包，减少额外的维护。</p>
            <a
              href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/contributor/porting-guide.md"
              >了解移植原则 →</a
            >
          </div>
        </aside>
        <div class="catalog-main">
          <div class="toolbar">
            <label class="search"
              ><span aria-hidden="true">⌕</span
              ><input
                id="search"
                v-model="query"
                type="search"
                placeholder="搜索包名、上游包或中文用途…"
                aria-label="搜索包"
            /></label>
          </div>
          <div class="results-meta">
            <p id="result-count" role="status">
              {{
                loading
                  ? "正在加载包目录…"
                  : error
                    ? "目录加载失败"
                    : `找到 ${filtered.length} 个包 / 共 ${packages.length} 个`
              }}
            </p>
            <span>点击包名，查看接入方式</span>
          </div>
          <div class="list-head" aria-hidden="true">
            <span>包 / PACKAGE</span><span>LATEST</span><span>操作</span>
          </div>
          <div id="packages" class="packages" :aria-busy="loading" :hidden="error">
            <div v-if="loading" class="empty">正在读取 npm 数据快照…</div>
            <div v-else-if="!filtered.length" class="empty">
              <h3>没有找到匹配的包</h3>
              <p>目录未收录不代表无法在鸿蒙运行。试试包名、中文用途，或清除筛选。</p>
              <p>
                <a
                  href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/contributor/porting-guide.md"
                  >先检查上游原生支持 ↗</a
                >
                ·
                <a href="https://github.com/ohos-npm-ports/ohos-npm-ports/issues/new"
                  >提交移植需求 ↗</a
                >
              </p>
              <button class="button" @click="clear">清除搜索与筛选</button>
            </div>
            <template v-else>
              <article
                v-for="pkg in filtered"
                :key="pkg.name"
                class="package-row"
                :data-name="pkg.name"
              >
                <div class="package-main">
                  <div class="package-icon" aria-hidden="true">
                    {{ pkg.shortName.replace(/[^a-z]/gi, "").slice(0, 2) }}
                  </div>
                  <div class="package-info">
                    <button
                      class="package-name"
                      :aria-label="`查看 ${pkg.shortName} 包详情`"
                      @click="openDetail(pkg)"
                    >
                      {{ pkg.shortName }}
                    </button>
                    <p class="package-description">{{ pkg.description }}</p>
                    <p class="upstream">{{ pkg.upstream ? `↳ ${pkg.upstream}` : pkg.name }}</p>
                    <a class="static-link" :href="staticUrl(pkg)">独立详情页 ↗</a>
                    <p v-if="pkg.discovered" class="discovered-badge">新发现（未进快照）</p>
                    <p class="upstream">
                      {{
                        pkg.checkedAt
                          ? `npm 查询：${new Date(pkg.checkedAt).toLocaleString("zh-CN", { hour12: false })}`
                          : "快照数据 · 尚未实时确认"
                      }}
                    </p>
                  </div>
                </div>
                <div class="package-version">
                  {{ pkg.version || "—" }}<br /><span :class="['status-badge', pkg.status]"
                    ><span class="dot"></span>{{ labels[pkg.status] }}</span
                  >
                </div>
                <button
                  class="copy-row"
                  :aria-label="`复制 ${pkg.shortName} 安装命令`"
                  title="复制安装命令"
                  :disabled="!installGuide(pkg).code"
                  @click="copy(installGuide(pkg).code)"
                >
                  ⧉
                </button>
              </article>
            </template>
          </div>
          <div id="error" class="error" :hidden="!error">
            <h3>暂时无法加载包目录</h3>
            <p>请检查网络后重试，或前往 npm 查看包信息。</p>
            <button class="button" id="retry" @click="load">重新加载</button>
          </div>
        </div>
      </div>
    </section>

    <section class="getting-started" aria-labelledby="start-title">
      <div>
        <span class="eyebrow">A SMALL CHANGE. A NEW PLATFORM.</span>
        <h2 id="start-title">第一次使用社区移植包？</h2>
        <p>
          直接依赖用 npm alias，间接依赖用 overrides。<br />安装成功之后，还需要在目标设备验证加载与运行。
        </p>
      </div>
      <a
        class="button"
        href="https://github.com/ohos-npm-ports/ohos-npm-ports/blob/main/docs/zh-CN/user/usage.md"
        >阅读接入指南 ↗</a
      >
    </section>
    <div class="compat-note">
      <span>i</span>
      <p>
        “latest 未废弃”仅表示 npm
        发布状态，不代表真机验收通过。请以具体包说明和目标设备运行结果为准。
      </p>
    </div>
  </main>
  <footer class="shell footer">
    <a class="brand" :href="base"
      ><img :src="favicon" width="24" height="24" alt="" /><span
        >ohos<span class="brand-light"> / </span>npm-ports</span
      ></a
    ><span>为 OpenHarmony 生态贡献一块拼图。</span
    ><a href="https://github.com/ohos-npm-ports/ohos-npm-ports">源码与贡献 ↗</a>
  </footer>

  <dialog
    ref="dialog"
    id="detail"
    aria-labelledby="detail-title"
    @close="onDialogClosed"
    @cancel.prevent="closeDetail"
  >
    <template v-if="selected">
      <div class="dialog-head">
        <h2 id="detail-title">{{ selected.shortName }}</h2>
        <button id="close-detail" class="icon-button" aria-label="关闭包详情" @click="closeDetail">
          ×
        </button>
      </div>
      <p id="detail-description">{{ selected.description }}</p>
      <p id="detail-warning" class="warning" :hidden="!deprecated">
        该版本已废弃：{{ deprecated }}
      </p>
      <div id="detail-links" class="detail-links">
        <a :href="`https://www.npmjs.com/package/${selected.name}`">npm 包 ↗</a>
        <a v-if="selected.upstream" :href="`https://www.npmjs.com/package/${selected.upstream}`"
          >上游包 ↗</a
        >
        <button
          id="share-detail"
          class="quiet-share"
          type="button"
          aria-label="复制分享链接"
          title="复制分享链接"
          @click="copy(packageUrl(selected))"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"
            />
          </svg>
          分享
        </button>
      </div>
      <p class="warning" v-for="item in notes" :key="item.url">
        {{ item.text }} <a :href="item.url">来源 ↗</a>
      </p>
      <div class="version-control">
        <label for="version">发布版本</label
        ><select id="version" v-model="version" @change="versionChanged = true">
          <option
            v-if="version && !selected.versions.some((v) => v.version === version)"
            :value="version"
          >
            {{ version }} · 当前数据未找到
          </option>
          <option v-for="v in selected.versions" :key="v.version" :value="v.version">
            {{ v.version }}{{ v.tags.length ? ` · ${v.tags.join(", ")}` : ""
            }}{{ v.deprecated ? " · 已废弃" : "" }}
          </option>
        </select>
      </div>

      <p v-if="selected.kind === 'platform'" class="warning">
        平台子包通常由入口包自动安装，不需要直接加入业务依赖。
        <a
          v-if="selected.entry"
          :href="routeUrl({ package: selected.entry }, base).href"
          @click="openEntry($event, selected.entry)"
          >查看对应入口包 → {{ selected.entry }}</a
        >
      </p>

      <div
        id="install-modes"
        class="install-tabs mode-tabs"
        role="tablist"
        aria-label="接入方式"
        @keydown="modeKeydown"
      >
        <button
          v-for="(label, value) in installModes"
          :key="value"
          :id="'mode-tab-' + value"
          type="button"
          role="tab"
          :aria-selected="mode === value"
          :tabindex="mode === value ? 0 : -1"
          aria-controls="install-panel"
          @click="mode = value"
        >
          {{ label }}
        </button>
      </div>
      <div
        v-if="groups.length"
        class="install-tabs manager-tabs"
        role="tablist"
        aria-label="包管理器"
        @keydown="managerKeydown"
      >
        <button
          v-for="group in groups"
          :key="group.key"
          :id="'manager-tab-' + group.key"
          type="button"
          role="tab"
          :aria-selected="group.members.includes(manager)"
          :tabindex="group.members.includes(manager) ? 0 : -1"
          aria-controls="install-panel"
          @click="manager = group.key"
        >
          {{ group.label }}
        </button>
      </div>
      <section
        id="install-panel"
        role="tabpanel"
        :aria-labelledby="
          'mode-tab-' + mode + (activeManager ? ' manager-tab-' + activeManager : '')
        "
      >
        <div class="code-frame">
          <div class="code-toolbar">
            <p class="guide-file">{{ guide.file || "接入说明" }}</p>
            <button
              id="copy-detail"
              class="copy-code"
              type="button"
              :disabled="!code"
              :aria-label="mode === 'alias' ? '复制安装命令' : '复制配置'"
              :title="mode === 'alias' ? '复制安装命令' : '复制配置'"
              @click="copy(code)"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
              复制
            </button>
          </div>
          <pre id="install-code" tabindex="0">{{ code || guide.note }}</pre>
        </div>
        <p v-if="code" class="dialog-note">{{ guide.note }}</p>
        <p v-if="detailMessage.includes('失败')" class="dialog-note">
          实时版本查询暂不可用，当前使用已有数据。
        </p>
      </section>
      <p class="sr-only" role="status">{{ detailMessage }}</p>
    </template>
  </dialog>

  <div id="toast" role="status" class="toast" :hidden="!toast">{{ toast }}</div>
</template>
