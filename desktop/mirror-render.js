// PokéFollower mirror renderer: paints a sprite element that exactly mirrors
// the engine window's per-frame snapshot (position, sheet, frame). This file
// carries NO engine/game logic — the engine window (running src/content.js)
// is the sole source of truth for physics/animation state. All this does is
// translate the snapshot's global coordinates into this window's own
// display-local space and copy the same CSS a real follower element would
// have (see content.js's applyFrame(), which this mirrors style-for-style).
let el = null;
// Mirrors content.js's MOOD_BUBBLE_PX/MOOD_FADE_MS -- kept in sync manually
// (no shared module system in this codebase, same as e.g. popup.js's
// duplicated LEVEL_XP_BASE). Only the *appearance* needs to match; the
// engine is the one deciding *when* to show/fade (see applySnapshot below).
const MOOD_BUBBLE_PX = 44;
const MOOD_PORTRAIT_PX = 30;
const MOOD_FADE_MS = 400;
let moodEl = null;
function ensureMoodEl() {
  if (moodEl) return moodEl;
  moodEl = document.createElement("div");
  moodEl.id = "__vcp1_mood_bubble";
  Object.assign(moodEl.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${MOOD_BUBBLE_PX}px`,
    height: `${MOOD_BUBBLE_PX}px`,
    borderRadius: "50%",
    background: "#fff",
    border: "2px solid rgba(0,0,0,0.15)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
    backgroundSize: `${MOOD_PORTRAIT_PX}px ${MOOD_PORTRAIT_PX}px`,
    imageRendering: "pixelated",
    pointerEvents: "none",
    zIndex: "2147483647",
    display: "none",
    opacity: "0",
    transition: `opacity ${MOOD_FADE_MS}ms ease-out`
  });
  document.documentElement.appendChild(moodEl);
  return moodEl;
}

// The engine already decided WHEN to fade (see content.js's renderMoodBubble())
// -- this just reacts to the relayed `phase` on each incoming snapshot. Both
// windows' fades start off the same relayed signal within one frame (~16ms)
// of each other, so this local CSS transition (rather than any shared clock)
// is enough to look in sync; no cross-process timestamp comparison needed
// (each Electron renderer's performance.now() has its own independent epoch).
function applyMood(mood) {
  if (!mood) {
    if (moodEl) moodEl.style.display = "none";
    return;
  }
  const world = window.__VCP1_WORLD__;
  const originX = world?.origin?.x || 0;
  const originY = world?.origin?.y || 0;
  const node = ensureMoodEl();
  node.style.display = "block";
  node.style.backgroundImage = `url("${mood.url}")`;
  node.style.opacity = mood.phase === "fading" ? "0" : "1";
  const localX = mood.gx - originX;
  const localY = mood.gy - originY;
  node.style.transform = `translate(${Math.round(localX)}px, ${Math.round(localY)}px) translate(-50%, -50%)`;
}

// Mirrors content.js's APPLE_SIZE_PX/APPLE_DATA_URI -- kept in sync manually,
// same "appearance only" split as the mood bubble above (the engine decides
// WHEN/WHERE; this just paints whatever the snapshot says).
const APPLE_SIZE_PX = 16;
const APPLE_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAApklEQVR42mNgGNQgxkrxPwMDA4PPArf/enl6/7GpYSLWMDkjCQZchhDlCpLBYgkJuMYPKVE4DWHEpdFUSIhBwsoAQ4PAnGWMOA1YLCHx31RIiEF9SgMDAwMDw8dlG7DaimwIPBBvaGn9NxUSgiu6mdNAlPcYkQ0gJmxOv3vHwMDAwBD74gUjSdGIrJmsdIBNM9EG4NJMMBqxaYb5HacB2EIam0aqAQDmajk2Ztb5vAAAAABJRU5ErkJggg==";
let appleEl = null;
function ensureAppleEl() {
  if (appleEl) return appleEl;
  appleEl = document.createElement("div");
  appleEl.id = "__vcp1_apple";
  Object.assign(appleEl.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${APPLE_SIZE_PX}px`,
    height: `${APPLE_SIZE_PX}px`,
    backgroundImage: `url("${APPLE_DATA_URI}")`,
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
    pointerEvents: "none",
    zIndex: "2147483646",
    display: "none"
  });
  document.documentElement.appendChild(appleEl);
  return appleEl;
}

// Same relay pattern as applyMood(): the engine already computed the fall
// offset (dropOffsetPx) and the global drop point, so this just translates
// global -> local for this window and paints it.
function applyApple(apple) {
  if (!apple) {
    if (appleEl) appleEl.style.display = "none";
    return;
  }
  const world = window.__VCP1_WORLD__;
  const originX = world?.origin?.x || 0;
  const originY = world?.origin?.y || 0;
  const node = ensureAppleEl();
  node.style.display = "block";
  const gx = apple.x, gy = apple.y + (apple.dropOffsetPx || 0);
  node.style.transform = `translate(${Math.round(gx - originX)}px, ${Math.round(gy - originY)}px) translate(-50%, -50%)`;
}

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
  // Evolution silhouette flash (see content.js's applyFrame()) -- mirrored
  // verbatim so the effect is visible on every display, not just the engine's.
  node.style.filter = snap.filter || "";

  const localX = snap.x - originX;
  const localY = snap.y - originY;
  node.style.transform =
    `translate(${Math.round(localX)}px, ${Math.round(localY)}px) ` +
    `translate(-50%, -50%) ` +
    `scale(${snap.scale})`;
  node.style.transformOrigin = "center center";

  applyMood(snap.mood);
  applyApple(snap.apple);
}

window.addEventListener("vcp1:snapshot", (e) => applySnapshot(e.detail));
