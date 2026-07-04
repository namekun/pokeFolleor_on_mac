// PokéFollower desktop (macOS): transparent click-through overlay that reuses
// the extension's content.js, plus the extension popup as a settings window.
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, protocol, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SMOKE = process.argv.includes("--smoke");

// serve repo files over poke://app/<path> so fetch() works (file:// blocks fetch)
protocol.registerSchemesAsPrivileged([
  { scheme: "poke", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".cjs": "text/javascript",
  ".json": "application/json", ".css": "text/css",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain"
};

// --- settings store (same keys as chrome.storage; kept per area like sync/local) ---
const storePath = () => path.join(app.getPath("userData"), "settings.json");
let store = { sync: {}, local: {} };
function loadStore() {
  try { store = { sync: {}, local: {}, ...JSON.parse(fs.readFileSync(storePath(), "utf8")) }; } catch (_) {}
}
function saveStore() {
  try { fs.writeFileSync(storePath(), JSON.stringify(store, null, 2)); } catch (e) { console.warn("settings save failed", e); }
}
function broadcast(channel, ...args) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}
function storageSet(area, patch) {
  const changes = {};
  for (const [k, v] of Object.entries(patch)) {
    changes[k] = { oldValue: store[area][k], newValue: v };
    store[area][k] = v;
  }
  saveStore();
  broadcast("vcp1:storage-changed", area, changes);
  if (area === "sync" && "vcp1_enabled" in patch) refreshTray();
}

let overlayWin = null;
let settingsWin = null;
let tray = null;
let cursorTimer = null;
let overlayDisplayId = null;

function createOverlay() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlayDisplayId = display.id;
  overlayWin = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "shim-preload.cjs"),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadURL(`poke://app/desktop/overlay.html${SMOKE ? "?smoke=1" : ""}`);
  overlayWin.once("ready-to-show", () => overlayWin.showInactive());
  overlayWin.on("closed", () => { overlayWin = null; });
}

// Follow the cursor across displays: keep the overlay on the display under the
// cursor and feed cursor position (in window-local coords) to the renderer.
function startCursorFeed() {
  cursorTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    if (display.id !== overlayDisplayId) {
      overlayDisplayId = display.id;
      overlayWin.setBounds(display.bounds);
    }
    overlayWin.webContents.send("vcp1:cursor", {
      x: pt.x - display.bounds.x,
      y: pt.y - display.bounds.y
    });
  }, 16); // ~60Hz
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 400,
    height: 600,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: "PokéFollower Settings",
    webPreferences: {
      preload: path.join(__dirname, "shim-preload.cjs"),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false
    }
  });
  settingsWin.loadURL(`poke://app/src/popup/index.html${SMOKE ? "?smoke=1" : ""}`);
  // popup links (credits, GitHub) open in the default browser
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  settingsWin.on("closed", () => { settingsWin = null; });
}

function refreshTray() {
  if (!tray) return;
  const enabled = !!store.sync.vcp1_enabled;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: enabled ? "Disable Follower" : "Enable Follower",
      click: () => storageSet("sync", { vcp1_enabled: !store.sync.vcp1_enabled })
    },
    { label: "Settings…", click: openSettings },
    { type: "separator" },
    { label: "Quit PokéFollower", click: () => app.quit() }
  ]));
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(ROOT, "src/assets/icons/pokeball-32.png"))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("PokéFollower");
  refreshTray();
}

// --- IPC: chrome.* shim backend ---
ipcMain.handle("vcp1:storage-get", (_e, area, keys) => {
  const src = store[area] || {};
  if (keys == null) return { ...src };
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) if (k in src) out[k] = src[k];
  return out;
});
ipcMain.handle("vcp1:storage-set", (_e, area, patch) => { storageSet(area, patch); });
ipcMain.on("vcp1:message", (e, msg) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents.id !== e.sender.id) {
      win.webContents.send("vcp1:message", msg);
    }
  }
});
const smokePassed = new Set();
function smokeCheckDone() {
  if (smokePassed.has("overlay") && smokePassed.has("settings") && smokePassed.has("facing") && smokePassed.has("lang") && smokePassed.has("wander")) {
    console.log("SMOKE_OK");
    app.exit(0);
  }
}
ipcMain.on("vcp1:smoke-ok", (_e, which) => {
  if (!SMOKE) return;
  smokePassed.add(which);
  console.log(`SMOKE_${String(which).toUpperCase()}_OK`);
  if (which === "overlay") openSettings();
  smokeCheckDone();
});
ipcMain.on("vcp1:smoke-facing", (_e, result) => {
  if (!SMOKE) return;
  if (result === "ok") {
    smokePassed.add("facing");
    console.log("SMOKE_FACING_OK");
    smokeCheckDone();
  } else {
    console.error(`SMOKE_FACING_${result}`);
    app.exit(1);
  }
});
ipcMain.on("vcp1:smoke-lang", (_e, result) => {
  if (!SMOKE) return;
  if (result === "ok") {
    smokePassed.add("lang");
    console.log("SMOKE_LANG_OK");
    smokeCheckDone();
  } else {
    console.error(`SMOKE_LANG_${result}`);
    app.exit(1);
  }
});
ipcMain.on("vcp1:smoke-wander", (_e, result) => {
  if (!SMOKE) return;
  if (result === "ok") {
    smokePassed.add("wander");
    console.log("SMOKE_WANDER_OK");
    smokeCheckDone();
  } else {
    console.error(`SMOKE_WANDER_${result}`);
    app.exit(1);
  }
});

app.whenReady().then(() => {
  protocol.handle("poke", async (req) => {
    const { pathname } = new URL(req.url);
    const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    const fp = path.join(ROOT, rel);
    if (!fp.startsWith(ROOT)) return new Response("forbidden", { status: 403 });
    try {
      const body = await fs.promises.readFile(fp);
      return new Response(body, { headers: { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" } });
    } catch (_) {
      return new Response("not found", { status: 404 });
    }
  });

  loadStore();
  if (store.sync.vcp1_enabled === undefined || SMOKE) store.sync.vcp1_enabled = true;
  if (SMOKE) store.sync.vcp1_pack = "retro/gen-1/009-blastoise"; // facing probe expects this pack's row layout
  if (SMOKE) store.sync.vcp1_lang = "en"; // lang probe must start from English so its switch to Korean is real
  // facing probe's timing assumes default walk speed/offset — reset in case a
  // developer's own settings.json (persisted from manual runs) left different values
  if (SMOKE) { store.sync.vcp1_offset = 30; store.sync.vcp1_lerp = 0.20; }
  // facing probe requires follow-mode behavior; wander probe switches this on
  // its own once facing passes — reset in case a prior manual run left it wander
  if (SMOKE) store.sync.vcp1_mode = "follow";

  if (app.dock) app.dock.hide(); // menu-bar utility; no Dock icon
  createTray();
  createOverlay();
  // Smoke probes drive their own synthetic mousemove feed; the real OS cursor
  // (which may keep moving on the developer's machine during the run) would
  // otherwise inject unrelated motion into the same overlay and corrupt it.
  if (!SMOKE) startCursorFeed();

  if (SMOKE) {
    // facing (~7.9s) + wander (up to 10s backstop) run back-to-back in the
    // overlay window, plus settings/lang in parallel — budget generously.
    setTimeout(() => { console.error("SMOKE_TIMEOUT"); app.exit(1); }, 30000);
  }
});

app.on("window-all-closed", () => { /* keep running from the tray */ });
app.on("before-quit", () => { if (cursorTimer) clearInterval(cursorTimer); });
