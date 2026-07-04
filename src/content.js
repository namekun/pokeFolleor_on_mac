// === VCP1 content script: load pack JSON + animate idle/walk with left/right flip ===
const DEFAULT_PACK = "retro/gen-1/009-blastoise";
const GENERATION_DIRS = ["gen-1","gen-2","gen-3","gen-4","gen-5","gen-6","gen-7","gen-8","gen-9"];

const STATE = {
  enabled: false,
  pack: DEFAULT_PACK,  // default
  facingLeft: false,
  mode: "follow"       // "follow" | "wander"
};

let followerEl = null;
let rafId = null;
let running = false;

const RUNTIME = {
  meta: null,                 // loaded JSON pack
  images: {},                 // { idle: Image, walk: Image }
  anim: { name: "idle", frame: 0, row: 0, accMs: 0 },
  lastMoveTs: 0,
  lastMouse: { x: 0, y: 0, t: 0 },

  // position/target and smoothed velocity
  pos:       { x: 0, y: 0 },
  target:    { x: 0, y: 0 },
  offsetDir:    { x: 0, y: -1 }, // lerped unit vector for idle→walk glide (perch placement)
  isWalking:    false,           // true while the follower is actively walking toward its target
  pendingState: null,             // { name, queuedAt } — deferred state switch
  velAvg:    { x: 0, y: 0 },
  speedAvg:  0
};

// --- wander mode: autonomous roam/pause/nap/attack FSM (mode === "wander") ---
const WANDER = {
  state: null,                 // "roam" | "pause" | "nap" | "attack" (null = not yet started)
  until: 0,                    // performance.now() deadline for timed states (pause/nap)
  attackCyclesLeft: 0,
  lastDir: { x: 0, y: 0 }       // last travel vector; keeps facing during stationary states
};

// --- behavior thresholds ---
const SLEEP_TIMEOUT_MS = 30000; // 30s of no movement -> sleep
const ARRIVE_RADIUS_PX = 6;     // close enough to target to call it "arrived" and settle into idle
const SLOW_RADIUS_PX   = 60;    // ease walking speed down within this distance for a soft landing
const VEL_DECAY_DELAY_MS = 80;  // no mousemove for this long -> start decaying velAvg toward zero
const VEL_DECAY_TAU_MS   = 120; // exponential decay time constant once decaying

function hasState(name) {
  return !!(RUNTIME.meta && RUNTIME.meta.states && RUNTIME.meta.states[name]);
}
// --- UI-configurable tuning (persisted in chrome.storage.sync) ---
const CONFIG = {
  scale: 1.25,   // visual scale multiplier
  offset: 30,    // px distance from cursor (trail/perch)
  lerp: 0.20     // follow smoothing (0..1), lower = floatier
};
function applyConfigPatch(obj = {}) {
  if (typeof obj.vcp1_scale  === "number" && !Number.isNaN(obj.vcp1_scale))  CONFIG.scale  = obj.vcp1_scale;
  if (typeof obj.vcp1_offset === "number" && !Number.isNaN(obj.vcp1_offset)) CONFIG.offset = obj.vcp1_offset;
  if (typeof obj.vcp1_lerp   === "number" && !Number.isNaN(obj.vcp1_lerp))   CONFIG.lerp   = obj.vcp1_lerp;
}

// Map the popup's "SPEED" slider (stored/transmitted as vcp1_lerp, internal range ~0.05–0.50)
// onto a walking speed in px/s, so the follower travels at a steady, natural pace
// instead of being eased toward a moving point (which is what produced the "leash" drag).
const WALK_SPEED_MIN_PXPS = 80;   // px/s at the slowest "speed" setting
const WALK_SPEED_MAX_PXPS = 640;  // px/s at the fastest "speed" setting
const SPEED_CONFIG_MIN = 0.05;
const SPEED_CONFIG_MAX = 0.50;
function walkSpeedFromConfig() {
  const t = (CONFIG.lerp - SPEED_CONFIG_MIN) / (SPEED_CONFIG_MAX - SPEED_CONFIG_MIN);
  const clamped = Math.min(1, Math.max(0, t));
  return WALK_SPEED_MIN_PXPS + clamped * (WALK_SPEED_MAX_PXPS - WALK_SPEED_MIN_PXPS);
}

// --- Live poller for smooth slider updates during popup drag ---
let LIVE = { dragging: false, pollId: null };

function startLocalPoll() {
  if (LIVE.pollId) return; // already polling
  // Poll at ~30Hz to decouple rendering from popup focus/message cadence
  LIVE.pollId = setInterval(() => {
    chrome.storage.local.get(["vcp1_scale","vcp1_offset","vcp1_lerp"], (res) => {
      // Only apply present numeric values
      const patch = {};
      if (typeof res.vcp1_scale  === "number")  patch.vcp1_scale  = res.vcp1_scale;
      if (typeof res.vcp1_offset === "number")  patch.vcp1_offset = res.vcp1_offset;
      if (typeof res.vcp1_lerp   === "number")  patch.vcp1_lerp   = res.vcp1_lerp;
      if (Object.keys(patch).length) {
        applyConfigPatch(patch);
        if (followerEl && RUNTIME.meta) applyFrame();
      }
    });
  }, 33); // ~30fps
}

function stopLocalPoll() {
  if (LIVE.pollId) {
    clearInterval(LIVE.pollId);
    LIVE.pollId = null;
  }
}
// --- follow targeting: trail the cursor when moving; perch above when idle
function computeTarget() {
  const speed = RUNTIME.speedAvg || 0;
  const hasDir = speed > 40;
  const OFFSET = CONFIG.offset;

  // Desired offset direction (unit vector)
  let desiredX, desiredY;
  if (hasDir) {
    desiredX = -(RUNTIME.velAvg.x / (speed || 1));
    desiredY = -(RUNTIME.velAvg.y / (speed || 1));
  } else {
    desiredX = 0;
    desiredY = -1; // idle: above cursor
  }

  // Lerp offset direction so idle→walk transition glides instead of snapping
  const OD_LERP = 0.08;
  RUNTIME.offsetDir.x += (desiredX - RUNTIME.offsetDir.x) * OD_LERP;
  RUNTIME.offsetDir.y += (desiredY - RUNTIME.offsetDir.y) * OD_LERP;

  RUNTIME.target.x = (RUNTIME.lastMouse?.x || 0) + RUNTIME.offsetDir.x * OFFSET;
  RUNTIME.target.y = (RUNTIME.lastMouse?.y || 0) + RUNTIME.offsetDir.y * OFFSET;
}

// --- 8-way facing from a direction vector (octants) ---
// clockwise from right
const DIR8_KEYS = [
  "right",      // 0
  "frontRight", // 1
  "front",      // 2
  "frontLeft",  // 3
  "left",       // 4
  "backLeft",   // 5
  "back",       // 6
  "backRight"   // 7
];
const DIR8_HYSTERESIS = 8 * Math.PI / 180; // extra angle needed to leave the current octant
let dir8Idx = 2; // "front"

function pickDir8FromVector(vx, vy) {
  const dead = 0.3; // small deadzone to reduce jitter
  if (Math.abs(vx) <= dead && Math.abs(vy) <= dead) return "front";
  // DOM coords: +y is downward => vy>0 means "front"
  const angle = Math.atan2(vy, vx);                  // -PI..PI, 0 = right
  const norm  = (angle + 2 * Math.PI) % (2 * Math.PI); // 0..2PI
  // Sticky octants: only switch once the angle clearly exits the current
  // sector, so facing doesn't flap at diagonal boundaries (22.5°) when the
  // velocity estimate wobbles.
  let diff = norm - dir8Idx * (Math.PI / 4);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > Math.PI / 8 + DIR8_HYSTERESIS) {
    dir8Idx = Math.floor((norm + Math.PI / 8) / (Math.PI / 4)) % 8;
  }
  return DIR8_KEYS[dir8Idx];
}

// Map that direction to a row index using the pack's rows table for the given state
function pickRowForState(stateName, dx, dy) {
  const st = RUNTIME.meta?.states?.[stateName];
  if (!st) return 0;
  const rows = st.rows || { front: 0 };

  // Prefer 8-way if present, else fall back to nearest cardinal.
  // While walking, face the direction the follower is actually travelling —
  // the pos→target vector recomputed every frame in tick() — since that's
  // what's visibly happening on screen (cursor velocity can go stale the
  // moment the cursor stops, while the follower is still catching up).
  // At rest (idle/sleep) there's no travel direction, so always show front.
  // "attack" (wander mode only) plays in place — target is pinned to pos, so
  // dx/dy read ~0 — so face whichever direction it was last moving instead.
  let dir8;
  if (stateName === "walk") dir8 = pickDir8FromVector(dx, dy);
  else if (stateName === "attack") dir8 = pickDir8FromVector(WANDER.lastDir.x, WANDER.lastDir.y);
  else dir8 = "front";
  if (dir8 in rows) return rows[dir8];

  // Map diagonal to nearest cardinal if diagonal key missing
  const fallbackMap = {
    frontRight: "front",
    frontLeft:  "front",
    backRight:  "back",
    backLeft:   "back"
  };
  const fallback = fallbackMap[dir8] || dir8; // if already cardinal, keep it
  return (fallback in rows) ? rows[fallback] : (rows.front ?? 0);
}

// Once the extension is reloaded/updated, tabs that already had this content
// script injected lose their connection to it — chrome.runtime.id becomes
// undefined and any chrome.* call throws "Extension context invalidated".
// Checking this lets us shut down quietly instead of throwing on every frame.
function isExtensionContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function extUrl(rel) { return chrome.runtime.getURL(rel); }

function createFollower() {
  if (followerEl) return;
  followerEl = document.createElement("div");
  followerEl.id = "__vcp1_follower";
  Object.assign(followerEl.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "40px",
    height: "40px",
    pointerEvents: "none",
    zIndex: "2147483647",
    willChange: "transform, background-position, background-image",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated", // crisp for retro sheets
    transition: "transform 120ms linear, width 120ms linear, height 120ms linear"
  });
  document.documentElement.appendChild(followerEl);
}

function removeFollower() {
  if (followerEl?.parentNode) followerEl.parentNode.removeChild(followerEl);
  followerEl = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function packSlug() {
  // STATE.pack like "retro/gen-1/009-blastoise" -> "009-blastoise"
  const parts = STATE.pack.split("/");
  return parts[parts.length - 1];
}

function dexFromSlug(slug) {
  const dex = parseInt((slug || "").split("-")[0], 10);
  return Number.isFinite(dex) ? dex : null;
}

function generationForDex(dex) {
  if (!Number.isFinite(dex)) return null;
  if (dex >= 1 && dex <= 151) return "gen-1";
  if (dex <= 251) return "gen-2";
  if (dex <= 386) return "gen-3";
  if (dex <= 493) return "gen-4";
  if (dex <= 649) return "gen-5";
  if (dex <= 721) return "gen-6";
  if (dex <= 809) return "gen-7";
  if (dex <= 905) return "gen-8";
  return "gen-9";
}

function buildPackCandidates(packKey) {
  const clean = typeof packKey === "string" ? packKey.trim().replace(/^\/+|\/+$/g, "") : "";
  if (!clean) return [DEFAULT_PACK];
  const candidates = [clean];
  if (!clean.includes("/gen-")) {
    const parts = clean.split("/");
    const slug = parts.pop();
    const prefix = parts.join("/");
    const dex = dexFromSlug(slug);
    const inferred = generationForDex(dex);
    const pushCandidate = (gen) => {
      const candidate = `${prefix}/${gen}/${slug}`;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    };
    if (inferred) pushCandidate(inferred);
    GENERATION_DIRS.forEach(pushCandidate);
  }
  return candidates;
}

async function fetchPackMeta(packKey) {
  const jsonPath = `assets/packs/${packKey}.json`;
  const res = await fetch(extUrl(jsonPath));
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} for ${jsonPath}`);
    error.status = res.status;
    throw error;
  }
  const meta = await res.json();
  if (!meta || !meta.states || !meta.states.idle || !meta.states.walk) {
    throw new Error("Pack schema invalid: missing states.idle or states.walk");
  }
  return meta;
}

function sheetUrlFor(stateName) {
  const st = RUNTIME.meta && RUNTIME.meta.states ? RUNTIME.meta.states[stateName] : null;
  const sheetFilename = st && st.sheet ? st.sheet : "";
  const metaPath = typeof RUNTIME.meta?.rawPath === "string" ? RUNTIME.meta.rawPath.trim() : "";
  const slug = metaPath ? metaPath.replace(/^\/+|\/+$/g, "") : packSlug();
  const rawFolder = `assets/raw/${slug}/`;
  return extUrl(rawFolder + sheetFilename);
}

function ensureImagesLoaded(meta) {
  const tasks = [];
  Object.keys(meta.states).forEach((k) => {
    const img = new Image();
    img.src = sheetUrlFor(k);
    RUNTIME.images[k] = img;
    tasks.push(new Promise((resolve) => {
      img.onload = resolve; img.onerror = resolve;
    }));
  });
  return Promise.all(tasks);
}
function resetAnimationForNewPack() {
  // Start from idle; row will be resolved in tick() via pickRowForState
  RUNTIME.anim = { name: "idle", frame: 0, row: 0, accMs: 0 };
}

function applyFrame() {
  const st = RUNTIME.meta && RUNTIME.meta.states && RUNTIME.meta.states[RUNTIME.anim.name];
  if (!st || !st.frame || typeof st.frames !== "number" || !Number.isFinite(st.frames)) {
    // Defensive: if pack schema is missing or wrong, skip this frame rather than crash
    return;
  }
  const { w, h } = st.frame;
  const frame = RUNTIME.anim.frame % st.frames;
  const rowIndex = RUNTIME.anim.row || 0;
  const bpx = -(frame * w);
  const bpy = -(rowIndex * h);

  followerEl.style.width  = `${w}px`;
  followerEl.style.height = `${h}px`;
  followerEl.style.backgroundImage = `url("${sheetUrlFor(RUNTIME.anim.name)}")`;
  // Keep sheet at natural size so backgroundPosition aligns to frame pixels
  const img = RUNTIME.images[RUNTIME.anim.name];
  if (img?.naturalWidth && img?.naturalHeight) {
    followerEl.style.backgroundSize = `${img.naturalWidth}px ${img.naturalHeight}px`;
  }
  followerEl.style.backgroundRepeat = "no-repeat";
  followerEl.style.imageRendering = "pixelated";
  followerEl.style.backgroundPosition = `${bpx}px ${bpy}px`;

  const SCALE_VAL = CONFIG.scale;
  followerEl.style.transform =
    `translate(${Math.round(RUNTIME.pos.x)}px, ${Math.round(RUNTIME.pos.y)}px) ` +
    `translate(-50%, -50%) ` +
    `scale(${SCALE_VAL})`;
  followerEl.style.transformOrigin = "center center";
}

function pickStateBySpeed() {
  const now = performance.now();
  // If the pack has a 'sleep' state and we've been inactive long enough, sleep.
  if (hasState("sleep") && (now - RUNTIME.lastMoveTs) > SLEEP_TIMEOUT_MS) {
    return "sleep";
  }
  // Otherwise mirror the follower's own motion: walking while it's actually
  // travelling toward its target, idle once it arrives — so the animation
  // always matches what's happening on screen rather than the cursor's speed.
  return RUNTIME.isWalking ? "walk" : "idle";
}

// --- wander mode: autonomous roam/pause/nap/attack FSM ---
// Viewport-only (window.innerWidth/Height), so it behaves identically in the
// browser extension and the fullscreen desktop overlay.
const WANDER_MARGIN_EXTRA = 20;                 // px, added to sprite size for edge clearance
const ROAM_PAUSE_MIN_MS = 2000, ROAM_PAUSE_MAX_MS = 8000;
const NAP_MIN_MS = 6000, NAP_MAX_MS = 15000;
const ATTACK_CHANCE = 0.15; // only rolled when the pack has a states.attack sheet
const NAP_CHANCE    = 0.10; // only rolled when the pack has a states.sleep sheet

function randRange(min, max) { return min + Math.random() * (max - min); }

function getSpriteMargin() {
  const st = RUNTIME.meta?.states?.walk;
  const w = st?.frame?.w || 40;
  const h = st?.frame?.h || 40;
  return Math.max(w, h) * CONFIG.scale + WANDER_MARGIN_EXTRA;
}

function clampToViewport(pt) {
  const margin = getSpriteMargin();
  const maxX = Math.max(margin, window.innerWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - margin);
  pt.x = Math.min(Math.max(pt.x, margin), maxX);
  pt.y = Math.min(Math.max(pt.y, margin), maxY);
}

function pickRoamWaypoint() {
  const margin = getSpriteMargin();
  const maxX = Math.max(margin, window.innerWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - margin);
  return { x: randRange(margin, maxX), y: randRange(margin, maxY) };
}

function enterRoam() {
  WANDER.state = "roam";
  const wp = pickRoamWaypoint();
  RUNTIME.target.x = wp.x;
  RUNTIME.target.y = wp.y;
}

function enterPause() {
  WANDER.state = "pause";
  WANDER.until = performance.now() + randRange(ROAM_PAUSE_MIN_MS, ROAM_PAUSE_MAX_MS);
  RUNTIME.target.x = RUNTIME.pos.x; // stand still — no drift while paused
  RUNTIME.target.y = RUNTIME.pos.y;
}

function enterNap() {
  WANDER.state = "nap";
  WANDER.until = performance.now() + randRange(NAP_MIN_MS, NAP_MAX_MS);
  RUNTIME.target.x = RUNTIME.pos.x;
  RUNTIME.target.y = RUNTIME.pos.y;
}

function enterAttack() {
  WANDER.state = "attack";
  WANDER.attackCyclesLeft = 1 + Math.floor(Math.random() * 2); // 1 or 2 full cycles
  RUNTIME.target.x = RUNTIME.pos.x;
  RUNTIME.target.y = RUNTIME.pos.y;
}

// Decide what happens once a PAUSE's idle timer runs out. Each branch is its
// own independent roll (gated on the pack actually having that sheet), so if
// a pack has no attack/sleep sheet those odds simply fall through to roam.
function choosePostPause() {
  if (hasState("attack") && Math.random() < ATTACK_CHANCE) { enterAttack(); return; }
  if (hasState("sleep") && Math.random() < NAP_CHANCE) { enterNap(); return; }
  enterRoam();
}

// Advance the FSM's own timers/arrivals. "attack" is advanced separately, by
// frame-cycle counting in tick()'s animation stepper below (it needs to count
// sprite-sheet loops, not wall-clock time).
function tickWander(now) {
  if (!WANDER.state) { enterRoam(); return; }
  if (WANDER.state === "roam") {
    if (!RUNTIME.isWalking) enterPause(); // arrived at the waypoint last frame
  } else if (WANDER.state === "pause") {
    if (now >= WANDER.until) choosePostPause();
  } else if (WANDER.state === "nap") {
    if (now >= WANDER.until) enterRoam(); // wake up and move on
  }
}

function wanderDesiredState() {
  switch (WANDER.state) {
    case "roam":   return RUNTIME.isWalking ? "walk" : "idle";
    case "nap":    return hasState("sleep") ? "sleep" : "idle";
    case "attack": return hasState("attack") ? "attack" : "idle";
    case "pause":
    default:       return "idle";
  }
}

// Keep the roam waypoint (and the follower itself, if it's standing still in
// pause/nap/attack) inside a viewport that just got resized.
function onViewportResize() {
  if (STATE.mode !== "wander") return;
  clampToViewport(RUNTIME.pos);
  clampToViewport(RUNTIME.target);
}
window.addEventListener("resize", onViewportResize, { passive: true });

function tick(dtMs) {
  const now = performance.now();

  if (STATE.mode === "wander") {
    tickWander(now);
  } else {
    // Once mousemove events stop arriving (cursor idle, or the desktop app's
    // 60Hz feed pauses), velAvg would otherwise stay frozen on the last sampled
    // direction forever. Decay it back toward zero so computeTarget's hasDir
    // check naturally drops out (ending the perch-drift) — facing itself no
    // longer reads velAvg (see pickRowForState), so this only affects offset.
    if (now - RUNTIME.lastMoveTs > VEL_DECAY_DELAY_MS) {
      const decay = Math.exp(-dtMs / VEL_DECAY_TAU_MS);
      RUNTIME.velAvg.x *= decay;
      RUNTIME.velAvg.y *= decay;
      RUNTIME.speedAvg = Math.hypot(RUNTIME.velAvg.x, RUNTIME.velAvg.y);
    }

    // follow feel: walk toward the target at a steady pace, like it's actually
    // travelling there on its own — not eased/snapped toward a moving point on a
    // leash. Direction is recomputed every frame, so it turns naturally as the
    // target (cursor) moves, and eases to a stop on arrival instead of overshooting.
    computeTarget();
  }

  const dx = RUNTIME.target.x - RUNTIME.pos.x;
  const dy = RUNTIME.target.y - RUNTIME.pos.y;
  const dist = Math.hypot(dx, dy);

  const desired = STATE.mode === "wander" ? wanderDesiredState() : pickStateBySpeed();
  if (desired !== RUNTIME.anim.name) {
    // Queue the switch; wait for current cycle to finish before committing
    if (!RUNTIME.pendingState || RUNTIME.pendingState.name !== desired) {
      RUNTIME.pendingState = { name: desired, queuedAt: performance.now() };
    }
    const st = RUNTIME.meta.states[RUNTIME.anim.name];
    const atCycleEnd = RUNTIME.anim.frame >= st.frames - 1;
    const timedOut = (performance.now() - RUNTIME.pendingState.queuedAt) > 300;
    if (atCycleEnd || timedOut) {
      const enteringAttack = RUNTIME.pendingState.name === "attack";
      RUNTIME.anim.name = RUNTIME.pendingState.name;
      RUNTIME.anim.row  = pickRowForState(RUNTIME.anim.name, dx, dy);
      // Start attack cleanly from its first frame so cycle-counting below
      // (which needs a real wraparound to detect "one full cycle") is exact.
      if (enteringAttack) { RUNTIME.anim.frame = 0; RUNTIME.anim.accMs = 0; }
      RUNTIME.pendingState = null;
    }
  } else {
    RUNTIME.pendingState = null;
  }

  if (dist > ARRIVE_RADIUS_PX) {
    const walkSpeed = walkSpeedFromConfig(); // px/s
    const speed = dist < SLOW_RADIUS_PX ? walkSpeed * (dist / SLOW_RADIUS_PX) : walkSpeed;
    // Clamp the per-frame delta so a long frame gap (e.g. tab was backgrounded)
    // can't teleport the follower — it just keeps walking once frames resume.
    const moveDtMs = Math.min(dtMs, 50);
    const moveDist = Math.min(dist, speed * (moveDtMs / 1000));

    RUNTIME.pos.x += (dx / dist) * moveDist;
    RUNTIME.pos.y += (dy / dist) * moveDist;
    RUNTIME.isWalking = true;
    WANDER.lastDir.x = dx;
    WANDER.lastDir.y = dy;
  } else {
    RUNTIME.isWalking = false;
  }

  const st = RUNTIME.meta.states[RUNTIME.anim.name];
  const msPerFrame = 1000 / st.fps;
  RUNTIME.anim.accMs += dtMs;
  while (RUNTIME.anim.accMs >= msPerFrame) {
    RUNTIME.anim.accMs -= msPerFrame;
    const prevFrame = RUNTIME.anim.frame;
    RUNTIME.anim.frame = (RUNTIME.anim.frame + 1) % st.frames;
    // Count full attack loops by wraparound, then hand control back to idle
    // once the FSM's 1-2 cycle budget is spent (see enterAttack()).
    if (STATE.mode === "wander" && WANDER.state === "attack" && RUNTIME.anim.name === "attack" && RUNTIME.anim.frame < prevFrame) {
      WANDER.attackCyclesLeft -= 1;
      if (WANDER.attackCyclesLeft <= 0) enterPause();
    }
  }

  // Keep the row updated continuously for natural facing
  if (RUNTIME.meta && RUNTIME.meta.states) {
    RUNTIME.anim.row = pickRowForState(RUNTIME.anim.name, dx, dy);
  }
  applyFrame();
}

// Cleanly stop everything once the extension context has been invalidated
// (e.g. the extension was reloaded/updated while this page stayed open).
// No more chrome.* calls will work here, so just remove our DOM/listeners.
function teardownInvalidatedContext() {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("resize", onViewportResize);
  stopLocalPoll();
  removeFollower();
  running = false;
}

function loop() {
  let last = performance.now();
  const step = () => {
    if (!isExtensionContextValid()) {
      teardownInvalidatedContext();
      return;
    }
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (followerEl && RUNTIME.meta) tick(dt);
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

const VEL_SMOOTH_TAU_MS = 60;     // velocity smoothing time constant
const TELEPORT_SPEED_PXPS = 8000; // instantaneous speed treated as a jump, not motion

function onMouseMove(e) {
  const now = performance.now();

  // update last mouse and velocity estimate
  const dt = Math.max(1, now - (RUNTIME.lastMouse.t || now)); // ms
  const vx = (e.clientX - RUNTIME.lastMouse.x) * (1000 / dt); // px/s
  const vy = (e.clientY - RUNTIME.lastMouse.y) * (1000 / dt); // px/s

  // Time-based smoothing so direction/speed behave the same at any event
  // rate (browsers fire mousemove at 60–1000Hz; the desktop app feeds ~60Hz).
  // Teleport-sized deltas (tab switches, display hops) are skipped — they
  // would inject a huge spike into the velocity average and whip the facing.
  if (Math.hypot(vx, vy) < TELEPORT_SPEED_PXPS) {
    const SMOOTH = 1 - Math.exp(-dt / VEL_SMOOTH_TAU_MS);
    RUNTIME.velAvg.x = RUNTIME.velAvg.x * (1 - SMOOTH) + vx * SMOOTH;
    RUNTIME.velAvg.y = RUNTIME.velAvg.y * (1 - SMOOTH) + vy * SMOOTH;
    RUNTIME.speedAvg = Math.hypot(RUNTIME.velAvg.x, RUNTIME.velAvg.y);
  }

  RUNTIME.lastMouse.x = e.clientX;
  RUNTIME.lastMouse.y = e.clientY;
  RUNTIME.lastMouse.t = now;
  RUNTIME.lastMoveTs = now;
}

function start() {
  if (running) return;
  running = true;
  createFollower();
  RUNTIME.lastMoveTs = performance.now();
  // initialize position/target around current mouse (in case no movement yet)
  RUNTIME.pos.x = RUNTIME.lastMouse.x;
  RUNTIME.pos.y = RUNTIME.lastMouse.y;
  RUNTIME.target.x = RUNTIME.lastMouse.x;
  RUNTIME.target.y = RUNTIME.lastMouse.y;

  window.addEventListener("mousemove", onMouseMove, { passive: true });
  loop();
}

function stop() {
  if (!running) return;
  running = false;
  window.removeEventListener("mousemove", onMouseMove);
  removeFollower();
}

async function loadPack(packKey) {
  const candidates = buildPackCandidates(packKey);
  let chosen = null;
  let meta = null;
  let lastError = null;

  for (const candidate of candidates) {
    try {
      meta = await fetchPackMeta(candidate);
      chosen = candidate;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!chosen || !meta) {
    throw lastError || new Error(`Unable to load pack for key "${packKey}"`);
  }

  const migrated = chosen !== packKey;
  if (migrated) {
    try { chrome.storage.sync.set({ vcp1_pack: chosen }); } catch (_) {}
  }
  STATE.pack = chosen;
  RUNTIME.meta = meta;
  // reset animation state for the new pack
  resetAnimationForNewPack();
  await ensureImagesLoaded(meta);
  // Restart animation loop if switching packs while active
  if (followerEl) removeFollower();
  if (running) {
    createFollower();
    loop();
  }
}

function applyState() {
  if (STATE.enabled) start(); else stop();
}

// boot
chrome.storage.sync.get(
  ["vcp1_enabled", "vcp1_pack", "vcp1_scale", "vcp1_offset", "vcp1_lerp", "vcp1_mode"],
  async (res) => {
    STATE.enabled = !!res.vcp1_enabled;
    STATE.pack    = res.vcp1_pack || DEFAULT_PACK;
    STATE.mode    = res.vcp1_mode === "wander" ? "wander" : "follow";
    applyConfigPatch(res);
    try {
      await loadPack(STATE.pack);
    } catch (e) {
      console.warn("pack load failed; reverting to default", e);
      STATE.pack = DEFAULT_PACK;
      try { await loadPack(STATE.pack); } catch (e2) { console.warn("default pack also failed", e2); }
    }
    applyState();
  }
);

// react to popup changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  if (changes.vcp1_enabled) {
    STATE.enabled = !!changes.vcp1_enabled.newValue;
    applyState();
  }
  if (changes.vcp1_pack) {
    const prev = STATE.pack;
    STATE.pack = changes.vcp1_pack.newValue || DEFAULT_PACK;
    try {
      await loadPack(STATE.pack);
      // If follower exists, immediately apply a frame from the new sheet
      if (followerEl) applyFrame();
    } catch (e) {
      console.warn("pack switch failed; restoring previous pack", e);
      STATE.pack = prev;
      try { await loadPack(STATE.pack); } catch (e2) { console.warn("restore previous pack failed", e2); }
      if (followerEl) applyFrame();
    }
  }
  if (changes.vcp1_scale || changes.vcp1_offset || changes.vcp1_lerp) {
    const patch = {
      vcp1_scale:  changes.vcp1_scale  ? Number(changes.vcp1_scale.newValue)  : undefined,
      vcp1_offset: changes.vcp1_offset ? Number(changes.vcp1_offset.newValue) : undefined,
      vcp1_lerp:   changes.vcp1_lerp   ? Number(changes.vcp1_lerp.newValue)   : undefined,
    };
    applyConfigPatch(patch);
    // no restart needed; next frame uses updated CONFIG
  }
  if (changes.vcp1_mode) {
    const nextMode = changes.vcp1_mode.newValue === "wander" ? "wander" : "follow";
    if (nextMode !== STATE.mode) {
      STATE.mode = nextMode;
      // Force the wander FSM to restart fresh next time wander is (re)entered;
      // switching to follow needs no extra work — computeTarget() just takes
      // over from wherever the follower currently stands.
      if (nextMode === "follow") WANDER.state = null;
    }
  }
});

// listen for live slider updates and drag state from popup.js
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;

  if (msg.type === "vcp1_config" && msg.patch) {
    applyConfigPatch(msg.patch);
    if (followerEl && RUNTIME.meta) applyFrame();
    return;
  }

  if (msg.type === "vcp1_drag") {
    const on = !!msg.dragging;
    if (on && !LIVE.dragging) {
      LIVE.dragging = true;
      startLocalPoll();
    } else if (!on && LIVE.dragging) {
      LIVE.dragging = false;
      stopLocalPoll();
    }
  }
});

window.addEventListener("beforeunload", () => { stopLocalPoll(); stop(); });
