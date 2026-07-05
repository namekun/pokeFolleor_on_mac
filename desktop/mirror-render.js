// PokéFollower mirror renderer: paints a sprite element that exactly mirrors
// the engine window's per-frame snapshot (position, sheet, frame). This file
// carries NO engine/game logic — the engine window (running src/content.js)
// is the sole source of truth for physics/animation state. All this does is
// translate the snapshot's global coordinates into this window's own
// display-local space and copy the same CSS a real follower element would
// have (see content.js's applyFrame(), which this mirrors style-for-style).
let el = null;
function ensureEl() {
  if (el) return el;
  el = document.createElement("div");
  el.id = "__vcp1_follower";
  Object.assign(el.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    pointerEvents: "none",
    zIndex: "2147483647",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    // No transition here (unlike the engine's follower element): a mirror
    // just repaints whatever snapshot arrives, and easing a translate the
    // engine already eased would double up / lag the handoff at the
    // display boundary.
    display: "none"
  });
  document.documentElement.appendChild(el);
  return el;
}

function applySnapshot(snap) {
  const node = ensureEl();
  const world = window.__VCP1_WORLD__;
  const originX = world?.origin?.x || 0;
  const originY = world?.origin?.y || 0;

  node.style.display = "block";
  node.style.width = `${snap.w}px`;
  node.style.height = `${snap.h}px`;
  node.style.backgroundImage = `url("${snap.bgImage}")`;
  node.style.backgroundSize = (snap.bgSizeW && snap.bgSizeH) ? `${snap.bgSizeW}px ${snap.bgSizeH}px` : "";
  node.style.backgroundPosition = `${snap.bpx}px ${snap.bpy}px`;

  const localX = snap.x - originX;
  const localY = snap.y - originY;
  node.style.transform =
    `translate(${Math.round(localX)}px, ${Math.round(localY)}px) ` +
    `translate(-50%, -50%) ` +
    `scale(${snap.scale})`;
  node.style.transformOrigin = "center center";
}

window.addEventListener("vcp1:snapshot", (e) => applySnapshot(e.detail));
