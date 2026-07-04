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
// content.js already listens for. Raw 60Hz polls are too sparse/jittery for
// content.js's velocity smoothing (built for near-continuous browser events),
// which made the 8-way facing flap at diagonal octant boundaries — so
// interpolate samples with rAF into a dense, smooth event stream, and only
// dispatch while actually moving (otherwise the sleep state never triggers).
const cursor = { target: null, pos: null, looping: false };

function cursorLoop() {
  const { target, pos } = cursor;
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  if (Math.hypot(dx, dy) > 200) {
    // display hop / teleport: snap instead of streaking across the screen
    pos.x = target.x;
    pos.y = target.y;
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: pos.x, clientY: pos.y }));
  } else if (Math.hypot(dx, dy) > 0.5) {
    pos.x += dx * 0.5;
    pos.y += dy * 0.5;
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: pos.x, clientY: pos.y }));
  }
  requestAnimationFrame(cursorLoop);
}

ipcRenderer.on("vcp1:cursor", (_e, { x, y }) => {
  cursor.target = { x, y };
  if (!cursor.pos) cursor.pos = { x, y };
  if (!cursor.looping) {
    cursor.looping = true;
    requestAnimationFrame(cursorLoop);
  }
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
      }
    }
  }, 200);
}
