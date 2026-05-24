const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { URL } = require("url");
const packageInfo = require("../package.json");

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const AUDIT_PATH = path.join(DATA_DIR, "audit-log.json");
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || (process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock");
const APP_VERSION = process.env.APP_VERSION || packageInfo.version || "0.0.0";
const APP_COMMIT = process.env.APP_COMMIT || "local";
const APP_IMAGE = process.env.APP_IMAGE || "ghcr.io/jeanparant2-coder/panel_server:latest";
const APP_REPO = process.env.APP_REPO || "jeanparant2-coder/panel_server";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_ASSETS_DIR = path.join(DATA_DIR, "assets");
const PLUGINS_DIR = path.join(DATA_DIR, "plugins");

const sessions = new Map();
const DEFAULT_ACCESS = ["dashboard", "containers", "images", "logs", "extensions", "settings"];
const OPERATOR_ACCESS = ["dashboard", "containers", "images", "logs"];
const VIEWER_ACCESS = ["dashboard"];
const DASHBOARD_WIDGETS = ["clock", "status", "containers", "actions"];
const DASHBOARD_SIZES = new Set(["small", "medium", "large", "wide"]);
const DEFAULT_DASHBOARD_SIZES = {
  clock: "small",
  status: "large",
  actions: "medium",
  containers: "large"
};
const DEFAULT_CONFIG_OPTIONS = {
  language: "en",
  general: {
    refreshInterval: 15,
    compactTables: false,
    showOfflineDockerWarning: true
  },
  security: {
    requireCurrentPassword: true,
    notifyNewIp: true,
    sessionHours: 8,
    allowRememberDevice: false
  },
  logging: {
    level: "info",
    keepDays: 14,
    dockerLogTail: 400
  },
  monitoring: {
    enabled: true,
    cpuWarning: 80,
    memoryWarning: 85
  },
  miscellaneous: {
    enableExperimental: false,
    confirmDangerousActions: true
  }
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

function readJson(req, max = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > max) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: crypto.scryptSync(String(password), salt, 64).toString("hex")
  };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const current = Buffer.from(user.passwordHash, "hex");
  const candidate = Buffer.from(hashPassword(password, user.salt).hash, "hex");
  return current.length === candidate.length && crypto.timingSafeEqual(current, candidate);
}

function roleDefaultAccess(role) {
  if (role === "admin") return [...DEFAULT_ACCESS];
  if (role === "operator") return [...OPERATOR_ACCESS];
  return [...VIEWER_ACCESS];
}

function makeUser(username, password, role = "admin", passwordChanged = true) {
  const hashed = hashPassword(password);
  return {
    id: crypto.randomUUID(),
    username,
    role,
    email: "",
    enabled: true,
    access: roleDefaultAccess(role),
    salt: hashed.salt,
    passwordHash: hashed.hash,
    passwordChanged,
    createdAt: new Date().toISOString()
  };
}

function publicConfig(config) {
  return {
    panelName: config.panelName,
    tagline: config.tagline,
    loginHint: config.loginHint,
    appearance: config.appearance,
    configOptions: config.configOptions,
    dashboardLinks: config.dashboardLinks || [],
    dashboardAutomations: config.dashboardAutomations || [],
    plugins: config.plugins || [],
    dashboardLayout: config.dashboardLayout || { order: [...DASHBOARD_WIDGETS], hidden: [], sizes: DEFAULT_DASHBOARD_SIZES },
    version: {
      version: APP_VERSION,
      commit: APP_COMMIT,
      image: APP_IMAGE,
      repo: APP_REPO
    },
    defaultCredentials: config.users.some(user => user.username === "admin" && !user.passwordChanged)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    email: user.email || "",
    enabled: user.enabled !== false,
    access: user.role === "admin" ? [...DEFAULT_ACCESS] : (user.access || roleDefaultAccess(user.role)),
    passwordChanged: user.passwordChanged,
    createdAt: user.createdAt
  };
}

function dashboardTileIds(config) {
  return [
    ...DASHBOARD_WIDGETS,
    ...(config.dashboardLinks || []).map(link => `app:${link.id}`),
    ...(config.dashboardAutomations || []).map(item => `automation:${item.id}`)
  ];
}

function defaultDashboardSize(tileId) {
  if (tileId.startsWith("app:")) return "small";
  if (tileId.startsWith("automation:")) return "medium";
  return DEFAULT_DASHBOARD_SIZES[tileId] || "medium";
}

function normalizeDashboardLayout(config, layout = {}) {
  const allowed = dashboardTileIds(config);
  const inputOrder = Array.isArray(layout.order) ? layout.order.map(String) : [];
  const inputHidden = Array.isArray(layout.hidden) ? layout.hidden.map(String) : [];
  const inputSizes = layout.sizes && typeof layout.sizes === "object" ? layout.sizes : {};
  const order = inputOrder.filter(item => allowed.includes(item));
  const hidden = inputHidden.filter(item => allowed.includes(item));
  for (const widget of DASHBOARD_WIDGETS) {
    if (!order.includes(widget) && !hidden.includes(widget)) order.push(widget);
  }
  const sizes = Object.fromEntries(allowed.map(item => {
    const size = inputSizes[item];
    return [item, DASHBOARD_SIZES.has(size) ? size : defaultDashboardSize(item)];
  }));
  return { order, hidden, sizes };
}

async function writeConfig(config) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function readConfig() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(DATA_ASSETS_DIR, { recursive: true });
  await fsp.mkdir(PLUGINS_DIR, { recursive: true });
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(CONFIG_PATH, "utf8"));
  } catch {
    raw = {};
  }

  const defaultUser = makeUser("admin", "admin", "admin", false);
  const migratedUsers = raw.users || (raw.account ? [{
    id: crypto.randomUUID(),
    username: raw.account.username || "admin",
    role: "admin",
    access: [...DEFAULT_ACCESS],
    salt: raw.account.salt,
    passwordHash: raw.account.passwordHash,
    passwordChanged: Boolean(raw.account.passwordChanged),
    createdAt: raw.createdAt || new Date().toISOString()
  }] : [defaultUser]);

  const config = {
    panelName: raw.panelName || "NodePilot",
    tagline: raw.tagline || "Un panel propre pour piloter ton serveur.",
    loginHint: raw.loginHint ?? true,
    appearance: {
      primary: raw.appearance?.primary || "#38bdf8",
      accent: raw.appearance?.accent || "#60a5fa",
      density: raw.appearance?.density || "comfortable",
      background: raw.appearance?.background || "server-room",
      loginOpacity: Number(raw.appearance?.loginOpacity ?? 78),
      loginBackground: raw.appearance?.loginBackground || "/assets/login-bg.png",
      iconUrl: raw.appearance?.iconUrl || "/assets/server-icon.png"
    },
    configOptions: {
      ...DEFAULT_CONFIG_OPTIONS,
      ...(raw.configOptions || {}),
      general: { ...DEFAULT_CONFIG_OPTIONS.general, ...(raw.configOptions?.general || {}) },
      security: { ...DEFAULT_CONFIG_OPTIONS.security, ...(raw.configOptions?.security || {}) },
      logging: { ...DEFAULT_CONFIG_OPTIONS.logging, ...(raw.configOptions?.logging || {}) },
      monitoring: { ...DEFAULT_CONFIG_OPTIONS.monitoring, ...(raw.configOptions?.monitoring || {}) },
      miscellaneous: { ...DEFAULT_CONFIG_OPTIONS.miscellaneous, ...(raw.configOptions?.miscellaneous || {}) }
    },
    users: migratedUsers,
    extensions: Array.isArray(raw.extensions) ? raw.extensions : [],
    plugins: Array.isArray(raw.plugins) ? raw.plugins : [],
    dashboardLinks: Array.isArray(raw.dashboardLinks) ? raw.dashboardLinks : [],
    dashboardAutomations: Array.isArray(raw.dashboardAutomations) ? raw.dashboardAutomations : [],
    dashboardLayout: {
      order: Array.isArray(raw.dashboardLayout?.order) ? raw.dashboardLayout.order : [...DASHBOARD_WIDGETS],
      hidden: Array.isArray(raw.dashboardLayout?.hidden) ? raw.dashboardLayout.hidden : [],
      sizes: raw.dashboardLayout?.sizes && typeof raw.dashboardLayout.sizes === "object" ? raw.dashboardLayout.sizes : {}
    },
    createdAt: raw.createdAt || new Date().toISOString()
  };
  config.dashboardLayout = normalizeDashboardLayout(config, config.dashboardLayout);
  config.users = config.users.map(user => ({
    ...user,
    id: user.id || crypto.randomUUID(),
    role: user.role || "admin",
    email: user.email || "",
    enabled: user.enabled !== false,
    access: (user.role || "admin") === "admin" ? [...DEFAULT_ACCESS] : (Array.isArray(user.access) ? user.access.filter(item => DEFAULT_ACCESS.includes(item)) : roleDefaultAccess(user.role)),
    createdAt: user.createdAt || new Date().toISOString()
  }));
  await writeConfig(config);
  return config;
}

function getCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value || "");
  }
  return "";
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    access: user.role === "admin" ? [...DEFAULT_ACCESS] : (user.access || roleDefaultAccess(user.role)),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8
  });
  return token;
}

function readSession(req) {
  const token = getCookie(req, "panel_session");
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    send(res, 401, { error: "Authentication required" });
    return null;
  }
  return session;
}

function hasAccess(session, area) {
  if (!session) return false;
  if (session.role === "admin") return true;
  return Array.isArray(session.access) && session.access.includes(area);
}

function requireAccess(req, res, area) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!hasAccess(session, area)) {
    send(res, 403, { error: "Acces refuse pour ce role" });
    return null;
  }
  return session;
}

function adminCount(config) {
  return config.users.filter(user => user.role === "admin" && user.enabled !== false).length;
}

async function readAuditLog() {
  try {
    const items = JSON.parse(await fsp.readFile(AUDIT_PATH, "utf8"));
    return Array.isArray(items) ? items.slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function writeAuditLog(items) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(AUDIT_PATH, JSON.stringify(items.slice(0, 20), null, 2));
}

async function audit(session, action, detail = {}) {
  const items = await readAuditLog();
  items.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    user: session?.username || "system",
    action,
    detail
  });
  await writeAuditLog(items);
}

function dockerRequest(method, dockerPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({
      socketPath: DOCKER_SOCKET,
      method,
      path: dockerPath,
      timeout: 60000,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400) return reject(new Error(text || `Docker ${response.statusCode}`));
        const type = String(response.headers["content-type"] || "");
        if (type.includes("json") && text) {
          try {
            return resolve(JSON.parse(text));
          } catch {
            return resolve(text);
          }
        }
        resolve(text);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Docker timeout")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function dockerStream(req, res, dockerPath) {
  const request = http.request({
    socketPath: DOCKER_SOCKET,
    method: "POST",
    path: dockerPath,
    headers: { "content-type": req.headers["content-type"] || "application/x-tar" }
  }, response => {
    res.writeHead(response.statusCode, { "content-type": response.headers["content-type"] || "application/json" });
    response.pipe(res);
  });
  request.on("error", error => send(res, 500, { error: error.message }));
  req.pipe(request);
}

function dockerStreamText(req, dockerPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: DOCKER_SOCKET,
      method: "POST",
      path: dockerPath,
      timeout: 600000,
      headers: { "content-type": req.headers["content-type"] || "application/x-tar" }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400) return reject(new Error(text || `Docker ${response.statusCode}`));
        resolve(text);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Docker import timeout")));
    request.on("error", reject);
    req.on("error", reject);
    req.pipe(request);
  });
}

function dockerBufferRequest(method, dockerPath, buffer, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: DOCKER_SOCKET,
      method,
      path: dockerPath,
      timeout: 600000,
      headers: {
        "content-length": buffer.length,
        ...headers
      }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400) return reject(new Error(text || `Docker ${response.statusCode}`));
        resolve(text);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Docker build timeout")));
    request.on("error", reject);
    request.write(buffer);
    request.end();
  });
}

function readRaw(req, max = 50_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > max) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sanitizeTarPath(value) {
  const clean = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(part => part && part !== "." && part !== "..")
    .join("/");
  if (!clean) throw new Error("Nom de fichier invalide");
  return clean.slice(0, 100);
}

function octal(value, length) {
  const text = Math.max(0, Number(value) || 0).toString(8);
  return text.padStart(length - 1, "0").slice(0, length - 1) + "\0";
}

function tarHeader(name, size, mode = 0o644) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 8), 148, 8, "ascii");
  return header;
}

function tarFile(name, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "utf8");
  const padding = Buffer.alloc((512 - (buffer.length % 512)) % 512, 0);
  return Buffer.concat([tarHeader(sanitizeTarPath(name), buffer.length), buffer, padding]);
}

function buildContextTar(files, dockerfile) {
  const parts = [];
  const seen = new Set();
  for (const file of files || []) {
    const name = sanitizeTarPath(file.path || file.name);
    if (seen.has(name) || name === "Dockerfile") continue;
    const raw = String(file.content || "");
    const content = Buffer.from(raw, file.encoding === "base64" ? "base64" : "utf8");
    parts.push(tarFile(name, content));
    seen.add(name);
  }
  parts.push(tarFile("Dockerfile", dockerfile));
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function normalizedImageTag(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const slash = text.lastIndexOf("/");
  const colon = text.lastIndexOf(":");
  return colon > slash ? text : `${text}:latest`;
}

function parseLines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseEnv(value) {
  return parseLines(value).filter(line => line.includes("="));
}

function parseBinds(value) {
  return parseLines(value);
}

function parsePorts(value) {
  const exposed = {};
  const bindings = {};
  for (const line of parseLines(value)) {
    const clean = line.replace(/\s+/g, "");
    const [left, right] = clean.includes(":") ? clean.split(":") : ["", clean];
    const [containerPort, protocol = "tcp"] = right.split("/");
    if (!containerPort) continue;
    const key = `${containerPort}/${protocol}`;
    exposed[key] = {};
    bindings[key] = [{ HostPort: left || "" }];
  }
  return { exposed, bindings };
}

function parseMemory(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  const match = text.match(/^(\d+(?:\.\d+)?)(b|k|kb|m|mb|g|gb)?$/);
  if (!match) return 0;
  const number = Number(match[1]);
  const unit = match[2] || "b";
  const factor = unit.startsWith("g") ? 1024 ** 3 : unit.startsWith("m") ? 1024 ** 2 : unit.startsWith("k") ? 1024 : 1;
  return Math.round(number * factor);
}

function imageRef(value) {
  const ref = String(value || "").trim();
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash) return { fromImage: ref.slice(0, colon), tag: ref.slice(colon + 1) || "latest" };
  return { fromImage: ref, tag: "latest" };
}

async function pullImageIfNeeded(image) {
  try {
    await dockerRequest("GET", `/images/${encodeURIComponent(image)}/json`);
    return;
  } catch {}
  const ref = imageRef(image);
  if (ref.fromImage) {
    await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ref.fromImage)}&tag=${encodeURIComponent(ref.tag)}`);
  }
}

function httpsJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.github.com",
      path: pathname,
      method: "GET",
      headers: {
        "user-agent": "NodePilot",
        "accept": "application/vnd.github+json"
      },
      timeout: 10000
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400) return reject(new Error(text || `GitHub ${response.statusCode}`));
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error("Invalid GitHub response"));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("GitHub timeout")));
    req.on("error", reject);
    req.end();
  });
}

function repoTag(value) {
  const ref = String(value || "").trim();
  const slash = ref.lastIndexOf("/");
  const colon = ref.lastIndexOf(":");
  if (colon > slash) return { repo: ref.slice(0, colon), tag: ref.slice(colon + 1) || "latest" };
  return { repo: ref, tag: "latest" };
}

function dockerLoadTarget(output) {
  const text = String(output || "").split(/\r?\n/).map(line => {
    try {
      return JSON.parse(line).stream || line;
    } catch {
      return line;
    }
  }).join("\n");
  const id = text.match(/Loaded image ID:\s*(sha256:[a-f0-9]+)/i);
  if (id) return id[1];
  const tagged = text.match(/Loaded image:\s*([^\s]+)/i);
  return tagged ? tagged[1] : "";
}

function containerPayload(input) {
  const ports = parsePorts(input.ports);
  const hostConfig = {
    RestartPolicy: { Name: input.restart || "unless-stopped" },
    PortBindings: ports.bindings,
    Binds: parseBinds(input.volumes)
  };
  if (input.network && input.network !== "bridge") hostConfig.NetworkMode = input.network;
  if (input.cpus) hostConfig.NanoCpus = Math.round(Number(input.cpus) * 1_000_000_000);
  const memory = parseMemory(input.memory);
  if (memory) hostConfig.Memory = memory;

  const payload = {
    Image: input.image,
    Env: parseEnv(input.env),
    ExposedPorts: ports.exposed,
    HostConfig: hostConfig,
    Labels: { "nodepilot.managed": "true" }
  };
  if (String(input.command || "").trim()) payload.Cmd = ["sh", "-c", String(input.command).trim()];
  return payload;
}

function portsSummary(container) {
  const ports = (container.Ports || []).map(port => {
    const publicPart = port.PublicPort ? `${port.IP && port.IP !== "0.0.0.0" ? `${port.IP}:` : ""}${port.PublicPort}:` : "";
    const label = `${publicPart}${port.PrivatePort}/${port.Type}`;
    const number = Number(port.PublicPort || port.PrivatePort || 0);
    return { label, number };
  });
  const important = new Set([8443, 443, 80, 8080, 25565, 25575]);
  const sorted = ports.sort((a, b) => Number(important.has(b.number)) - Number(important.has(a.number)) || a.number - b.number);
  const shown = sorted.slice(0, 8).map(port => port.label);
  if (sorted.length > shown.length) shown.push(`+${sorted.length - shown.length} autres`);
  return shown;
}

function normalizeContainer(container) {
  return {
    id: container.Id,
    name: (container.Names?.[0] || "").replace(/^\//, "") || container.Id?.slice(0, 12),
    image: container.Image,
    imageId: container.ImageID,
    state: container.State,
    status: container.Status,
    created: container.Created,
    ports: portsSummary(container)
  };
}

function normalizeImage(image) {
  return {
    id: image.Id,
    tags: image.RepoTags?.length ? image.RepoTags : ["<none>:<none>"],
    size: image.Size,
    created: image.Created
  };
}

async function dockerSummary() {
  try {
    const [ping, containers, images, volumes, networks, info] = await Promise.all([
      dockerRequest("GET", "/_ping"),
      dockerRequest("GET", "/containers/json?all=1"),
      dockerRequest("GET", "/images/json"),
      dockerRequest("GET", "/volumes"),
      dockerRequest("GET", "/networks"),
      dockerRequest("GET", "/info")
    ]);
    return {
      connected: String(ping).trim() === "OK",
      node: info.Name || os.hostname(),
      engine: info.ServerVersion || "unknown",
      os: info.OperatingSystem || "Docker",
      containers: containers.length,
      running: containers.filter(c => c.State === "running").length,
      images: images.length,
      volumes: volumes.Volumes?.length || 0,
      networks: networks.length
    };
  } catch (error) {
    return {
      connected: false,
      node: os.hostname(),
      engine: "not connected",
      os: os.platform(),
      containers: 0,
      running: 0,
      images: 0,
      volumes: 0,
      networks: 0,
      error: error.message
    };
  }
}

async function dashboardPayload(config) {
  const memory = process.memoryUsage();
  return {
    ...publicConfig(config),
    docker: await dockerSummary(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: Math.round(process.uptime()),
      memoryRss: memory.rss,
      memoryHeap: memory.heapUsed,
      load: os.loadavg()
    },
    generatedAt: new Date().toISOString()
  };
}

async function api(req, res, url) {
  try {
    const config = await readConfig();

    if (req.method === "GET" && url.pathname === "/api/session") {
      const session = readSession(req);
      return send(res, 200, {
        authenticated: Boolean(session),
        username: session?.username || null,
        role: session?.role || null,
        access: session?.access || null,
        config: publicConfig(config)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const input = await readJson(req);
      const user = config.users.find(item => item.username === String(input.username || "").trim());
      if (user && user.enabled !== false && verifyPassword(input.password || "", user)) {
        const token = createSession(user);
        return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
          "set-cookie": `panel_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 8}`
        });
      }
      return send(res, 401, { error: "Identifiants invalides" });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const session = readSession(req);
      if (session) sessions.delete(session.token);
      return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
        "set-cookie": "panel_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
      });
    }

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      if (!requireAccess(req, res, "dashboard")) return;
      return send(res, 200, await dashboardPayload(config));
    }

    if (req.method === "GET" && url.pathname === "/api/version/check") {
      if (!requireAccess(req, res, "dashboard")) return;
      const branch = await httpsJson(`/repos/${APP_REPO}/commits/main`);
      const latestCommit = branch.sha || "";
      const currentCommit = APP_COMMIT || "local";
      const hasBuildCommit = currentCommit !== "local";
      const updateAvailable = Boolean(latestCommit && (!hasBuildCommit || !latestCommit.startsWith(currentCommit)));
      return send(res, 200, {
        version: APP_VERSION,
        commit: currentCommit,
        latestCommit,
        updateAvailable,
        status: updateAvailable ? (hasBuildCommit ? "outdated" : "local-build") : "up-to-date",
        image: APP_IMAGE,
        repo: APP_REPO
      });
    }

    if (req.method === "POST" && url.pathname === "/api/version/pull") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const ref = imageRef(APP_IMAGE);
      const output = await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ref.fromImage)}&tag=${encodeURIComponent(ref.tag)}`);
      await audit(session, "system.image.pulled", { image: APP_IMAGE });
      return send(res, 200, {
        ok: true,
        output,
        message: "Image telechargee. Relance le conteneur avec docker compose up -d pour appliquer la mise a jour."
      });
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      if (!requireAccess(req, res, "logs")) return;
      return send(res, 200, await readAuditLog());
    }

    if (req.method === "POST" && url.pathname === "/api/dashboard-links") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const title = String(input.title || "").trim();
      const linkUrl = String(input.url || "").trim();
      if (!title || !/^https?:\/\//i.test(linkUrl)) return send(res, 400, { error: "Titre et URL http(s) requis" });
      const link = {
        id: crypto.randomUUID(),
        title,
        url: linkUrl,
        iconUrl: String(input.iconUrl || config.appearance.iconUrl || "/assets/server-icon.png").trim(),
        createdAt: new Date().toISOString()
      };
      config.dashboardLinks = config.dashboardLinks || [];
      config.dashboardLinks.push(link);
      config.dashboardLayout = normalizeDashboardLayout(config, config.dashboardLayout);
      await writeConfig(config);
      await audit(session, "dashboard.link.created", { title, url: linkUrl });
      return send(res, 201, link);
    }

    if (req.method === "POST" && url.pathname === "/api/dashboard-links/icon") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const ext = path.extname(url.searchParams.get("filename") || "icon.png").toLowerCase() || ".png";
      if (![".png", ".jpg", ".jpeg", ".webp", ".ico"].includes(ext)) return send(res, 400, { error: "Format non supporte" });
      const buffer = await readRaw(req, 10_000_000);
      const fileName = `dashboard-link-${crypto.randomUUID()}${ext}`;
      await fsp.writeFile(path.join(DATA_ASSETS_DIR, fileName), buffer);
      await audit(session, "dashboard.link.icon.uploaded", { fileName });
      return send(res, 200, { url: `/data-assets/${fileName}` });
    }

    if (req.method === "POST" && url.pathname === "/api/dashboard-links/order") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      const current = config.dashboardLinks || [];
      const ordered = ids.map(id => current.find(link => link.id === id)).filter(Boolean);
      config.dashboardLinks = [...ordered, ...current.filter(link => !ids.includes(link.id))];
      await writeConfig(config);
      await audit(session, "dashboard.links.reordered");
      return send(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/dashboard-links/")) {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const id = decodeURIComponent(url.pathname.slice("/api/dashboard-links/".length));
      config.dashboardLinks = (config.dashboardLinks || []).filter(link => link.id !== id);
      config.dashboardLayout = normalizeDashboardLayout(config, {
        ...config.dashboardLayout,
        order: (config.dashboardLayout?.order || []).filter(item => item !== `app:${id}`),
        hidden: (config.dashboardLayout?.hidden || []).filter(item => item !== `app:${id}`)
      });
      await writeConfig(config);
      await audit(session, "dashboard.link.deleted", { id });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/dashboard-layout") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      config.dashboardLayout = normalizeDashboardLayout(config, input);
      await writeConfig(config);
      await audit(session, "dashboard.layout.updated", config.dashboardLayout);
      return send(res, 200, { ok: true, dashboardLayout: config.dashboardLayout });
    }

    if (req.method === "POST" && url.pathname === "/api/dashboard-automations") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const title = String(input.title || "").trim();
      const action = ["start", "stop", "restart"].includes(input.action) ? input.action : "start";
      const containerIds = Array.isArray(input.containerIds) ? input.containerIds.map(String).filter(Boolean) : [];
      if (!title || !containerIds.length) return send(res, 400, { error: "Nom et conteneurs requis" });
      const automation = { id: crypto.randomUUID(), title, action, containerIds, createdAt: new Date().toISOString() };
      config.dashboardAutomations = config.dashboardAutomations || [];
      config.dashboardAutomations.push(automation);
      config.dashboardLayout = normalizeDashboardLayout(config, {
        ...config.dashboardLayout,
        order: [...(config.dashboardLayout?.order || []), `automation:${automation.id}`]
      });
      await writeConfig(config);
      await audit(session, "dashboard.automation.created", { title, action, count: containerIds.length });
      return send(res, 201, automation);
    }

    const automationAction = url.pathname.match(/^\/api\/dashboard-automations\/([^/]+)\/run$/);
    if (automationAction && req.method === "POST") {
      const session = requireAccess(req, res, "containers");
      if (!session) return;
      const automation = (config.dashboardAutomations || []).find(item => item.id === decodeURIComponent(automationAction[1]));
      if (!automation) return send(res, 404, { error: "Automatisation introuvable" });
      for (const id of automation.containerIds || []) {
        await dockerRequest("POST", `/containers/${encodeURIComponent(id)}/${automation.action}`);
      }
      await audit(session, "dashboard.automation.run", { title: automation.title, action: automation.action });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/containers") {
      if (!requireAccess(req, res, "containers")) return;
      const containers = await dockerRequest("GET", "/containers/json?all=1&size=1");
      return send(res, 200, containers.map(normalizeContainer));
    }

    if (req.method === "POST" && url.pathname === "/api/containers") {
      const session = requireAccess(req, res, "containers");
      if (!session) return;
      const input = await readJson(req);
      if (input.image) await pullImageIfNeeded(input.image);
      const created = await dockerRequest("POST", `/containers/create?name=${encodeURIComponent(input.name || "")}`, containerPayload(input));
      if (input.start !== false) await dockerRequest("POST", `/containers/${created.Id}/start`);
      await audit(session, "container.created", { name: input.name || created.Id, image: input.image });
      return send(res, 201, created);
    }

    const containerAction = url.pathname.match(/^\/api\/containers\/([^/]+)\/(start|stop|restart|remove|recreate|logs|inspect)$/);
    if (containerAction) {
      const session = requireAccess(req, res, "containers");
      if (!session) return;
      const id = encodeURIComponent(containerAction[1]);
      const action = containerAction[2];
      if (req.method === "GET" && action === "inspect") return send(res, 200, await dockerRequest("GET", `/containers/${id}/json`));
      if (req.method === "GET" && action === "logs") {
        const logs = await dockerRequest("GET", `/containers/${id}/logs?stdout=1&stderr=1&tail=400&timestamps=1`);
        return send(res, 200, { logs });
      }
      if (req.method === "POST" && ["start", "stop", "restart"].includes(action)) {
        await dockerRequest("POST", `/containers/${id}/${action}`);
        await audit(session, `container.${action}`, { id: containerAction[1] });
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE" && action === "remove") {
        await dockerRequest("DELETE", `/containers/${id}?force=1&v=0`);
        await audit(session, "container.removed", { id: containerAction[1] });
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && action === "recreate") {
        const old = await dockerRequest("GET", `/containers/${id}/json`);
        const name = old.Name.replace(/^\//, "");
        const image = old.Config.Image;
        const ref = imageRef(image);
        if (ref.fromImage) await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ref.fromImage)}&tag=${encodeURIComponent(ref.tag)}`);
        try { await dockerRequest("POST", `/containers/${id}/stop?t=8`); } catch {}
        await dockerRequest("DELETE", `/containers/${id}?force=1&v=0`);
        const body = {
          Image: image,
          Env: old.Config.Env,
          Cmd: old.Config.Cmd,
          ExposedPorts: old.Config.ExposedPorts,
          HostConfig: old.HostConfig,
          Labels: old.Config.Labels
        };
        const created = await dockerRequest("POST", `/containers/create?name=${encodeURIComponent(name)}`, body);
        await dockerRequest("POST", `/containers/${created.Id}/start`);
        await audit(session, "container.recreated", { oldId: containerAction[1], name, image });
        return send(res, 200, created);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/images") {
      if (!requireAccess(req, res, "images")) return;
      const images = await dockerRequest("GET", "/images/json");
      return send(res, 200, images.map(normalizeImage));
    }

    if (req.method === "GET" && url.pathname === "/api/images/inspect") {
      if (!requireAccess(req, res, "images")) return;
      const image = url.searchParams.get("image");
      if (!image) return send(res, 400, { error: "Image required" });
      return send(res, 200, await dockerRequest("GET", `/images/${encodeURIComponent(image)}/json`));
    }

    if (req.method === "POST" && url.pathname === "/api/images/pull") {
      const session = requireAccess(req, res, "images");
      if (!session) return;
      const input = await readJson(req);
      const source = normalizedImageTag(input.image);
      const ref = imageRef(source);
      const output = await dockerRequest("POST", `/images/create?fromImage=${encodeURIComponent(ref.fromImage)}&tag=${encodeURIComponent(ref.tag)}`);
      if (String(input.name || "").trim()) {
        const tag = repoTag(input.name);
        if (tag.repo) await dockerRequest("POST", `/images/${encodeURIComponent(source)}/tag?repo=${encodeURIComponent(tag.repo)}&tag=${encodeURIComponent(tag.tag)}`);
      }
      await audit(session, "image.pulled", { image: source, name: input.name || "" });
      return send(res, 200, { output });
    }

    if (req.method === "POST" && url.pathname === "/api/images/import") {
      const session = requireAccess(req, res, "images");
      if (!session) return;
      const requestedTag = normalizedImageTag(url.searchParams.get("name"));
      const output = await dockerStreamText(req, "/images/load?quiet=0");
      const loadedTarget = dockerLoadTarget(output);
      if (requestedTag && loadedTarget) {
        const tag = repoTag(requestedTag);
        if (tag.repo) await dockerRequest("POST", `/images/${encodeURIComponent(loadedTarget)}/tag?repo=${encodeURIComponent(tag.repo)}&tag=${encodeURIComponent(tag.tag)}`);
      }
      await audit(session, "image.imported", { tag: requestedTag || "", loaded: loadedTarget || "" });
      return send(res, 200, { output, tag: requestedTag || "", loaded: loadedTarget || "" });
    }

    if (req.method === "POST" && url.pathname === "/api/images/build") {
      const session = requireAccess(req, res, "images");
      if (!session) return;
      const input = await readJson(req, 90_000_000);
      const tag = normalizedImageTag(input.name);
      if (!tag) return send(res, 400, { error: "Image name required" });
      const dockerfile = String(input.dockerfile || "").trim();
      if (!dockerfile) return send(res, 400, { error: "Dockerfile required" });
      if (!Array.isArray(input.files) || !input.files.length) return send(res, 400, { error: "Files required" });
      const tar = buildContextTar(input.files, dockerfile);
      const output = await dockerBufferRequest("POST", `/build?t=${encodeURIComponent(tag)}&rm=1`, tar, {
        "content-type": "application/x-tar"
      });
      await audit(session, "image.built", { tag });
      return send(res, 200, { output, tag });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/images/")) {
      const session = requireAccess(req, res, "images");
      if (!session) return;
      const id = encodeURIComponent(decodeURIComponent(url.pathname.slice("/api/images/".length)));
      await dockerRequest("DELETE", `/images/${id}?force=1`);
      await audit(session, "image.deleted", { id: decodeURIComponent(id) });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      if (!requireAccess(req, res, "settings")) return;
      return send(res, 200, {
        ...publicConfig(config),
        users: config.users.map(user => ({
          ...publicUser(user)
        })),
        plugins: config.plugins || [],
        dataFile: CONFIG_PATH,
        dockerSocket: DOCKER_SOCKET
      });
    }

    if (req.method === "GET" && url.pathname === "/api/plugins") {
      if (!requireAccess(req, res, "settings")) return;
      return send(res, 200, config.plugins || []);
    }

    if (req.method === "POST" && url.pathname === "/api/plugins") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const ext = path.extname(url.searchParams.get("filename") || "plugin.jar").toLowerCase();
      if (ext !== ".jar") return send(res, 400, { error: "Seuls les plugins .jar sont acceptes" });
      const originalName = path.basename(url.searchParams.get("filename") || "plugin.jar");
      const buffer = await readRaw(req, 80_000_000);
      const id = crypto.randomUUID();
      const fileName = `${id}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await fsp.mkdir(PLUGINS_DIR, { recursive: true });
      await fsp.writeFile(path.join(PLUGINS_DIR, fileName), buffer);
      const plugin = {
        id,
        name: originalName.replace(/\.jar$/i, ""),
        originalName,
        fileName,
        size: buffer.length,
        enabled: true,
        uploadedAt: new Date().toISOString()
      };
      config.plugins = config.plugins || [];
      config.plugins.push(plugin);
      await writeConfig(config);
      await audit(session, "plugin.imported", { name: plugin.name, size: plugin.size });
      return send(res, 201, plugin);
    }

    const pluginAction = url.pathname.match(/^\/api\/plugins\/([^/]+)$/);
    if (pluginAction && req.method === "POST") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const plugin = (config.plugins || []).find(item => item.id === decodeURIComponent(pluginAction[1]));
      if (!plugin) return send(res, 404, { error: "Plugin introuvable" });
      if (typeof input.enabled === "boolean") plugin.enabled = input.enabled;
      await writeConfig(config);
      await audit(session, "plugin.updated", { id: plugin.id, enabled: plugin.enabled });
      return send(res, 200, plugin);
    }

    if (pluginAction && req.method === "DELETE") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const id = decodeURIComponent(pluginAction[1]);
      const plugin = (config.plugins || []).find(item => item.id === id);
      if (plugin?.fileName) {
        try { await fsp.unlink(path.join(PLUGINS_DIR, path.basename(plugin.fileName))); } catch {}
      }
      config.plugins = (config.plugins || []).filter(item => item.id !== id);
      await writeConfig(config);
      await audit(session, "plugin.deleted", { id, name: plugin?.name || id });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/settings/config") {
      if (!requireAccess(req, res, "settings")) return;
      return send(res, 200, {
        panelName: config.panelName,
        tagline: config.tagline,
        loginHint: config.loginHint,
        appearance: config.appearance,
        users: config.users.map(publicUser)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/extensions") {
      if (!requireAccess(req, res, "extensions")) return;
      return send(res, 200, config.extensions || []);
    }

    if (req.method === "POST" && url.pathname === "/api/extensions") {
      const session = requireAccess(req, res, "extensions");
      if (!session) return;
      const input = await readJson(req, 1_000_000);
      const name = String(input.name || "").trim();
      if (!name) return send(res, 400, { error: "Extension name required" });
      const extension = {
        id: input.id || crypto.randomUUID(),
        name,
        version: String(input.version || "0.1.0"),
        description: String(input.description || ""),
        author: String(input.author || ""),
        enabled: input.enabled !== false,
        permissions: Array.isArray(input.permissions) ? input.permissions.map(String) : [],
        installedAt: new Date().toISOString()
      };
      config.extensions = (config.extensions || []).filter(item => item.id !== extension.id);
      config.extensions.push(extension);
      await writeConfig(config);
      await audit(session, "extension.installed", { name: extension.name, version: extension.version });
      return send(res, 201, extension);
    }

    const extensionAction = url.pathname.match(/^\/api\/extensions\/([^/]+)$/);
    if (extensionAction && req.method === "POST") {
      const session = requireAccess(req, res, "extensions");
      if (!session) return;
      const input = await readJson(req);
      const extension = (config.extensions || []).find(item => item.id === decodeURIComponent(extensionAction[1]));
      if (!extension) return send(res, 404, { error: "Extension not found" });
      if (typeof input.enabled === "boolean") extension.enabled = input.enabled;
      await writeConfig(config);
      await audit(session, "extension.updated", { id: extension.id, enabled: extension.enabled });
      return send(res, 200, extension);
    }

    if (extensionAction && req.method === "DELETE") {
      const session = requireAccess(req, res, "extensions");
      if (!session) return;
      config.extensions = (config.extensions || []).filter(item => item.id !== decodeURIComponent(extensionAction[1]));
      await writeConfig(config);
      await audit(session, "extension.removed", { id: decodeURIComponent(extensionAction[1]) });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/config") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req, 4_000_000);
      if (String(input.panelName || "").trim()) config.panelName = String(input.panelName).trim();
      if (typeof input.tagline === "string") config.tagline = input.tagline;
      if (typeof input.loginHint === "boolean") config.loginHint = input.loginHint;
      if (input.appearance && typeof input.appearance === "object") {
        config.appearance = {
          primary: input.appearance.primary || config.appearance.primary,
          accent: input.appearance.accent || config.appearance.accent,
          density: input.appearance.density || config.appearance.density,
          background: input.appearance.background || config.appearance.background,
          loginOpacity: Number(input.appearance.loginOpacity ?? config.appearance.loginOpacity),
          loginBackground: input.appearance.loginBackground || config.appearance.loginBackground,
          iconUrl: input.appearance.iconUrl || config.appearance.iconUrl
        };
      }
      if (input.configOptions && typeof input.configOptions === "object") {
        config.configOptions = {
          ...config.configOptions,
          ...input.configOptions,
          general: { ...config.configOptions.general, ...(input.configOptions.general || {}) },
          security: { ...config.configOptions.security, ...(input.configOptions.security || {}) },
          logging: { ...config.configOptions.logging, ...(input.configOptions.logging || {}) },
          monitoring: { ...config.configOptions.monitoring, ...(input.configOptions.monitoring || {}) },
          miscellaneous: { ...config.configOptions.miscellaneous, ...(input.configOptions.miscellaneous || {}) }
        };
      }
      await writeConfig(config);
      await audit(session, "settings.config.updated");
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/config/parameter") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const key = String(input.key || "").trim();
      const value = input.value;
      const allowed = new Set(["panelName", "tagline", "loginHint", "appearance.primary", "appearance.accent", "appearance.density", "appearance.background"]);
      if (!allowed.has(key)) return send(res, 400, { error: "Paramètre non autorisé" });
      const parsed = value === "true" ? true : value === "false" ? false : value;
      if (key.includes(".")) {
        const [parent, child] = key.split(".");
        config[parent][child] = parsed;
      } else {
        config[key] = parsed;
      }
      await writeConfig(config);
      await audit(session, "settings.parameter.updated", { key });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      config.panelName = String(input.panelName || config.panelName).trim() || "NodePilot";
      config.tagline = String(input.tagline || config.tagline).trim();
      config.loginHint = Boolean(input.loginHint);
      config.appearance = {
        primary: input.primary || config.appearance.primary,
        accent: input.accent || config.appearance.accent,
        density: input.density || config.appearance.density,
        background: input.background || config.appearance.background,
        loginOpacity: Number(input.loginOpacity ?? config.appearance.loginOpacity),
        loginBackground: input.loginBackground || config.appearance.loginBackground,
        iconUrl: input.iconUrl || config.appearance.iconUrl
      };
      if (input.configOptions && typeof input.configOptions === "object") config.configOptions = input.configOptions;
      const currentUser = config.users.find(user => user.id === session.userId);
      if (currentUser) {
        if (String(input.currentUsername || "").trim()) currentUser.username = String(input.currentUsername).trim();
        if (String(input.newPassword || "").trim() || String(input.confirmPassword || "").trim()) {
          if (!verifyPassword(String(input.currentPassword || ""), currentUser)) return send(res, 400, { error: "Mot de passe actuel incorrect" });
          if (String(input.newPassword || "") !== String(input.confirmPassword || "")) return send(res, 400, { error: "Les nouveaux mots de passe ne correspondent pas" });
          if (String(input.newPassword || "").length < 4) return send(res, 400, { error: "Le nouveau mot de passe est trop court" });
          const password = hashPassword(String(input.newPassword));
          currentUser.salt = password.salt;
          currentUser.passwordHash = password.hash;
          currentUser.passwordChanged = true;
        }
        const active = sessions.get(session.token);
        if (active) active.username = currentUser.username;
      }
      await writeConfig(config);
      await audit(session, "settings.updated");
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/login-background") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const ext = path.extname(url.searchParams.get("filename") || "background.png").toLowerCase() || ".png";
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return send(res, 400, { error: "Format non supporté" });
      const buffer = await readRaw(req);
      const fileName = `login-bg-custom${ext}`;
      await fsp.writeFile(path.join(DATA_ASSETS_DIR, fileName), buffer);
      config.appearance.loginBackground = `/data-assets/${fileName}`;
      await writeConfig(config);
      await audit(session, "appearance.login_background.updated", { fileName });
      return send(res, 200, { url: config.appearance.loginBackground });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/icon") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const ext = path.extname(url.searchParams.get("filename") || "icon.png").toLowerCase() || ".png";
      if (![".png", ".jpg", ".jpeg", ".webp", ".ico"].includes(ext)) return send(res, 400, { error: "Format non supporté" });
      const buffer = await readRaw(req, 10_000_000);
      const fileName = `site-icon-custom${ext}`;
      await fsp.writeFile(path.join(DATA_ASSETS_DIR, fileName), buffer);
      config.appearance.iconUrl = `/data-assets/${fileName}`;
      await writeConfig(config);
      await audit(session, "appearance.icon.updated", { fileName });
      return send(res, 200, { url: config.appearance.iconUrl });
    }

    if (req.method === "POST" && url.pathname === "/api/settings/users") {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const input = await readJson(req);
      const username = String(input.username || "").trim();
      const password = String(input.password || "");
      if (!username || password.length < 4) return send(res, 400, { error: "Utilisateur ou mot de passe invalide" });
      if (config.users.some(user => user.username === username)) return send(res, 409, { error: "Utilisateur déjà existant" });
      const user = makeUser(username, password, input.role || "viewer", true);
      user.email = String(input.email || "").trim();
      if (user.role !== "admin" && Array.isArray(input.access)) user.access = input.access.filter(item => DEFAULT_ACCESS.includes(item));
      config.users.push(user);
      await writeConfig(config);
      await audit(session, "user.created", { username: user.username, role: user.role });
      return send(res, 201, { ok: true });
    }

    const userUpdate = url.pathname.match(/^\/api\/settings\/users\/([^/]+)$/);
    if (req.method === "POST" && userUpdate) {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const id = decodeURIComponent(userUpdate[1]);
      const input = await readJson(req);
      const user = config.users.find(item => item.id === id);
      if (!user) return send(res, 404, { error: "Utilisateur introuvable" });
      const nextRole = String(input.role || user.role || "viewer").trim();
      const nextEnabled = input.enabled !== false;
      const wasSoleAdmin = user.role === "admin" && adminCount(config) <= 1;
      if (wasSoleAdmin && (nextRole !== "admin" || !nextEnabled)) return send(res, 400, { error: "Il faut garder au moins un admin actif" });
      const nextUsername = String(input.username || "").trim();
      if (nextUsername && config.users.some(item => item.id !== id && item.username === nextUsername)) return send(res, 409, { error: "Utilisateur deja existant" });
      if (nextUsername) user.username = nextUsername;
      user.email = String(input.email || "").trim();
      user.role = nextRole;
      user.enabled = nextEnabled;
      if (user.role === "admin") user.access = [...DEFAULT_ACCESS];
      else if (Array.isArray(input.access)) user.access = input.access.filter(item => DEFAULT_ACCESS.includes(item));
      else user.access = roleDefaultAccess(user.role);
      if (String(input.password || "").trim()) {
        const password = hashPassword(String(input.password));
        user.salt = password.salt;
        user.passwordHash = password.hash;
        user.passwordChanged = true;
      }
      await writeConfig(config);
      for (const active of sessions.values()) {
        if (active.userId === user.id) {
          active.username = user.username;
          active.role = user.role;
          active.access = user.access;
        }
      }
      await audit(session, "user.updated", { username: user.username, role: user.role, enabled: user.enabled });
      return send(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/settings/users/")) {
      const session = requireAccess(req, res, "settings");
      if (!session) return;
      const id = decodeURIComponent(url.pathname.slice("/api/settings/users/".length));
      if (id === session.userId) return send(res, 400, { error: "Impossible de supprimer l'utilisateur connecté" });
      if (config.users.length <= 1) return send(res, 400, { error: "Il faut garder au moins un utilisateur" });
      const user = config.users.find(item => item.id === id);
      if (user?.role === "admin" && adminCount(config) <= 1) return send(res, 400, { error: "Il faut garder au moins un admin actif" });
      config.users = config.users.filter(user => user.id !== id);
      await writeConfig(config);
      await audit(session, "user.deleted", { username: user?.username || id });
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "Route not found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

function staticFile(req, res, url) {
  if (url.pathname.startsWith("/data-assets/")) {
    const assetName = path.basename(decodeURIComponent(url.pathname.slice("/data-assets/".length)));
    const assetPath = path.join(DATA_ASSETS_DIR, assetName);
    return fs.readFile(assetPath, (error, content) => {
      if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
      res.writeHead(200, { "content-type": mime[path.extname(assetPath)] || "application/octet-stream" });
      res.end(content);
    });
  }
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.join(PUBLIC_DIR, path.normalize(requestPath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.readFile(filePath, (error, content) => {
    if (error && !path.extname(requestPath)) {
      return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexError, indexContent) => {
        if (indexError) return send(res, 404, "Not found", "text/plain; charset=utf-8");
        res.writeHead(200, { "content-type": mime[".html"] });
        res.end(indexContent);
      });
    }
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  return staticFile(req, res, url);
}).listen(PORT, () => {
  console.log(`NodePilot listening on http://0.0.0.0:${PORT}`);
});
