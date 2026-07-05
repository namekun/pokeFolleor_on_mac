// Preload for mirror overlay windows — every display except the one running
// the engine (src/content.js). No chrome.* shim, no follow/wander logic: this
// only relays the engine's world layout and per-frame sprite snapshot into
// DOM events that mirror-render.js paints, so extra displays show the same
// sprite without a second copy of the physics/FSM running.
const { ipcRenderer } = require("electron");

ipcRenderer.invoke("vcp1:world-get").then((world) => {
  window.__VCP1_WORLD__ = world;
  window.dispatchEvent(new Event("vcp1:world-updated"));
});
ipcRenderer.on("vcp1:world", (_e, world) => {
  window.__VCP1_WORLD__ = world;
  window.dispatchEvent(new Event("vcp1:world-updated"));
});
ipcRenderer.on("vcp1:snapshot", (_e, snap) => {
  window.dispatchEvent(new CustomEvent("vcp1:snapshot", { detail: snap }));
});

// --smoke: report once this mirror window has actually painted a snapshot
// broadcast from the engine — confirms cross-window relay + render, not just
// that the window exists.
if (new URLSearchParams(window.location.search).has("smoke")) {
  const onSnapshot = () => {
    window.removeEventListener("vcp1:snapshot", onSnapshot);
    ipcRenderer.send("vcp1:smoke-ok", "mirror");
  };
  window.addEventListener("vcp1:snapshot", onSnapshot);
}
