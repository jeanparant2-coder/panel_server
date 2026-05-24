const app = document.querySelector("#app");
const DEFAULT_ACCESS_LABELS = ["dashboard", "containers", "images", "logs", "extensions", "settings"];

const routes = {
  "/": "dashboard",
  "/login": "login",
  "/dashboard": "dashboard",
  "/containers": "containers",
  "/containers/create": "container-create",
  "/images": "images",
  "/images/create": "image-create",
  "/logs": "logs",
  "/extensions": "extensions",
  "/settings": "settings",
  "/settings/users": "settings",
  "/settings/users/create": "user-create",
  "/settings/config": "settings",
  "/settings/appearance": "settings",
  "/settings/plugins": "settings"
};

const state = {
  session: null,
  dashboard: null,
  containers: [],
  images: [],
  settings: null,
  extensions: [],
  plugins: [],
  logs: [],
  updateInfo: null,
  configJson: null,
  selectedContainer: null,
  selectedInspect: null,
  selectedLogs: "",
  view: "dashboard",
  settingsTab: "users",
  pendingView: null,
  pendingSettingsTab: null,
  pendingImportedConfig: null,
  pendingBuildFiles: null,
  editUserId: null,
  dashboardEditing: false,
  dashboardDragTile: null,
  dashboardResize: null
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uiIcon(name) {
  const paths = {
    dashboard: '<path d="M4 5h6v6H4zM14 5h6v4h-6zM4 15h6v4H4zM14 13h6v6h-6z"/>',
    containers: '<path d="M4 7l8-4 8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/>',
    images: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M7 16l4-4 3 3 2-2 3 3"/><circle cx="15.5" cy="9.5" r="1.5"/>',
    logs: '<path d="M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    extensions: '<path d="M9 3h6v5h5v6h-5v7H9v-7H4V8h5z"/>',
    settings: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8z"/><path d="M4 12h2m12 0h2M12 4v2m0 12v2m-5.7-2.3l1.4-1.4m8.6-8.6l1.4-1.4m0 11.4l-1.4-1.4M7.7 7.7L6.3 6.3"/>',
    logout: '<path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9"/>',
    users: '<path d="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 19v-1a3.5 3.5 0 00-3-3.5"/><path d="M16 4.5a3.5 3.5 0 010 6.8"/>',
    config: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M14 4l-4 16"/>',
    appearance: '<path d="M12 3a9 9 0 100 18h1.5a2 2 0 001.4-3.4l-.4-.4a2 2 0 011.4-3.4H17a4 4 0 004-4A7 7 0 0012 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14" cy="7.5" r="1"/>',
    start: '<path d="M8 5v14l11-7z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
    restart: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v6h-6"/>',
    remove: '<path d="M6 7h12"/><path d="M9 7V5h6v2"/><path d="M9 10v7M15 10v7"/><path d="M8 7l1 13h6l1-13"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"/><path d="M13.5 7.5l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.dashboard}</svg>`;
}

function bytes(value) {
  const number = Number(value || 0);
  if (!number) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
  return `${(number / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function duration(seconds) {
  const s = Number(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

async function api(path, options = {}) {
  const isBlob = options.body instanceof Blob;
  const response = await fetch(path, {
    headers: options.body && !isBlob ? { "content-type": "application/json" } : {},
    ...options,
    body: options.body && !isBlob ? JSON.stringify(options.body) : options.body
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || payload || response.statusText);
  return payload;
}

function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}

function clearBlockingUi() {
  document.querySelectorAll(".modal-backdrop").forEach(node => node.classList.add("hidden"));
  document.body.classList.remove("is-busy");
}

function renderFatal(message) {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-card login-centered">
        <h1>Panel blocked</h1>
        <p>${esc(message || "The interface could not render correctly.")}</p>
        <button class="button primary wide" type="button" data-hard-reload>Reload panel</button>
        <button class="button wide" type="button" data-force-login>Back to login</button>
      </section>
    </main>
  `;
}

function routeToPath(view = state.view) {
  if (view === "login") return "/login";
  if (view === "settings") return `/settings/${state.settingsTab || "users"}`;
  if (view === "user-create") return "/settings/users/create";
  if (view === "user-edit") return `/settings/users/${state.editUserId}`;
  if (view === "container-create") return "/containers/create";
  if (view === "image-create") return "/images/create";
  if (view === "container-detail") return "/containers";
  return `/${view}`;
}

function setRoute(view, replace = false) {
  state.view = view;
  const path = routeToPath(view);
  if (window.location.pathname !== path) {
    history[replace ? "replaceState" : "pushState"]({}, "", path);
  }
}

function readRoute() {
  const path = window.location.pathname;
  if (path.startsWith("/settings/users/") && path !== "/settings/users/create") {
    state.settingsTab = "users";
    state.editUserId = decodeURIComponent(path.split("/")[3] || "");
    state.view = "user-edit";
    return;
  }
  if (path.startsWith("/settings/")) state.settingsTab = path.split("/")[2] || "users";
  state.view = routes[path] || "dashboard";
}

async function loadSession() {
  state.session = await api("/api/session");
  applyTheme(state.session.config);
}

async function loadDashboard() {
  state.dashboard = await api("/api/dashboard");
  applyTheme(state.dashboard);
}

async function loadVersionStatus(force = false) {
  if (!force && state.updateInfo?.checkedAt && Date.now() - state.updateInfo.checkedAt < 300000) return state.updateInfo;
  const info = await api("/api/version/check");
  state.updateInfo = { ...info, checkedAt: Date.now() };
  return state.updateInfo;
}

async function loadContainers() {
  state.containers = await api("/api/containers");
}

async function loadImages() {
  state.images = await api("/api/images");
}

async function loadSettings() {
  state.settings = await api("/api/settings");
  state.configJson = await api("/api/settings/config");
  applyTheme(state.settings);
}

async function loadExtensions() {
  state.extensions = await api("/api/extensions");
}

async function loadPlugins() {
  state.plugins = await api("/api/plugins");
}

async function loadLogs() {
  state.logs = await api("/api/logs");
}

function applyTheme(config = {}) {
  const appearance = config.appearance || {};
  document.documentElement.style.setProperty("--primary", appearance.primary || "#38bdf8");
  document.documentElement.style.setProperty("--accent", appearance.accent || "#60a5fa");
  document.body.dataset.density = appearance.density || "comfortable";
}

function renderLogin(error = "") {
  setRoute("login", true);
  const config = state.session?.config || {};
  const showHint = Boolean(config.defaultCredentials && config.loginHint);
  app.innerHTML = `
    <main class="login-page" style="background-image:linear-gradient(90deg, rgba(8,13,21,.25), rgba(8,13,21,.72) 30%, rgba(8,13,21,.72) 70%, rgba(8,13,21,.25)), linear-gradient(180deg, rgba(8,13,21,.18), rgba(8,13,21,.72)), url('${esc(config.appearance?.loginBackground || "/assets/login-bg.png")}')">
      <form class="login-card login-centered" id="loginForm" style="background-color:rgba(11,18,29,${Math.max(5, Math.min(95, Number(config.appearance?.loginOpacity ?? 78))) / 100}); --login-card-opacity:${Math.max(5, Math.min(95, Number(config.appearance?.loginOpacity ?? 78))) / 100}">
        <h1>Connexion</h1>
        <p>${esc(config.tagline || "Un panel propre pour piloter ton serveur.")}</p>
        <div class="field">
          <label for="username">Utilisateur</label>
          <input id="username" name="username" autocomplete="username" required autofocus>
        </div>
        <div class="field">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="button primary wide" type="submit">Se connecter</button>
        <div class="error">${esc(error)}</div>
        ${showHint ? '<div class="hint">Pense a changer le mot de passe dans les parametres apres la premiere connexion.</div>' : ""}
      </form>
    </main>
  `;
}

function formToConfigOptions(form) {
  const data = new FormData(form);
  const number = key => Number(data.get(key));
  const checked = key => data.has(key);
  return {
    language: data.get("language") || "en",
    general: {
      refreshInterval: number("general.refreshInterval"),
      compactTables: checked("general.compactTables"),
      showOfflineDockerWarning: checked("general.showOfflineDockerWarning")
    },
    security: {
      requireCurrentPassword: checked("security.requireCurrentPassword"),
      notifyNewIp: checked("security.notifyNewIp"),
      sessionHours: number("security.sessionHours"),
      allowRememberDevice: checked("security.allowRememberDevice")
    },
    logging: {
      level: data.get("logging.level") || "info",
      keepDays: number("logging.keepDays"),
      dockerLogTail: number("logging.dockerLogTail")
    },
    monitoring: {
      enabled: checked("monitoring.enabled"),
      cpuWarning: number("monitoring.cpuWarning"),
      memoryWarning: number("monitoring.memoryWarning")
    },
    miscellaneous: {
      enableExperimental: checked("miscellaneous.enableExperimental"),
      confirmDangerousActions: checked("miscellaneous.confirmDangerousActions")
    }
  };
}

async function uploadAsset(endpoint, input) {
  const file = input?.files?.[0];
  if (!file) return null;
  const result = await api(`${endpoint}?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  return result.url;
}

function canAccess(area) {
  if (state.session?.role === "admin") return true;
  return Array.isArray(state.session?.access) && state.session.access.includes(area);
}

function viewAccess(view) {
  if (view === "container-detail" || view === "container-create") return "containers";
  if (view === "image-create") return "images";
  if (view === "settings" || view === "user-create" || view === "user-edit") return "settings";
  return view;
}

function shell(content) {
  const config = state.dashboard || state.settings || state.session?.config || {};
  const docker = state.dashboard?.docker;
  const name = config.panelName || "NodePilot";
  const version = state.updateInfo || config.version || {};
  const versionLabel = version.version ? `v${version.version}` : "version";
  const updateClass = version.updateAvailable ? " update-available" : "";
  const nav = [
    ["dashboard", "Dashboard", "dashboard"],
    ["containers", "Containers", "containers"],
    ["images", "Images", "images"],
    ["logs", "Logs", "logs"],
    ["extensions", "Extensions", "extensions"]
  ].filter(([view]) => canAccess(viewAccess(view))).map(([view, label, icon]) => `
    <button class="nav-button ${state.view === view || (view === "containers" && state.view === "container-detail") ? "active" : ""}" data-view="${view}">
      <span>${uiIcon(icon)}</span>${label}
    </button>
  `).join("");

  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="side-brand">
          <img src="/assets/server-icon.png" alt="">
          <div>
            <strong>${esc(name)}</strong>
            <span>${esc(state.session?.username || "")}</span>
          </div>
        </div>
        <nav class="nav">${nav}</nav>
        <div class="side-bottom">
          ${canAccess("settings") ? `<button class="nav-button ${state.view === "settings" || state.view === "user-create" || state.view === "user-edit" ? "active" : ""}" data-view="settings"><span>${uiIcon("settings")}</span>Settings</button>` : ""}
          <button class="nav-button" id="logoutBtn"><span>${uiIcon("logout")}</span>Logout</button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <strong>${esc(name)}</strong>
          <div class="topbar-status">
            <button class="status-pill version-pill${updateClass}" data-check-update title="Verifier les mises a jour">${esc(versionLabel)}</button>
            <span class="status-pill"><i class="dot ${docker?.connected ? "" : "off"}"></i>${docker?.connected ? "Docker connected" : "Docker disconnected"}</span>
          </div>
        </header>
        <section class="content">${content}</section>
      </main>
    </div>
  `;
}

function pageHead(title, subtitle, action = "") {
  return `
    <div class="page-head">
      <div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      <div class="actions">${action}</div>
    </div>
  `;
}

function metric(label, value, detail) {
  return `<article class="card metric"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function progress(label, value, detail, tone = "") {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div class="progress-row ${tone}">
      <div><span>${label}</span><strong>${safe}%</strong></div>
      <div class="progress-track"><i style="width:${safe}%"></i></div>
      <small>${detail}</small>
    </div>
  `;
}

function dockerErrorPanel(error) {
  if (!error) return "";
  return `
    <div class="notice docker-explain">
      <strong>Docker n'est pas accessible depuis ce contexte.</strong>
      <span>Le backend essaie de joindre Docker via le socket local. Sur Windows il utilise le pipe Docker Desktop, et dans un conteneur Linux il faut monter <span class="mono">/var/run/docker.sock</span>. Si Docker Desktop n'est pas lance ou si le socket n'est pas partage, le panel reste connecte mais ne peut pas piloter les containers.</span>
      <small class="mono">${esc(error)}</small>
    </div>
  `;
}

function orderedDashboardWidgets() {
  const layout = state.dashboard?.dashboardLayout || { order: ["clock", "status", "containers", "actions"], hidden: [], sizes: {} };
  const links = (state.dashboard?.dashboardLinks || []).map(link => `app:${link.id}`);
  const automations = (state.dashboard?.dashboardAutomations || []).map(item => `automation:${item.id}`);
  const all = ["clock", "status", "containers", "actions", ...links, ...automations];
  const defaults = { clock: "small", status: "large", actions: "medium", containers: "large" };
  return {
    order: [...(layout.order || []), ...all.filter(item => !(layout.order || []).includes(item))].filter(item => all.includes(item)),
    hidden: (layout.hidden || []).filter(item => all.includes(item)),
    sizes: Object.fromEntries(all.map(item => [item, ["small", "medium", "large", "wide"].includes(layout.sizes?.[item]) ? layout.sizes[item] : (defaults[item] || (item.startsWith("app:") ? "small" : "medium"))]))
  };
}

async function saveDashboardLayout(layout) {
  await api("/api/dashboard-layout", { method: "POST", body: layout });
  state.dashboard.dashboardLayout = layout;
}

function movedList(items, id, direction) {
  const list = [...items];
  const index = list.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
}

function resizedWidgets(sizes, id, direction) {
  const steps = ["small", "medium", "large", "wide"];
  const current = sizes[id] || "medium";
  const index = steps.indexOf(current);
  const next = Math.max(0, Math.min(steps.length - 1, index + (direction === "up" ? 1 : -1)));
  return { ...sizes, [id]: steps[next] };
}

async function addDashboardTile(tileId, size = "medium") {
  const layout = orderedDashboardWidgets();
  layout.hidden = layout.hidden.filter(item => item !== tileId);
  if (!layout.order.includes(tileId)) layout.order.push(tileId);
  layout.sizes = { ...layout.sizes, [tileId]: layout.sizes[tileId] || size };
  await saveDashboardLayout(layout);
}

function dashboardWidgetShell(id, title, body, extraClass = "") {
  const layout = orderedDashboardWidgets();
  const size = layout.sizes[id] || "medium";
  return `
    <div class="dashboard-edit-wrap widget-size-${size} ${state.dashboardEditing ? "editing" : ""} ${extraClass}" data-dashboard-widget="${esc(id)}" data-dashboard-tile="${esc(id)}" ${state.dashboardEditing ? 'draggable="true"' : ""}>
      ${state.dashboardEditing ? `<div class="dashboard-edit-bar">
        <strong>${esc(title)}</strong>
        <span>
          <small>Glisser pour deplacer</small>
          <button class="icon-button" title="Masquer" data-hide-widget="${esc(id)}">${uiIcon("remove")}</button>
        </span>
      </div>` : ""}
      ${body}
      ${state.dashboardEditing ? `<span class="tile-resize-grip" title="Agrandir ou reduire" data-resize-grip="${esc(id)}"></span>` : ""}
    </div>
  `;
}

function renderDashboard() {
  setRoute("dashboard", true);
  const data = state.dashboard;
  const docker = data.docker;
  const stopped = Math.max(0, Number(docker.containers || 0) - Number(docker.running || 0));
  const links = data.dashboardLinks || [];
  const automations = data.dashboardAutomations || [];
  const defaultIcon = data.appearance?.iconUrl || "/assets/server-icon.png";
  const layout = orderedDashboardWidgets();
  const hidden = new Set(layout.hidden || []);
  const editActions = `
    <button class="button" id="refreshBtn">Rafraichir</button>
    ${canAccess("settings") ? `<button class="icon-button dashboard-edit-toggle ${state.dashboardEditing ? "active" : ""}" title="Modifier le dashboard" data-toggle-dashboard-edit>${uiIcon("edit")}</button>` : ""}
    ${canAccess("settings") && state.dashboardEditing ? `<button class="icon-button dashboard-add-toggle" title="Ajouter" data-toggle-dashboard-add>${uiIcon("plus")}</button>` : ""}
  `;
  const hiddenTools = state.dashboardEditing && hidden.size ? `
    <div class="dashboard-hidden-tools">
      ${[...hidden].map(id => `<button class="button" data-show-widget="${esc(id)}">${uiIcon("plus")}${esc(id)}</button>`).join("")}
    </div>
  ` : "";
  const now = new Date();
  const dateText = now.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
  const timeText = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const quickContainers = state.containers.slice(0, 5).map(container => `
    <article class="quick-container">
      <button class="link-button" data-open-container="${esc(container.id)}">${esc(container.name)}</button>
      <span>${stateBadge(container.state)}</span>
      <small class="mono">${container.ports.length ? esc(container.ports.join(", ")) : "aucun port"}</small>
      <div>
        <button class="icon-button" title="Demarrer" data-container-action="start" data-id="${esc(container.id)}">${uiIcon("start")}</button>
        <button class="icon-button" title="Arreter" data-container-action="stop" data-id="${esc(container.id)}">${uiIcon("stop")}</button>
        <button class="icon-button" title="Redemarrer" data-container-action="restart" data-id="${esc(container.id)}">${uiIcon("restart")}</button>
      </div>
    </article>
  `).join("");
  const widgets = {
    clock: dashboardWidgetShell("clock", "Horloge", `
      <section class="card dashboard-card clock-widget">
        <div class="card-body">
          <span>${esc(dateText)}</span>
          <strong class="clock-time">${esc(timeText)}</strong>
        </div>
      </section>
    `),
    status: dashboardWidgetShell("status", "Statut", `
      <div class="grid metrics dashboard-metrics small-metrics">
        ${metric("Containers", esc(docker.containers), `${esc(docker.running)} running / ${stopped} stopped`)}
        ${metric("Images", esc(docker.images), `${esc(docker.volumes)} volumes`)}
      </div>
    `),
    actions: dashboardWidgetShell("actions", "Actions rapides", `
      <section class="card dashboard-card compact-actions-card">
        <div class="card-head"><h2>Actions rapides</h2></div>
        <div class="card-body quick-actions">
          ${canAccess("containers") ? '<button class="quick-card" data-view="containers"><strong>Containers</strong><span>Demarrer, arreter, logs.</span></button>' : ""}
          ${canAccess("images") ? '<button class="quick-card" data-view="images"><strong>Images</strong><span>Pull, import, build.</span></button>' : ""}
          ${canAccess("settings") ? '<button class="quick-card" data-view="settings"><strong>Settings</strong><span>Users, config, theme.</span></button>' : ""}
        </div>
      </section>
    `),
    containers: dashboardWidgetShell("containers", "Containers rapides", `
      <section class="card dashboard-card">
        <div class="card-head"><h2>Containers rapides</h2><button class="button" data-view="containers">Voir tout</button></div>
        <div class="card-body quick-container-list">${quickContainers || '<p class="empty">Aucun conteneur disponible.</p>'}</div>
      </section>
    `),
  };
  for (const link of links) {
    widgets[`app:${link.id}`] = dashboardWidgetShell(`app:${link.id}`, link.title, `
      <section class="card dashboard-card app-tile">
        ${state.dashboardEditing ? `<button class="icon-button tile-delete-button" title="Supprimer l'application" data-remove-dashboard-link="${esc(link.id)}">${uiIcon("remove")}</button>` : ""}
        <a href="${esc(link.url)}" target="_blank" rel="noreferrer">
          <img src="${esc(link.iconUrl || defaultIcon)}" alt="">
          <strong>${esc(link.title)}</strong>
          <span>${esc(link.url.replace(/^https?:\/\//, ""))}</span>
        </a>
      </section>
    `);
  }
  for (const automation of automations) {
    widgets[`automation:${automation.id}`] = dashboardWidgetShell(`automation:${automation.id}`, automation.title, `
      <section class="card dashboard-card automation-tile">
        <div class="card-body">
          <span class="pill">Automation</span>
          <h2>${esc(automation.title)}</h2>
          <p>${esc(automation.action)} ${esc((automation.containerIds || []).length)} container(s)</p>
          <button class="button primary" data-run-automation="${esc(automation.id)}">${automation.action === "stop" ? "Arreter" : automation.action === "restart" ? "Redemarrer" : "Demarrer"}</button>
        </div>
      </section>
    `);
  }
  const orderedWidgets = [...(layout.order || []), ...Object.keys(widgets).filter(id => !(layout.order || []).includes(id))]
    .filter(id => widgets[id] && !hidden.has(id))
    .map(id => widgets[id])
    .join("");
  app.innerHTML = shell(`
    ${pageHead("Dashboard", "Vue simple du serveur et des actions utiles.", editActions)}
    ${dockerErrorPanel(docker.error)}
    ${hiddenTools}
    <div class="grid dashboard-workspace dashboard-edit-grid ${state.dashboardEditing ? "is-editing" : ""}">
      ${orderedWidgets || '<section class="card"><div class="card-body empty">Le dashboard est vide. Clique sur + pour remettre des blocs.</div></section>'}
    </div>
    ${state.dashboardEditing ? `
      <div class="modal-backdrop hidden" id="dashboardAddModal">
        <div class="modal-card dashboard-picker">
          <div class="modal-head"><h2>Ajouter au dashboard</h2><button class="icon-button" type="button" data-close-dashboard-add>${uiIcon("remove")}</button></div>
          <div class="picker-grid">
            ${["clock","status","containers","actions"].map(id => `<button class="picker-card" data-add-widget="${id}">${uiIcon(id === "clock" ? "dashboard" : id === "status" ? "logs" : id === "containers" ? "containers" : "settings")}<strong>${id === "clock" ? "Heure" : id === "status" ? "Statut" : id === "containers" ? "Conteneurs" : "Actions"}</strong></button>`).join("")}
          </div>
          <h3>Applications sauvegardees</h3>
          <div class="picker-apps">
            ${links.map(link => `<article class="picker-app-row"><button class="picker-app" data-add-app-tile="${esc(link.id)}"><img src="${esc(link.iconUrl || defaultIcon)}" alt=""><span>${esc(link.title)}</span></button><button class="icon-button" title="Supprimer" data-remove-dashboard-link="${esc(link.id)}">${uiIcon("remove")}</button></article>`).join("") || '<p class="empty">Aucune application sauvegardee.</p>'}
          </div>
          <form id="dashboardLinkForm" class="sub-card form-grid">
            <div class="field"><label>Nouvelle application</label><input name="title" placeholder="Crafty" required></div>
            <div class="field"><label>Lien</label><input name="url" type="url" placeholder="https://..." required></div>
            <div class="field full"><label>Icone</label><input id="dashboardIconFile" type="file" accept=".png,.jpg,.jpeg,.webp,.ico,image/*"></div>
            <button class="button primary full" type="submit">Creer et ajouter</button>
          </form>
          <form id="dashboardAutomationForm" class="sub-card form-grid">
            <div class="field"><label>Automatisation</label><input name="title" placeholder="Allumer le serveur"></div>
            <div class="field"><label>Action</label><select name="action"><option value="start">Demarrer</option><option value="stop">Arreter</option><option value="restart">Redemarrer</option></select></div>
            <div class="access-grid full">${state.containers.map(container => `<label class="mini-check"><input type="checkbox" name="containerIds" value="${esc(container.id)}">${esc(container.name)}</label>`).join("") || '<p class="empty">Docker non accessible ou aucun conteneur.</p>'}</div>
            <button class="button primary full" type="submit">Creer le bouton</button>
          </form>
        </div>
      </div>
    ` : ""}
  `);
}
function stateBadge(stateValue) {
  const value = String(stateValue || "unknown").toLowerCase();
  const cls = value === "running" ? "ok" : value.includes("exit") || value === "created" ? "muted" : "warn";
  return `<span class="badge ${cls}"><i></i>${esc(stateValue || "unknown")}</span>`;
}

function containerRows() {
  return state.containers.map(container => `
    <tr>
      <td><button class="link-button" data-open-container="${esc(container.id)}">${esc(container.name)}</button><br><span class="mono muted-text">${esc(container.id.slice(0, 12))}</span></td>
      <td>${stateBadge(container.state)}</td>
      <td class="mono">${esc(container.image)}</td>
      <td class="mono">${container.ports.length ? esc(container.ports.join(", ")) : "<span class='muted-text'>aucun</span>"}</td>
      <td>
        <div class="row-actions">
      <button class="icon-button" title="Demarrer" data-container-action="start" data-id="${esc(container.id)}">${uiIcon("start")}</button>
      <button class="icon-button" title="Arreter" data-container-action="stop" data-id="${esc(container.id)}">${uiIcon("stop")}</button>
      <button class="icon-button" title="Redemarrer" data-container-action="restart" data-id="${esc(container.id)}">${uiIcon("restart")}</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function containerCreatePanel() {
  const options = state.images
    .map(image => image.tags)
    .flat()
    .filter(tag => tag && !tag.includes("<none>"))
    .sort((a, b) => a.localeCompare(b));
  return `
    <div class="create-layout">
      <section class="card drawer-card">
        <div class="card-head">
          <h2>Create container</h2>
          <span class="pill">Docker API</span>
        </div>
        <form class="card-body form-grid" id="containerForm">
          <div class="field full"><label>Container name</label><input name="name" placeholder="minecraft-server" required></div>
          <div class="field"><label>Select local image</label><select name="imageSelect" id="containerImageSelect"><option value="">Choose an existing image...</option>${options.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join("")}</select><small>${options.length} local image tag(s)</small></div>
          <div class="field"><label>Or type image</label><input name="imageCustom" placeholder="registry.example.com/app:latest"></div>
          <div class="notice full image-meta-hint" id="imageMetaHint">Selectionne une image locale pour pre-remplir automatiquement les ports exposes par l'image.</div>
          <details class="advanced full">
            <summary>Advanced options: ports, volumes, env</summary>
            <div class="form-grid inner">
              <div class="field full"><label>Ports</label><textarea name="ports" placeholder="25565:25565/tcp&#10;8080:80/tcp"></textarea><small>L'image peut exposer des ports, mais Docker a besoin d'un mapping hote:conteneur pour les ouvrir.</small></div>
              <div class="field full"><label>Volumes</label><textarea name="volumes" placeholder="/host/path:/container/path&#10;volume_name:/data"></textarea><small>Les volumes de l'image indiquent seulement les chemins internes. Le chemin hote reste a choisir.</small></div>
              <div class="field full"><label>Environment variables</label><textarea name="env" placeholder="TZ=Europe/Paris&#10;EULA=true"></textarea></div>
              <div class="field"><label>Restart policy</label><select name="restart"><option>unless-stopped</option><option>always</option><option>on-failure</option><option>no</option></select></div>
              <div class="field"><label>Network</label><input name="network" placeholder="bridge"></div>
              <div class="field"><label>CPU limit</label><input name="cpus" type="number" min="0" step="0.25" placeholder="1"></div>
              <div class="field"><label>Memory limit</label><input name="memory" placeholder="512m"></div>
              <div class="field full"><label>Command</label><input name="command" placeholder="optional"></div>
            </div>
          </details>
          <div class="actions full">
            <button class="button" type="button" data-view="containers">Cancel</button>
            <button class="button primary" type="submit">Create container</button>
          </div>
        </form>
      </section>
      <aside class="create-summary card">
        <div class="card-head"><h2>What happens</h2></div>
        <div class="card-body health-grid">
          <div class="health-row"><span>1</span><strong>Image</strong><small>NodePilot uses a local image or pulls it first.</small></div>
          <div class="health-row"><span>2</span><strong>Configuration</strong><small>Ports, volumes and environment are sent to Docker.</small></div>
          <div class="health-row"><span>3</span><strong>Start</strong><small>The container is created and started automatically.</small></div>
        </div>
      </aside>
    </div>
  `;
}

function renderContainers(error = "") {
  setRoute("containers", true);
  app.innerHTML = shell(`
    ${pageHead("Containers", "All Docker containers, including Portainer and command-line containers.", '<button class="button primary" data-view="container-create">Create container</button><button class="button" data-refresh-containers>Sync</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="card list-card">
      <div class="card-head"><h2>Container list</h2><span class="pill">${state.containers.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Etat</th><th>Image</th><th>Ports utilises</th><th>Actions</th></tr></thead>
          <tbody>${containerRows() || '<tr><td colspan="5" class="empty">Aucun conteneur.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `);
}

function renderContainerCreate(error = "") {
  setRoute("container-create", true);
  app.innerHTML = shell(`
    ${pageHead("Create container", "Choose an existing image or type an image name. Missing images are pulled automatically.", '<button class="button" data-view="containers">Back to containers</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    ${containerCreatePanel()}
  `);
  bindContainerImagePrefill();
}

function detailPorts(inspect) {
  const ports = inspect?.NetworkSettings?.Ports || {};
  const rows = Object.entries(ports).map(([containerPort, bindings]) => {
    if (!bindings) return `${containerPort} non publie`;
    return bindings.map(binding => `${binding.HostIp || "0.0.0.0"}:${binding.HostPort} -> ${containerPort}`).join(", ");
  });
  return rows.slice(0, 12).join("\n") + (rows.length > 12 ? `\n+${rows.length - 12} autres ports` : "") || "Aucun port publie";
}

function renderContainerDetail(error = "") {
  setRoute("containers", true);
  const item = state.selectedContainer;
  const inspect = state.selectedInspect;
  app.innerHTML = shell(`
    ${pageHead(esc(item?.name || "Conteneur"), esc(item?.image || ""), '<button class="button" data-view="containers">Back Retour</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="card">
      <div class="toolbar">
        <button class="button" data-container-action="start" data-id="${esc(item.id)}">${uiIcon("start")}Demarrer</button>
        <button class="button" data-container-action="stop" data-id="${esc(item.id)}">${uiIcon("stop")}Arreter</button>
        <button class="button" data-container-action="restart" data-id="${esc(item.id)}">${uiIcon("restart")}Redemarrer</button>
        <button class="button" data-container-action="recreate" data-id="${esc(item.id)}">${uiIcon("restart")}Recreer</button>
        <button class="button danger" data-container-action="remove" data-id="${esc(item.id)}">${uiIcon("remove")}Supprimer</button>
      </div>
      <div class="card-body detail-grid">
        <div class="health-row"><span>Etat</span><strong>${stateBadge(item.state)}</strong><small>${esc(item.status)}</small></div>
        <div class="health-row"><span>ID</span><strong class="mono">${esc(item.id.slice(0, 12))}</strong><small>${esc(item.id)}</small></div>
        <div class="health-row"><span>Ports</span><strong class="mono preline">${esc(detailPorts(inspect))}</strong><small>Mapping hote -> conteneur</small></div>
        <div class="health-row"><span>Cree</span><strong>${inspect?.Created ? new Date(inspect.Created).toLocaleString() : "inconnu"}</strong><small>${esc(inspect?.Name || "")}</small></div>
      </div>
    </section>
    <section class="card" style="margin-top:18px">
      <div class="card-head"><h2>Logs</h2><button class="button" data-load-logs="${esc(item.id)}">Reload</button></div>
      <pre class="logs">${esc(state.selectedLogs || "Aucun log charge.")}</pre>
    </section>
  `);
}

function imageRows() {
  return state.images.map(image => `
    <tr>
      <td><strong>${esc(image.tags.join(", "))}</strong><br><span class="mono muted-text">${esc(image.id.replace("sha256:", "").slice(0, 12))}</span></td>
      <td>${bytes(image.size)}</td>
      <td>${image.created ? new Date(image.created * 1000).toLocaleString() : "inconnu"}</td>
      <td><button class="icon-button" data-remove-image="${esc(image.id)}">X</button></td>
    </tr>
  `).join("");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function dockerfileTemplate(runtime, startCommand, port) {
  const command = String(startCommand || "").trim();
  if (runtime === "node") {
    return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package.json ]; then npm install --omit=dev; fi
COPY . .
EXPOSE ${port || 3000}
CMD ${command ? JSON.stringify(["sh", "-c", command]) : '["npm","start"]'}`;
  }
  if (runtime === "python") {
    return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
COPY . .
EXPOSE ${port || 8000}
CMD ${command ? JSON.stringify(["sh", "-c", command]) : '["python","main.py"]'}`;
  }
  if (runtime === "static") {
    return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80`;
  }
  return "";
}

function decodeBase64Utf8(value) {
  return decodeURIComponent(escape(atob(value || "")));
}

function findBuildFile(files, name) {
  const wanted = String(name).toLowerCase();
  return files.find(file => String(file.path || "").split("/").pop().toLowerCase() === wanted);
}

function autoDockerfile(files) {
  const dockerfile = findBuildFile(files, "Dockerfile");
  if (dockerfile) return decodeBase64Utf8(dockerfile.content);
  const packageFile = findBuildFile(files, "package.json");
  if (packageFile) {
    return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm","start"]`;
  }
  if (findBuildFile(files, "requirements.txt") || findBuildFile(files, "main.py") || findBuildFile(files, "app.py")) {
    return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
COPY . .
EXPOSE 8000
CMD ["python","main.py"]`;
  }
  return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80`;
}

async function buildFilesPayload(input) {
  const files = state.pendingBuildFiles || Array.from(input?.files || []);
  const payload = [];
  for (const file of files) {
    if (file.size > 12_000_000) throw new Error(`${file.name} is too large for browser upload.`);
    const path = file.webkitRelativePath || file.name;
    if (path.includes(".git/") || path.includes("node_modules/")) continue;
    payload.push({ path, encoding: "base64", content: arrayBufferToBase64(await file.arrayBuffer()) });
  }
  return payload;
}

function imageCreatePanel() {
  return `
    <div class="create-layout">
      <section class="card drawer-card">
        <div class="card-head">
          <h2>Add image</h2>
          <span class="pill">Registry / Archive</span>
        </div>
        <div class="card-body">
          <div class="field"><label>Image name / tag</label><input id="imageDisplayName" placeholder="my-image:latest"><small>Optional custom tag after download.</small></div>
          <div class="segmented">
            <label><input type="radio" name="imageMode" value="download" checked> Download</label>
            <label><input type="radio" name="imageMode" value="import"> Import</label>
            <label><input type="radio" name="imageMode" value="build"> Files</label>
          </div>
          <form id="pullForm" class="inline-form image-download-mode">
            <input name="image" placeholder="registry.example.com/project/image:latest" required>
            <button class="button primary" type="submit">Create image</button>
          </form>
          <label class="dropzone image-import-mode" id="dropzone">
            <input type="file" id="imageFile" accept=".tar,application/x-tar">
            <strong>Import image archive</strong>
            <span>Docker requires an exported image archive such as docker save .tar.</span>
            <button class="button" type="button" data-pick-file>Choose file</button>
          </label>
          <form id="buildForm" class="image-build-mode build-form">
            <label class="dropzone compact" id="buildDropzone">
              <input type="file" id="buildFiles" multiple webkitdirectory>
              <strong>Import project folder</strong>
              <span id="buildFilesLabel">Choisis le dossier complet. Si un Dockerfile existe, il sera utilise automatiquement.</span>
              <button class="button" type="button" data-pick-build-files>Choose files</button>
            </label>
            <button class="button primary wide" type="submit">Build image</button>
          </form>
          <pre class="logs small" id="imageOutput">Ready.</pre>
        </div>
      </section>
      <aside class="create-summary card">
        <div class="card-head"><h2>Tips</h2></div>
        <div class="card-body health-grid">
          <div class="health-row"><span>Download</span><strong>Registry image</strong><small>Use a full image reference with tag.</small></div>
          <div class="health-row"><span>Import</span><strong>Docker archive</strong><small>Use an exported image archive from docker save.</small></div>
          <div class="health-row"><span>Files</span><strong>Build auto</strong><small>Upload a project folder. Dockerfile is detected first, otherwise Node/Python/static is guessed.</small></div>
          <div class="health-row"><span>Next</span><strong>Create container</strong><small>New images appear in the image selector.</small></div>
        </div>
      </aside>
    </div>
  `;
}

function renderImages(error = "") {
  setRoute("images", true);
  app.innerHTML = shell(`
    ${pageHead("Images", "All Docker images, including images created outside NodePilot.", '<button class="button primary" data-view="image-create">Create image</button><button class="button" data-refresh-images>Sync</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="card list-card">
      <div class="card-head"><h2>Local images</h2><span class="pill">${state.images.length} total</span></div>
      <div class="table-wrap">
        <table><thead><tr><th>Tag</th><th>Taille</th><th>Creee</th><th></th></tr></thead><tbody>${imageRows() || '<tr><td colspan="4" class="empty">Aucune image.</td></tr>'}</tbody></table>
      </div>
    </section>
  `);
  bindDropzone();
}

function renderImageCreate(error = "") {
  setRoute("image-create", true);
  document.body.dataset.imageMode = "download";
  app.innerHTML = shell(`
    ${pageHead("Create image", "Download an image from a registry or import a Docker image archive.", '<button class="button" data-view="images">Back to images</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    ${imageCreatePanel()}
  `);
  bindDropzone();
}

function extensionRows() {
  return state.extensions.map(extension => `
    <article class="extension-card">
      <div>
        <strong>${esc(extension.name)}</strong>
        <span>${esc(extension.description || "No description")}</span>
      </div>
      <span class="pill">v${esc(extension.version || "0.1.0")}</span>
      <span class="badge ${extension.enabled ? "ok" : "muted"}"><i></i>${extension.enabled ? "enabled" : "disabled"}</span>
      <div class="row-actions">
        <button class="button" data-toggle-extension="${esc(extension.id)}" data-enabled="${extension.enabled ? "false" : "true"}">${extension.enabled ? "Disable" : "Enable"}</button>
        <button class="button danger" data-remove-extension="${esc(extension.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderLogs(error = "") {
  setRoute("logs", true);
  const rows = state.logs.map(item => `
    <tr>
      <td>${new Date(item.at).toLocaleString()}</td>
      <td><span class="pill">${esc(item.user || "system")}</span></td>
      <td class="mono">${esc(item.action || "")}</td>
      <td class="mono">${esc(JSON.stringify(item.detail || {}))}</td>
    </tr>
  `).join("");
  app.innerHTML = shell(`
    ${pageHead("Logs", "Historique des modifications faites depuis le panel.", '<button class="button" id="refreshBtn">Rafraichir</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="card list-card">
      <div class="card-head"><h2>Journal des actions</h2><span class="pill">${state.logs.length} total</span></div>
      <div class="table-wrap">
        <table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Aucun log pour le moment.</td></tr>'}</tbody></table>
      </div>
    </section>
  `);
}

function renderExtensions(error = "") {
  setRoute("extensions", true);
  app.innerHTML = shell(`
    ${pageHead("Extensions", "Base pour ajouter des modules au panel plus tard.", '<button class="button primary" data-pick-extension>Import extension</button>')}
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <input class="hidden-file" id="extensionFile" type="file" accept=".json,application/json">
    <section class="card">
      <div class="card-head"><h2>Installed extensions</h2><span class="pill">${state.extensions.length} total</span></div>
      <div class="card-body extension-grid">
        ${extensionRows() || '<div class="empty">No extension installed. Import a .json manifest to start.</div>'}
      </div>
    </section>
  `);
}

function tabButton(id, label, icon) {
  return `<button class="settings-tab ${state.settingsTab === id ? "active" : ""}" data-settings-tab="${id}"><span>${uiIcon(icon)}</span>${label}</button>`;
}

function settingsTabs(content) {
  return `
    <section class="card settings-card">
      <div class="settings-tabs">
        ${tabButton("users", "Panneau de configuration", "users")}
        ${tabButton("config", "Config.json", "config")}
        ${tabButton("appearance", "Personnaliser panel serveur", "appearance")}
        ${tabButton("plugins", "Plugin", "extensions")}
      </div>
      <div class="settings-panel">${content}</div>
    </section>
  `;
}

function accessChecks(user) {
  const access = user.access || [];
  return DEFAULT_ACCESS_LABELS.map(item => `
    <label class="mini-check"><input type="checkbox" name="access" value="${item}" ${access.includes(item) ? "checked" : ""} ${user.role === "admin" ? "disabled" : ""}>${item}</label>
  `).join("");
}

function renderSettingsUsers() {
  const data = state.settings;
  const roleInfo = {
    admin: { label: "Admin", permissions: DEFAULT_ACCESS_LABELS.join(", "), tone: "danger" },
    operator: { label: "Operator", permissions: "dashboard, containers, images, logs", tone: "ok" },
    viewer: { label: "Viewer", permissions: "dashboard", tone: "" }
  };
  return settingsTabs(`
    <div class="settings-section-head panel-config-head compact-head">
      <div>
        <span class="pill">Access control</span>
        <h2>Panneau de configuration</h2>
        <p>Utilisateurs, roles et permissions. Les modifications ouvrent une page dediee.</p>
      </div>
      <button class="button primary" data-view="user-create">Create user</button>
    </div>

    <section class="admin-panel-grid simple-admin-grid">
      <div class="admin-card admin-card-wide">
        <div class="admin-card-head">
          <div><h3>Users</h3><p>Comptes autorises sur ce panel.</p></div>
          <span class="pill">${data.users.length} total</span>
        </div>
        <div class="clean-user-list">
          ${data.users.map(user => `
            <article class="clean-user-card">
              <div class="user-avatar">${esc(user.username.slice(0, 1).toUpperCase())}</div>
              <div class="user-identity">
                <strong>${esc(user.username)}</strong>
                <span>${esc(user.email || "email non configure")}</span>
              </div>
              <span class="badge ${user.enabled === false ? "muted" : "ok"}"><i></i>${user.enabled === false ? "disabled" : "active"}</span>
              <span class="pill">${esc(user.role || "viewer")}</span>
              <div class="permission-pills compact">${(user.access || []).map(item => `<span>${esc(item)}</span>`).join("") || "<span>none</span>"}</div>
              <button class="button" type="button" data-edit-user-page="${esc(user.id)}">Modify</button>
            </article>
          `).join("")}
        </div>
      </div>

      <div class="admin-card">
        <div class="admin-card-head"><div><h3>Roles</h3><p>Permissions par defaut.</p></div></div>
        <div class="role-cards">
          ${Object.entries(roleInfo).map(([role, info]) => `
            <article class="role-card ${info.tone}">
              <div><strong>${info.label}</strong><span>${esc(data.users.filter(user => user.role === role).map(user => user.username).join(", ") || "aucun utilisateur")}</span></div>
              <p>${info.permissions}</p>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `);
}

function userAccessChecks(user = {}) {
  const access = user.access || [];
  return DEFAULT_ACCESS_LABELS.map(item => `
    <label class="mini-check"><input type="checkbox" name="access" value="${item}" ${access.includes(item) ? "checked" : ""} ${user.role === "admin" ? "disabled" : ""}>${item}</label>
  `).join("");
}

function renderSettingsUserCreate(error = "") {
  setRoute("user-create", true);
  app.innerHTML = shell(settingsTabs(`
    <div class="settings-section-head panel-config-head compact-head">
      <div><span class="pill">New account</span><h2>Create user</h2><p>Creation d'un compte simple avec role et permissions.</p></div>
      <button class="button" data-settings-tab="users">Back</button>
    </div>
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="admin-card focused-form-card">
      <form id="userCreatePageForm" class="form-grid">
        <div class="field"><label>Username</label><input name="username" required autofocus></div>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="optional"></div>
        <div class="field"><label>Password</label><input name="password" type="password" required></div>
        <div class="field"><label>Role</label><select name="role"><option value="operator">operator</option><option value="viewer">viewer</option><option value="admin">admin</option></select></div>
        <div class="access-grid full">${userAccessChecks({ access: ["dashboard", "containers", "images", "logs"], role: "operator" })}</div>
        <div class="actions full"><button class="button" type="button" data-settings-tab="users">Cancel</button><button class="button primary" type="submit">Create user</button></div>
      </form>
    </section>
  `));
}

function renderSettingsUserEdit(error = "") {
  const user = state.settings.users.find(item => item.id === state.editUserId);
  if (!user) {
    state.view = "settings";
    state.settingsTab = "users";
    return renderSettings();
  }
  setRoute("user-edit", true);
  app.innerHTML = shell(settingsTabs(`
    <div class="settings-section-head panel-config-head compact-head">
      <div><span class="pill">User</span><h2>Modify ${esc(user.username)}</h2><p>Compte, role, permissions et mot de passe.</p></div>
      <button class="button" data-settings-tab="users">Back</button>
    </div>
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <section class="admin-card focused-form-card">
      <form id="userEditPageForm" data-user-form="${esc(user.id)}" class="form-grid">
        <div class="field"><label>Username</label><input name="username" value="${esc(user.username)}"></div>
        <div class="field"><label>Email</label><input name="email" type="email" value="${esc(user.email || "")}" placeholder="optional"></div>
        <div class="field"><label>Enabled</label><select name="enabled"><option value="true" ${user.enabled === false ? "" : "selected"}>Yes</option><option value="false" ${user.enabled === false ? "selected" : ""}>No</option></select></div>
        <div class="field"><label>Role</label><select name="role"><option value="admin" ${user.role === "admin" ? "selected" : ""}>admin</option><option value="operator" ${user.role === "operator" ? "selected" : ""}>operator</option><option value="viewer" ${user.role === "viewer" ? "selected" : ""}>viewer</option></select></div>
        <div class="access-grid full">${userAccessChecks(user)}</div>
        <div class="field"><label>New password</label><input name="password" type="password" placeholder="optional"></div>
        <div class="field"><label>Confirm password</label><input name="passwordConfirm" type="password" placeholder="optional"></div>
        <div class="actions full"><button class="button" type="button" data-settings-tab="users">Cancel</button><button class="button primary" type="submit">Save changes</button>${user.id === state.session.userId ? '<span class="pill">Compte connecte</span>' : '<button class="button danger" type="button" data-remove-user="' + esc(user.id) + '">Delete</button>'}</div>
      </form>
    </section>
  `));
}
function renderSettingsConfig() {
  const options = state.settings.configOptions;
  return settingsTabs(`
    <div class="settings-section-head">
      <div>
        <h2>Config.json</h2>
        <p>Simple settings grouped by category. Import and export stay available for moving config between installs.</p>
      </div>
      <div class="actions">
        <button class="button" data-open-config-import>Import config</button>
        <button class="button" data-download-config>Telecharger</button>
      </div>
    </div>
    <form id="configOptionsForm" class="config-sections">
      <section class="sub-card"><h3>General</h3>
        <div class="form-grid">
          <div class="field"><label>Language</label><select name="language">${["en","fr","es","it","pt","de","nl"].map(lang => `<option value="${lang}" ${options.language === lang ? "selected" : ""}>${lang.toUpperCase()}</option>`).join("")}</select></div>
          <div class="field"><label>Refresh interval</label><input name="general.refreshInterval" type="range" min="5" max="120" value="${esc(options.general.refreshInterval)}"><small>${esc(options.general.refreshInterval)} seconds</small></div>
          <label class="check"><input type="checkbox" name="general.compactTables" ${options.general.compactTables ? "checked" : ""}> Compact tables</label>
          <label class="check"><input type="checkbox" name="general.showOfflineDockerWarning" ${options.general.showOfflineDockerWarning ? "checked" : ""}> Show Docker warning</label>
        </div>
      </section>
      <section class="sub-card"><h3>Security</h3>
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="security.requireCurrentPassword" ${options.security.requireCurrentPassword ? "checked" : ""}> Require current password</label>
          <label class="check"><input type="checkbox" name="security.notifyNewIp" ${options.security.notifyNewIp ? "checked" : ""}> Email alert for new IP</label>
          <div class="field"><label>Session hours</label><input name="security.sessionHours" type="number" min="1" max="72" value="${esc(options.security.sessionHours)}"></div>
          <label class="check"><input type="checkbox" name="security.allowRememberDevice" ${options.security.allowRememberDevice ? "checked" : ""}> Allow trusted device</label>
        </div>
      </section>
      <section class="sub-card"><h3>Logging</h3>
        <div class="form-grid">
          <div class="field"><label>Level</label><select name="logging.level">${["debug","info","warn","error"].map(level => `<option value="${level}" ${options.logging.level === level ? "selected" : ""}>${level}</option>`).join("")}</select></div>
          <div class="field"><label>Keep logs days</label><input name="logging.keepDays" type="number" min="1" max="365" value="${esc(options.logging.keepDays)}"></div>
          <div class="field"><label>Docker log tail</label><input name="logging.dockerLogTail" type="number" min="50" max="5000" value="${esc(options.logging.dockerLogTail)}"></div>
        </div>
      </section>
      <section class="sub-card"><h3>Monitoring</h3>
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="monitoring.enabled" ${options.monitoring.enabled ? "checked" : ""}> Enable monitoring</label>
          <div class="field"><label>CPU warning</label><input name="monitoring.cpuWarning" type="range" min="50" max="100" value="${esc(options.monitoring.cpuWarning)}"></div>
          <div class="field"><label>Memory warning</label><input name="monitoring.memoryWarning" type="range" min="50" max="100" value="${esc(options.monitoring.memoryWarning)}"></div>
        </div>
      </section>
      <section class="sub-card"><h3>Miscellaneous</h3>
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="miscellaneous.enableExperimental" ${options.miscellaneous.enableExperimental ? "checked" : ""}> Enable experimental features</label>
          <label class="check"><input type="checkbox" name="miscellaneous.confirmDangerousActions" ${options.miscellaneous.confirmDangerousActions ? "checked" : ""}> Confirm dangerous actions</label>
        </div>
      </section>
      <div class="config-footer">
        <button class="button primary" type="submit">Apply</button>
        <button class="button" type="button" data-download-config>Download config JSON</button>
      </div>
    </form>
    <div class="modal-backdrop hidden" id="configImportModal">
      <div class="modal-card">
        <h2>Import configuration</h2>
        <p>Load a compatible .json file, review the file name, then validate the upload.</p>
        <input type="file" id="configFile" accept=".json,application/json">
        <div class="actions">
          <button class="button" data-close-config-import>Cancel</button>
          <button class="button primary" data-confirm-config-import>Upload</button>
        </div>
      </div>
    </div>
  `);
}

function renderSettingsAppearance() {
  const data = state.settings;
  const opacity = Math.max(5, Math.min(95, Number(data.appearance.loginOpacity ?? 70)));
  return settingsTabs(`
    <form class="appearance-crafty" id="appearanceForm">
      <div class="crafty-head">
        <div>
          <h2>Personnaliser la page de Connexion</h2>
          <p>Reglage simple de l'icone, du fond et de la fenetre de connexion.</p>
        </div>
        <button class="button" type="button" data-reset-appearance>Appliquer les defauts</button>
      </div>

      <div class="appearance-builder">
        <div class="appearance-controls">
          <section class="crafty-section">
            <h3>Icone du site</h3>
            <p>Choisir une ICO ou une image pour le logo du panel.</p>
            <input class="hidden-file" type="file" id="iconFile" accept=".png,.jpg,.jpeg,.webp,.ico">
            <div class="crafty-upload">
              <span id="iconFileName">${esc(data.appearance.iconUrl || "Choisir l'icone du site")}</span>
              <button class="button" type="button" data-pick-icon>Browse</button>
            </div>
          </section>

          <section class="crafty-section">
            <h3>Image de fond</h3>
            <p>Importer l'image affichee derriere la page de connexion.</p>
            <input class="hidden-file" type="file" id="loginBgFile" accept=".png,.jpg,.jpeg,.webp">
            <div class="crafty-upload">
              <span id="loginBgFileName">Choisir l'image de fond</span>
              <button class="button" type="button" data-pick-login-bg>Browse</button>
            </div>
          </section>

          <section class="crafty-section">
            <h3>Fond selectionne</h3>
            <div class="crafty-control-stack">
              <label>Selected Background Image</label>
              <select name="loginBackground" data-background-select>
                <option value="/assets/login-bg.png" ${data.appearance.loginBackground === "/assets/login-bg.png" ? "selected" : ""}>Default server room background</option>
                ${data.appearance.loginBackground !== "/assets/login-bg.png" ? `<option value="${esc(data.appearance.loginBackground)}" selected>${esc(data.appearance.loginBackground)}</option>` : ""}
              </select>
            </div>
            <div class="crafty-control-stack">
              <div class="opacity-label">
                <label>Opacite de la fenetre de connexion</label>
                <strong id="opacityValue">${esc(opacity)}%</strong>
              </div>
              <input type="range" name="loginOpacity" min="5" max="95" value="${esc(opacity)}" data-opacity-slider>
              <small class="muted-text">Plus bas = fenêtre de connexion plus transparente.</small>
            </div>
          </section>

          <div class="appearance-actions">
            <button class="button danger" type="button" data-remove-login-bg>Supprimer</button>
            <button class="button primary" type="submit">Appliquer</button>
          </div>
        </div>

        <section class="crafty-preview-panel">
          <div class="preview-title">
            <h3>Apercu</h3>
            <span>Login screen</span>
          </div>
          <div class="login-preview" data-login-preview style="background-image:url('${esc(data.appearance.loginBackground)}')">
            <div class="preview-login-card" style="background-color:rgba(11,18,29,${opacity / 100}); --login-card-opacity:${opacity / 100}">
              <img src="${esc(data.appearance.iconUrl || "/assets/server-icon.png")}" alt="">
              <label>Nom d'utilisateur</label>
              <div class="fake-input">Nom d'utilisateur</div>
              <label>Mot de passe</label>
              <div class="fake-input">Mot de passe</div>
              <button type="button">Connexion</button>
              <a>Mot de passe oublie</a>
            </div>
          </div>
        </section>
      </div>

      <input type="hidden" name="panelName" value="${esc(data.panelName)}">
      <input type="hidden" name="tagline" value="${esc(data.tagline)}">
      <input type="hidden" name="primary" value="${esc(data.appearance.primary)}">
      <input type="hidden" name="accent" value="${esc(data.appearance.accent)}">
      <input type="hidden" name="density" value="${esc(data.appearance.density)}">
      <input type="hidden" name="background" value="${esc(data.appearance.background)}">
      <input type="hidden" name="iconUrl" value="${esc(data.appearance.iconUrl)}">
      <input type="hidden" name="loginHint" value="${data.loginHint ? "on" : ""}">
      <input type="hidden" name="currentUsername" value="${esc(state.session.username)}">
    </form>
  `);
}

function pluginRows() {
  return state.plugins.map(plugin => `
    <article class="extension-card">
      <div>
        <strong>${esc(plugin.name)}</strong>
        <span>${esc(plugin.originalName)} - ${bytes(plugin.size)}</span>
      </div>
      <span class="pill">.jar</span>
      <span class="badge ${plugin.enabled ? "ok" : "muted"}"><i></i>${plugin.enabled ? "enabled" : "disabled"}</span>
      <div class="row-actions">
        <button class="button" data-toggle-plugin="${esc(plugin.id)}" data-enabled="${plugin.enabled ? "false" : "true"}">${plugin.enabled ? "Disable" : "Enable"}</button>
        <button class="button danger" data-remove-plugin="${esc(plugin.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function renderSettingsPlugins(error = "") {
  return settingsTabs(`
    <div class="settings-section-head panel-config-head compact-head">
      <div>
        <span class="pill">Plugins</span>
        <h2>Plugin</h2>
        <p>Import de plugins .jar stockes dans le dossier data/plugins. Ils ne sont pas executes automatiquement.</p>
      </div>
      <button class="button primary" data-pick-plugin>Importer .jar</button>
    </div>
    ${error ? `<div class="notice">${esc(error)}</div>` : ""}
    <input class="hidden-file" id="pluginFile" type="file" accept=".jar,application/java-archive">
    <section class="card">
      <div class="card-head"><h2>Plugins importes</h2><span class="pill">${state.plugins.length} total</span></div>
      <div class="card-body extension-grid">${pluginRows() || '<div class="empty">Aucun plugin importe.</div>'}</div>
    </section>
  `);
}

function renderSettings() {
  setRoute("settings", true);
  if (state.settingsTab === "config") app.innerHTML = shell(renderSettingsConfig());
  else if (state.settingsTab === "appearance") app.innerHTML = shell(renderSettingsAppearance());
  else if (state.settingsTab === "plugins") app.innerHTML = shell(renderSettingsPlugins());
  else app.innerHTML = shell(renderSettingsUsers());
}

async function renderApp(error = "") {
  clearBlockingUi();
  if (!state.session?.authenticated) {
    if (state.view !== "login") {
      state.pendingView = state.view;
      state.pendingSettingsTab = state.settingsTab;
    }
    renderLogin(error);
    return;
  }
  if (state.view === "login") {
    state.view = "dashboard";
  }
  if (!canAccess(viewAccess(state.view))) {
    state.view = "dashboard";
    setRoute("dashboard", true);
  }
  if (state.view === "dashboard") {
    await loadDashboard();
    try {
      if (canAccess("containers")) await loadContainers();
      else state.containers = [];
    } catch {
      state.containers = [];
    }
    renderDashboard();
    loadVersionStatus().then(() => {
      document.querySelector(".version-pill")?.classList.toggle("update-available", Boolean(state.updateInfo?.updateAvailable));
      if (state.updateInfo?.version) document.querySelector(".version-pill").textContent = `v${state.updateInfo.version}`;
    }).catch(() => {});
    return;
  }
  if (state.view === "containers") {
    try {
      await loadDashboard();
      await loadContainers();
      renderContainers(error);
    } catch (err) {
      await loadDashboard();
      state.containers = [];
      renderContainers(err.message);
    }
    return;
  }
  if (state.view === "container-create") {
    try {
      await loadDashboard();
      await loadImages();
      renderContainerCreate(error);
    } catch (err) {
      await loadDashboard();
      state.images = [];
      renderContainerCreate(err.message);
    }
    return;
  }
  if (state.view === "container-detail") {
    renderContainerDetail(error);
    return;
  }
  if (state.view === "images") {
    try {
      await loadDashboard();
      await loadImages();
      renderImages(error);
    } catch (err) {
      await loadDashboard();
      state.images = [];
      renderImages(err.message);
    }
    return;
  }
  if (state.view === "extensions") {
    await loadDashboard();
    await loadExtensions();
    renderExtensions(error);
    return;
  }
  if (state.view === "logs") {
    await loadDashboard();
    await loadLogs();
    renderLogs(error);
    return;
  }
  if (state.view === "image-create") {
    try {
      await loadDashboard();
      await loadImages();
      renderImageCreate(error);
    } catch (err) {
      await loadDashboard();
      renderImageCreate(err.message);
    }
    return;
  }
  if (state.view === "settings") {
    await loadDashboard();
    await loadSettings();
    if (state.settingsTab === "plugins") await loadPlugins();
    renderSettings();
  }
  if (state.view === "user-create") {
    await loadDashboard();
    await loadSettings();
    renderSettingsUserCreate(error);
  }
  if (state.view === "user-edit") {
    await loadDashboard();
    await loadSettings();
    renderSettingsUserEdit(error);
  }
}

async function containerAction(action, id) {
  if (action === "remove" && !confirm("Supprimer ce conteneur ?")) return;
  if (action === "recreate" && !confirm("Recreer ce conteneur avec l'image la plus recente disponible ?")) return;
  const method = action === "remove" ? "DELETE" : "POST";
  await api(`/api/containers/${encodeURIComponent(id)}/${action}`, { method });
  toast("Action executee.");
  state.view = "containers";
  await renderApp();
}

async function openContainer(id) {
  const item = state.containers.find(container => container.id === id);
  state.selectedContainer = item;
  state.selectedInspect = await api(`/api/containers/${encodeURIComponent(id)}/inspect`);
  const logs = await api(`/api/containers/${encodeURIComponent(id)}/logs`);
  state.selectedLogs = logs.logs || "";
  state.view = "container-detail";
  await renderApp();
}

function bindDropzone() {
  const zone = document.querySelector("#dropzone");
  const input = document.querySelector("#imageFile");
  const output = document.querySelector("#imageOutput");
  const upload = async file => {
    if (!file) return;
    output.textContent = `Import de ${file.name}...`;
    try {
      const result = await api("/api/images/import", { method: "POST", body: file });
      output.textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      toast("Image importee.");
      await loadImages();
      renderImages();
    } catch (error) {
      output.textContent = error.message;
      toast(error.message);
    }
  };
  if (zone && input) {
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", event => {
      event.preventDefault();
      zone.classList.remove("dragover");
      upload(event.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => upload(input.files[0]));
  }

  const buildZone = document.querySelector("#buildDropzone");
  const buildInput = document.querySelector("#buildFiles");
  const buildLabel = document.querySelector("#buildFilesLabel");
  if (!buildZone || !buildInput) return;
  const updateBuildLabel = files => {
    state.pendingBuildFiles = files ? Array.from(files) : null;
    const count = state.pendingBuildFiles?.length || 0;
    if (buildLabel) buildLabel.textContent = count ? `${count} file(s) selected. Build auto pret.` : "Choisis le dossier complet. Si un Dockerfile existe, il sera utilise automatiquement.";
  };
  buildZone.addEventListener("dragover", event => {
    event.preventDefault();
    buildZone.classList.add("dragover");
  });
  buildZone.addEventListener("dragleave", () => buildZone.classList.remove("dragover"));
  buildZone.addEventListener("drop", event => {
    event.preventDefault();
    buildZone.classList.remove("dragover");
    updateBuildLabel(event.dataTransfer.files);
  });
  buildInput.addEventListener("change", () => updateBuildLabel(buildInput.files));
}

function imageExposedPorts(inspect) {
  return Object.keys(inspect?.Config?.ExposedPorts || {}).map(port => {
    const [number, protocol = "tcp"] = port.split("/");
    return `${number}:${number}/${protocol}`;
  });
}

function imageVolumes(inspect) {
  return Object.keys(inspect?.Config?.Volumes || {}).map(path => `./data${path}:${path}`);
}

function imageEnv(inspect) {
  return (inspect?.Config?.Env || []).filter(line => !/^PATH=/.test(line)).slice(0, 12);
}

function bindContainerImagePrefill() {
  const select = document.querySelector("#containerImageSelect");
  const form = document.querySelector("#containerForm");
  const hint = document.querySelector("#imageMetaHint");
  if (!select || !form) return;
  select.addEventListener("change", async () => {
    const image = select.value;
    if (!image) return;
    try {
      if (hint) hint.textContent = "Lecture des infos de l'image...";
      const inspect = await api(`/api/images/inspect?image=${encodeURIComponent(image)}`);
      const ports = imageExposedPorts(inspect);
      const volumes = imageVolumes(inspect);
      const env = imageEnv(inspect);
      if (ports.length && !form.elements.ports.value.trim()) form.elements.ports.value = ports.join("\n");
      if (volumes.length && !form.elements.volumes.value.trim()) form.elements.volumes.value = volumes.join("\n");
      if (env.length && !form.elements.env.value.trim()) form.elements.env.value = env.join("\n");
      if (hint) hint.textContent = ports.length || volumes.length || env.length
        ? `Image chargee: ${ports.length} port(s), ${volumes.length} volume(s), ${env.length} variable(s) detectes.`
        : "Image chargee: aucune metadata port/volume/env detectee.";
    } catch (error) {
      if (hint) hint.textContent = `Impossible de lire l'image: ${error.message}`;
    }
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function applyConfigObject(config) {
  await api("/api/settings/config", { method: "POST", body: config });
  await loadSession();
  toast("Configuration appliquee.");
  await renderApp();
}

document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === "loginForm") {
      await api("/api/login", { method: "POST", body: values });
      await loadSession();
      state.view = state.pendingView && state.pendingView !== "login" ? state.pendingView : "dashboard";
      if (state.pendingSettingsTab) state.settingsTab = state.pendingSettingsTab;
      state.pendingView = null;
      state.pendingSettingsTab = null;
      await renderApp();
    }
    if (form.id === "containerForm") {
      const image = values.imageCustom?.trim() || values.imageSelect?.trim();
      if (!image) throw new Error("Choose or type an image.");
      await api("/api/containers", { method: "POST", body: { ...values, image, start: true } });
      toast("Conteneur cree.");
      state.view = "containers";
      await renderApp();
    }
    if (form.id === "pullForm") {
      const output = document.querySelector("#imageOutput");
      output.textContent = `Telechargement de ${values.image}...`;
      const result = await api("/api/images/pull", { method: "POST", body: { ...values, name: document.querySelector("#imageDisplayName")?.value || "" } });
      output.textContent = result.output || "Image telechargee.";
      toast("Image telechargee.");
      await loadImages();
      state.view = "images";
      await renderApp();
    }
    if (form.id === "buildForm") {
      const output = document.querySelector("#imageOutput");
      const name = document.querySelector("#imageDisplayName")?.value.trim();
      if (!name) throw new Error("Image name / tag required.");
      output.textContent = "Preparing build context...";
      const files = await buildFilesPayload(document.querySelector("#buildFiles"));
      if (!files.length) throw new Error("Choose project files first.");
      const dockerfile = autoDockerfile(files);
      output.textContent = `Building ${name}...`;
      const result = await api("/api/images/build", { method: "POST", body: { name, dockerfile, files } });
      output.textContent = `${result.tag || name}\n\n${result.output || "Image built."}`;
      toast(`Image construite: ${result.tag || name}`);
      state.pendingBuildFiles = null;
      await loadImages();
      state.view = "images";
      await renderApp();
    }
    if (form.id === "settingsForm") {
      values.loginHint = Boolean(values.loginHint);
      await api("/api/settings", { method: "POST", body: values });
      await loadSession();
      toast("Parametres enregistres.");
      await renderApp();
    }
    if (form.id === "configOptionsForm") {
      await api("/api/settings/config", {
        method: "POST",
        body: { configOptions: formToConfigOptions(form) }
      });
      toast("Configuration applied.");
      await renderApp();
    }
    if (form.id === "appearanceForm") {
      const data = Object.fromEntries(new FormData(form).entries());
      const iconUrl = await uploadAsset("/api/settings/icon", document.querySelector("#iconFile"));
      const loginBackground = await uploadAsset("/api/settings/login-background", document.querySelector("#loginBgFile"));
      if (iconUrl) data.iconUrl = iconUrl;
      if (loginBackground) data.loginBackground = loginBackground;
      data.loginHint = Boolean(data.loginHint);
      await api("/api/settings", { method: "POST", body: data });
      await loadSession();
      toast("Appearance applied.");
      await renderApp();
    }
    if (form.id === "userForm") {
      await api("/api/settings/users", { method: "POST", body: values });
      toast("Utilisateur cree.");
      await renderApp();
    }
    if (form.id === "userCreatePageForm") {
      const access = Array.from(form.querySelectorAll('input[name="access"]:checked')).map(input => input.value);
      await api("/api/settings/users", { method: "POST", body: { ...values, access } });
      toast("Utilisateur cree.");
      state.view = "settings";
      state.settingsTab = "users";
      await renderApp();
    }
    if (form.id === "parameterForm") {
      await api("/api/settings/config/parameter", { method: "POST", body: values });
      toast("Parametre insere.");
      await renderApp();
    }
    if (form.id === "dashboardLinkForm") {
      const iconUrl = await uploadAsset("/api/dashboard-links/icon", document.querySelector("#dashboardIconFile"));
      const link = await api("/api/dashboard-links", { method: "POST", body: { ...values, iconUrl } });
      await loadDashboard();
      await addDashboardTile(`app:${link.id}`, "small");
      toast("Lien ajoute.");
      document.querySelector("#dashboardAddModal")?.classList.add("hidden");
      await renderApp();
    }
    if (form.id === "dashboardAutomationForm") {
      const containerIds = Array.from(form.querySelectorAll('input[name="containerIds"]:checked')).map(input => input.value);
      const automation = await api("/api/dashboard-automations", { method: "POST", body: { title: values.title, action: values.action, containerIds } });
      await loadDashboard();
      await addDashboardTile(`automation:${automation.id}`, "medium");
      toast("Automatisation ajoutee.");
      document.querySelector("#dashboardAddModal")?.classList.add("hidden");
      await renderApp();
    }
    if (form.dataset.userForm) {
      const access = Array.from(form.querySelectorAll('input[name="access"]:checked')).map(input => input.value);
      if (values.password || values.passwordConfirm) {
        if (values.password !== values.passwordConfirm) throw new Error("Les mots de passe ne correspondent pas.");
      }
      await api(`/api/settings/users/${encodeURIComponent(form.dataset.userForm)}`, {
        method: "POST",
        body: { username: values.username, email: values.email, role: values.role, enabled: values.enabled !== "false", password: values.password, access }
      });
      toast("Utilisateur mis a jour.");
      await renderApp();
    }
  } catch (error) {
    if (form.id === "loginForm") renderLogin(error.message);
    else toast(error.message);
  }
});

document.addEventListener("change", async event => {
  if (event.target.id === "configFile") {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state.pendingImportedConfig = parsed;
      toast(`Config loaded: ${file.name}. Click Upload to apply.`);
    } catch (error) {
      toast(`Config invalide : ${error.message}`);
    }
  }
  if (event.target.id === "extensionFile") {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const manifest = JSON.parse(await file.text());
      await api("/api/extensions", { method: "POST", body: manifest });
      toast("Extension imported.");
      await loadExtensions();
      renderExtensions();
    } catch (error) {
      toast(`Extension invalide : ${error.message}`);
    }
  }
  if (event.target.id === "pluginFile") {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await api(`/api/plugins?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      toast("Plugin importe.");
      await loadPlugins();
      renderSettings();
    } catch (error) {
      toast(error.message);
    }
  }
  if (event.target.matches("[data-opacity-slider]")) {
    document.querySelector("#opacityValue").textContent = `${event.target.value}%`;
    const preview = document.querySelector(".preview-login-card");
    if (preview) {
      const opacity = Number(event.target.value) / 100;
      preview.style.backgroundColor = `rgba(11,18,29,${opacity})`;
      preview.style.setProperty("--login-card-opacity", opacity);
    }
  }
  if (event.target.id === "iconFile") {
    const file = event.target.files[0];
    if (!file) return;
    document.querySelector("#iconFileName").textContent = file.name;
    const previewIcon = document.querySelector(".preview-login-card img");
    if (previewIcon) previewIcon.src = URL.createObjectURL(file);
  }
  if (event.target.id === "loginBgFile") {
    const file = event.target.files[0];
    if (!file) return;
    document.querySelector("#loginBgFileName").textContent = file.name;
    const preview = document.querySelector("[data-login-preview]");
    if (preview) preview.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
  }
  if (event.target.matches("[data-background-select]")) {
    const preview = document.querySelector("[data-login-preview]");
    if (preview) preview.style.backgroundImage = `url('${event.target.value}')`;
  }
  if (event.target.name === "imageMode") {
    document.body.dataset.imageMode = event.target.value;
  }
});

document.addEventListener("dragstart", event => {
  const tile = event.target.closest("[data-dashboard-tile]");
  if (!tile || !state.dashboardEditing) return;
  state.dashboardDragTile = tile.dataset.dashboardTile;
  tile.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

document.addEventListener("dragover", event => {
  const tile = event.target.closest("[data-dashboard-tile]");
  if (!tile || !state.dashboardDragTile || tile.dataset.dashboardTile === state.dashboardDragTile) return;
  event.preventDefault();
  tile.classList.add("drag-over");
});

document.addEventListener("dragleave", event => {
  event.target.closest("[data-dashboard-tile]")?.classList.remove("drag-over");
});

document.addEventListener("drop", async event => {
  const tile = event.target.closest("[data-dashboard-tile]");
  if (!tile || !state.dashboardDragTile) return;
  event.preventDefault();
  const target = tile.dataset.dashboardTile;
  const source = state.dashboardDragTile;
  document.querySelectorAll(".dragging,.drag-over").forEach(node => node.classList.remove("dragging", "drag-over"));
  state.dashboardDragTile = null;
  if (source === target) return;
  const layout = orderedDashboardWidgets();
  const order = layout.order.filter(item => item !== source);
  const index = order.indexOf(target);
  order.splice(index < 0 ? order.length : index, 0, source);
  layout.order = order;
  await saveDashboardLayout(layout);
  await renderApp();
});

document.addEventListener("dragend", () => {
  state.dashboardDragTile = null;
  document.querySelectorAll(".dragging,.drag-over").forEach(node => node.classList.remove("dragging", "drag-over"));
});

document.addEventListener("pointerdown", event => {
  const grip = event.target.closest("[data-resize-grip]");
  if (!grip || !state.dashboardEditing) return;
  event.preventDefault();
  state.dashboardResize = { id: grip.dataset.resizeGrip, startX: event.clientX };
  grip.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointerup", async event => {
  if (!state.dashboardResize) return;
  const { id, startX } = state.dashboardResize;
  state.dashboardResize = null;
  const delta = event.clientX - startX;
  if (Math.abs(delta) < 28) return;
  const layout = orderedDashboardWidgets();
  layout.sizes = resizedWidgets(layout.sizes, id, delta > 0 ? "up" : "down");
  await saveDashboardLayout(layout);
  await renderApp();
});

document.addEventListener("click", async event => {
  if (event.target.closest("[data-hard-reload]")) {
    location.href = "/login?fresh=" + Date.now();
    return;
  }
  if (event.target.closest("[data-force-login]")) {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "/login?fresh=" + Date.now();
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    if (state.view === "settings") state.settingsTab = "users";
    setRoute(state.view);
    await renderApp();
    return;
  }
  const settingsTab = event.target.closest("[data-settings-tab]");
  if (settingsTab) {
    state.settingsTab = settingsTab.dataset.settingsTab;
    setRoute("settings");
    await renderApp();
    return;
  }
  const editUser = event.target.closest("[data-edit-user]");
  if (editUser) {
    const row = document.querySelector(`.user-config-row[data-user-form="${CSS.escape(editUser.dataset.editUser)}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("flash");
    setTimeout(() => row?.classList.remove("flash"), 1200);
    return;
  }
  const editUserPage = event.target.closest("[data-edit-user-page]");
  if (editUserPage) {
    state.view = "user-edit";
    state.editUserId = editUserPage.dataset.editUserPage;
    setRoute("user-edit");
    await renderApp();
    return;
  }
  const containerOpen = event.target.closest("[data-open-container]");
  if (containerOpen) {
    try {
      await openContainer(containerOpen.dataset.openContainer);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const action = event.target.closest("[data-container-action]");
  if (action) {
    try {
      await containerAction(action.dataset.containerAction, action.dataset.id);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (event.target.closest("[data-refresh-containers]")) return renderApp();
  if (event.target.closest("[data-refresh-images]")) return renderApp();
  if (event.target.closest("#refreshBtn")) {
    await renderApp();
    toast("Dashboard rafraichi.");
    return;
  }
  if (event.target.closest("[data-check-update]")) {
    try {
      const info = await loadVersionStatus(true);
      await renderApp();
      if (info.updateAvailable && canAccess("settings") && confirm("Une mise a jour est disponible. Telecharger la derniere image Docker maintenant ?")) {
        const result = await api("/api/version/pull", { method: "POST" });
        toast(result.message || "Image mise a jour.");
      } else {
        toast(info.updateAvailable ? `Mise a jour disponible (${info.status || "outdated"}).` : "Version a jour.");
      }
    } catch (error) {
      toast(`Update check impossible : ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-toggle-dashboard-edit]")) {
    state.dashboardEditing = !state.dashboardEditing;
    await renderApp();
    return;
  }
  if (event.target.closest("[data-toggle-dashboard-add]")) {
    document.querySelector("#dashboardAddModal")?.classList.remove("hidden");
    return;
  }
  if (event.target.closest("[data-close-dashboard-add]")) {
    document.querySelector("#dashboardAddModal")?.classList.add("hidden");
    return;
  }
  const addWidget = event.target.closest("[data-add-widget]");
  if (addWidget) {
    const sizes = { clock: "small", status: "large", containers: "large", actions: "medium" };
    await addDashboardTile(addWidget.dataset.addWidget, sizes[addWidget.dataset.addWidget] || "medium");
    document.querySelector("#dashboardAddModal")?.classList.add("hidden");
    await renderApp();
    return;
  }
  const addAppTile = event.target.closest("[data-add-app-tile]");
  if (addAppTile) {
    await addDashboardTile(`app:${addAppTile.dataset.addAppTile}`, "small");
    document.querySelector("#dashboardAddModal")?.classList.add("hidden");
    await renderApp();
    return;
  }
  const runAutomation = event.target.closest("[data-run-automation]");
  if (runAutomation) {
    await api(`/api/dashboard-automations/${encodeURIComponent(runAutomation.dataset.runAutomation)}/run`, { method: "POST" });
    toast("Automatisation executee.");
    await renderApp();
    return;
  }
  const moveWidget = event.target.closest("[data-move-widget]");
  if (moveWidget) {
    const layout = orderedDashboardWidgets();
    layout.order = movedList(layout.order, moveWidget.dataset.moveWidget, moveWidget.dataset.direction);
    await saveDashboardLayout(layout);
    await renderApp();
    return;
  }
  const resizeWidget = event.target.closest("[data-resize-widget]");
  if (resizeWidget) {
    const layout = orderedDashboardWidgets();
    layout.sizes = resizedWidgets(layout.sizes, resizeWidget.dataset.resizeWidget, resizeWidget.dataset.direction);
    await saveDashboardLayout(layout);
    await renderApp();
    return;
  }
  const hideWidget = event.target.closest("[data-hide-widget]");
  if (hideWidget) {
    const layout = orderedDashboardWidgets();
    if (!layout.hidden.includes(hideWidget.dataset.hideWidget)) layout.hidden.push(hideWidget.dataset.hideWidget);
    await saveDashboardLayout(layout);
    await renderApp();
    return;
  }
  const showWidget = event.target.closest("[data-show-widget]");
  if (showWidget) {
    const layout = orderedDashboardWidgets();
    layout.hidden = layout.hidden.filter(item => item !== showWidget.dataset.showWidget);
    await saveDashboardLayout(layout);
    await renderApp();
    return;
  }
  const moveDashboardLink = event.target.closest("[data-move-dashboard-link]");
  if (moveDashboardLink) {
    const ids = movedList((state.dashboard?.dashboardLinks || []).map(link => link.id), moveDashboardLink.dataset.moveDashboardLink, moveDashboardLink.dataset.direction);
    await api("/api/dashboard-links/order", { method: "POST", body: { ids } });
    await renderApp();
    return;
  }
  if (event.target.closest("[data-pick-file]")) {
    document.querySelector("#imageFile")?.click();
    return;
  }
  if (event.target.closest("[data-pick-extension]")) {
    document.querySelector("#extensionFile")?.click();
    return;
  }
  if (event.target.closest("[data-pick-plugin]")) {
    document.querySelector("#pluginFile")?.click();
    return;
  }
  if (event.target.closest("[data-pick-build-files]")) {
    document.querySelector("#buildFiles")?.click();
    return;
  }
  if (event.target.closest("[data-pick-icon]")) {
    document.querySelector("#iconFile")?.click();
    return;
  }
  if (event.target.closest("[data-pick-login-bg]")) {
    document.querySelector("#loginBgFile")?.click();
    return;
  }
  if (event.target.closest("[data-pick-config]")) {
    document.querySelector("#configFile")?.click();
    return;
  }
  if (event.target.closest("[data-open-config-import]")) {
    document.querySelector("#configImportModal")?.classList.remove("hidden");
    return;
  }
  if (event.target.closest("[data-close-config-import]")) {
    document.querySelector("#configImportModal")?.classList.add("hidden");
    return;
  }
  if (event.target.closest("[data-confirm-config-import]")) {
    const file = document.querySelector("#configFile")?.files?.[0];
    if (!file) return toast("Choose a JSON file first.");
    try {
      const parsed = state.pendingImportedConfig || JSON.parse(await file.text());
      await applyConfigObject(parsed);
    } catch (error) {
      toast(`Invalid config: ${error.message}`);
    }
    return;
  }
  if (event.target.closest("[data-download-config]")) {
    downloadJson("nodepilot-config.json", state.configJson || {});
    return;
  }
  if (event.target.closest("[data-apply-config-editor]")) {
    return;
  }
  if (event.target.closest("[data-reset-appearance]")) {
    await api("/api/settings/config", {
      method: "POST",
      body: {
        panelName: "NodePilot",
        tagline: "Un panel propre pour piloter ton serveur.",
        loginHint: true,
        appearance: { primary: "#38bdf8", accent: "#60a5fa", density: "comfortable", background: "server-room", loginOpacity: 78, loginBackground: "/assets/login-bg.png", iconUrl: "/assets/server-icon.png" }
      }
    });
    toast("Apparence par defaut appliquee.");
    await renderApp();
    return;
  }
  if (event.target.closest("[data-remove-login-bg]")) {
    await api("/api/settings/config", { method: "POST", body: { appearance: { loginBackground: "/assets/login-bg.png" } } });
    toast("Background removed.");
    await renderApp();
    return;
  }
  const logsButton = event.target.closest("[data-load-logs]");
  if (logsButton) {
    const logs = await api(`/api/containers/${encodeURIComponent(logsButton.dataset.loadLogs)}/logs`);
    state.selectedLogs = logs.logs || "";
    await renderApp();
    return;
  }
  const removeImage = event.target.closest("[data-remove-image]");
  if (removeImage) {
    if (!confirm("Supprimer cette image ?")) return;
    await api(`/api/images/${encodeURIComponent(removeImage.dataset.removeImage)}`, { method: "DELETE" });
    toast("Image supprimee.");
    await renderApp();
    return;
  }
  const toggleExtension = event.target.closest("[data-toggle-extension]");
  if (toggleExtension) {
    await api(`/api/extensions/${encodeURIComponent(toggleExtension.dataset.toggleExtension)}`, {
      method: "POST",
      body: { enabled: toggleExtension.dataset.enabled === "true" }
    });
    toast("Extension updated.");
    await renderApp();
    return;
  }
  const removeExtension = event.target.closest("[data-remove-extension]");
  if (removeExtension) {
    if (!confirm("Supprimer cette extension ?")) return;
    await api(`/api/extensions/${encodeURIComponent(removeExtension.dataset.removeExtension)}`, { method: "DELETE" });
    toast("Extension removed.");
    await renderApp();
    return;
  }
  const togglePlugin = event.target.closest("[data-toggle-plugin]");
  if (togglePlugin) {
    await api(`/api/plugins/${encodeURIComponent(togglePlugin.dataset.togglePlugin)}`, {
      method: "POST",
      body: { enabled: togglePlugin.dataset.enabled === "true" }
    });
    toast("Plugin updated.");
    await loadPlugins();
    renderSettings();
    return;
  }
  const removePlugin = event.target.closest("[data-remove-plugin]");
  if (removePlugin) {
    if (!confirm("Supprimer ce plugin ?")) return;
    await api(`/api/plugins/${encodeURIComponent(removePlugin.dataset.removePlugin)}`, { method: "DELETE" });
    toast("Plugin supprime.");
    await loadPlugins();
    renderSettings();
    return;
  }
  const removeDashboardLink = event.target.closest("[data-remove-dashboard-link]");
  if (removeDashboardLink) {
    await api(`/api/dashboard-links/${encodeURIComponent(removeDashboardLink.dataset.removeDashboardLink)}`, { method: "DELETE" });
    toast("Lien supprime.");
    await renderApp();
    return;
  }
  const removeUser = event.target.closest("[data-remove-user]");
  if (removeUser) {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    await api(`/api/settings/users/${encodeURIComponent(removeUser.dataset.removeUser)}`, { method: "DELETE" });
    toast("Utilisateur supprime.");
    await renderApp();
    return;
  }
  if (event.target.closest("#logoutBtn")) {
    await api("/api/logout", { method: "POST" });
    state.session = { authenticated: false, config: state.session.config };
    state.dashboard = null;
    setRoute("login");
    renderLogin();
  }
});

window.addEventListener("popstate", async () => {
  readRoute();
  await renderApp();
});

setInterval(() => {
  document.querySelectorAll(".clock-time").forEach(node => {
    node.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  });
}, 1000);

(async function start() {
  try {
    clearBlockingUi();
    readRoute();
    await loadSession();
    if (!state.session.authenticated) {
      if (state.view !== "login") {
        state.pendingView = state.view;
        state.pendingSettingsTab = state.settingsTab;
      }
      renderLogin();
      return;
    }
    await renderApp();
  } catch (error) {
    renderFatal(error.message);
  }
})();

window.addEventListener("error", event => {
  renderFatal(event.message);
});

window.addEventListener("unhandledrejection", event => {
  renderFatal(event.reason?.message || String(event.reason || "Unhandled error"));
});






