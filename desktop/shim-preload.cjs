// Minimal chrome.* shim so the unmodified extension code (content.js, popup.js)
// runs inside Electron windows. Storage and messaging are backed by the main
// process over IPC; asset URLs resolve to the poke:// app protocol.
const { ipcRenderer } = require("electron");

const changedListeners = [];
const messageListeners = [];

function makeStorageArea(area) {
  return {
    get(keys, cb) {
      ipcRenderer.invoke("vcp1:storage-get", area, keys ?? null)
        .then((res) => { if (typeof cb === "function") cb(res || {}); });
    },
    set(patch, cb) {
      ipcRenderer.invoke("vcp1:storage-set", area, patch || {})
        .then(() => { if (typeof cb === "function") cb(); });
    }
  };
}

window.chrome = {
  runtime: {
    id: "pokefollower-desktop",
    getURL: (rel) => `poke://app/src/${String(rel).replace(/^\/+/, "")}`,
    sendMessage: (msg) => { ipcRenderer.send("vcp1:message", msg); },
    onMessage: {
      addListener: (fn) => { messageListeners.push(fn); }
    }
  },
  storage: {
    sync: makeStorageArea("sync"),
    local: makeStorageArea("local"),
    onChanged: {
      addListener: (fn) => { changedListeners.push(fn); }
    }
  }
};

ipcRenderer.on("vcp1:storage-changed", (_e, area, changes) => {
  for (const fn of changedListeners) {
    try { fn(changes, area); } catch (err) { console.warn("onChanged listener failed", err); }
  }
});

ipcRenderer.on("vcp1:message", (_e, msg) => {
  for (const fn of messageListeners) {
    try { fn(msg); } catch (err) { console.warn("onMessage listener failed", err); }
  }
});

// Overlay only: turn main-process cursor samples into the mousemove events
// content.js already listens for. Dispatch only when the cursor actually
// moved — a browser fires no mousemove while idle, and content.js relies on
// that for its sleep state and last-facing behavior.
let lastCursor = null;
ipcRenderer.on("vcp1:cursor", (_e, { x, y }) => {
  if (lastCursor && lastCursor.x === x && lastCursor.y === y) return;
  lastCursor = { x, y };
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
});

// --smoke: report once each window's UI is actually up — the overlay when the
// follower element is animating a sprite sheet, the settings popup when the
// pack list has been populated from index.json.
if (new URLSearchParams(window.location.search).has("smoke")) {
  const isPopup = window.location.pathname.includes("popup");
  const timer = setInterval(() => {
    if (isPopup) {
      const pack = document.getElementById("pack");
      if (pack && pack.options.length > 2) {
        clearInterval(timer);
        ipcRenderer.send("vcp1:smoke-ok", "settings");
      }
    } else {
      const el = document.getElementById("__vcp1_follower");
      if (el && el.style.backgroundImage.includes("poke://")) {
        clearInterval(timer);
        ipcRenderer.send("vcp1:smoke-ok", "overlay");
        smokeFacingProbe();
      }
    }
  }, 200);
}

// Drive a steady upward cursor motion and check the sprite actually uses the
// "back" row (default pack: row 4, 40px frames → background-position-y -160px).
function smokeFacingProbe() {
  let y = 800;
  const feed = setInterval(() => {
    y -= 8;
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 600, clientY: y }));
  }, 16);
  setTimeout(() => {
    clearInterval(feed);
    const el = document.getElementById("__vcp1_follower");
    const posY = el ? (el.style.backgroundPosition.split(" ")[1] || "") : "";
    ipcRenderer.send("vcp1:smoke-facing", posY === "-160px" ? "ok" : `fail:${posY}`);
  }, 900);
}
