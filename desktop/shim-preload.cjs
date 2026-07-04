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

// On macOS, a click-through (setIgnoreMouseEvents) BrowserWindow can still
// receive genuine native "mousemove" events whenever the real system cursor
// passes over it, even though clicks/hover otherwise fall through to
// whatever's beneath. The overlay's actual cursor signal always arrives via
// the synthetic (untrusted) redispatch above, so a trusted mousemove here
// would be a second, uncoordinated position source — drop it before
// content.js's own listener (registered later, once the page script loads)
// ever sees it.
window.addEventListener("mousemove", (e) => {
  if (e.isTrusted) e.stopImmediatePropagation();
}, true);

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
        smokeLangProbe();
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

// Switch the settings popup to Korean through the real user path — a click on
// the "한글" language button — then confirm the pack list actually relabels to
// Hangul. Poll up to 3s because relabeling waits on the Korean names fetch.
function smokeLangProbe() {
  const HANGUL = /[가-힣]/;
  const pack = document.getElementById("pack");
  const koBtn = document.querySelector('#lang .langOpt[data-lang="ko"]');
  if (!pack || !koBtn) {
    ipcRenderer.send("vcp1:smoke-lang", "fail:no-control");
    return;
  }
  koBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const deadline = Date.now() + 3000;
  const poll = setInterval(() => {
    const labels = Array.from(pack.options).map((o) => o.textContent || "");
    if (labels.some((t) => HANGUL.test(t))) {
      clearInterval(poll);
      ipcRenderer.send("vcp1:smoke-lang", "ok");
    } else if (Date.now() > deadline) {
      clearInterval(poll);
      ipcRenderer.send("vcp1:smoke-lang", `fail:${labels[0] || ""}`);
    }
  }, 100);
}

// Sample background-position-y a few times (~50ms apart) and require them to
// all agree with `expected` before accepting — a single-instant style read
// can catch a torn/mid-render frame, so this confirms the row is genuinely
// settled rather than a one-frame blip, without loosening what's required.
function sampleRowSettled(expected, cb) {
  const SAMPLE_COUNT = 4;
  const samples = [];
  const poll = setInterval(() => {
    const el = document.getElementById("__vcp1_follower");
    samples.push(el ? (el.style.backgroundPosition.split(" ")[1] || "") : "");
    if (samples.length >= SAMPLE_COUNT) {
      clearInterval(poll);
      cb(samples.every((s) => s === expected), samples);
    }
  }, 50);
}

// Drive a steady upward cursor motion and check the sprite actually uses the
// "back" row (default pack: row 4, 40px frames → background-position-y -160px),
// then stop feeding and confirm it settles back to "front" (row 0 → "0px")
// once velAvg decays and the follower arrives at its perch. Only one final
// result is sent — main.cjs gates on a single "facing" outcome.
function smokeFacingProbe() {
  // Prime: the follower starts wherever it booted (e.g. 0,0, well off-screen
  // from our test point), and facing while walking now tracks the actual
  // pos→target travel vector. Measuring immediately would catch it mid
  // catch-up toward (600,800) — a real but unrelated direction — so park the
  // cursor there first and let it arrive before starting the timed up-feed.
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 600, clientY: 800 }));
  setTimeout(() => {
    let y = 800;
    const feed = setInterval(() => {
      y -= 8;
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 600, clientY: y }));
    }, 16);
    setTimeout(() => {
      clearInterval(feed);
      sampleRowSettled("-160px", (ok, samples) => {
        if (!ok) {
          const el = document.getElementById("__vcp1_follower");
          const diag = el ? { bg: el.style.backgroundPosition, img: el.style.backgroundImage, w: el.style.width, h: el.style.height } : "no-el";
          ipcRenderer.send("vcp1:smoke-facing", `fail:back:${samples.join(",")}:${JSON.stringify(diag)}`);
          return;
        }
        // Feed stopped; wait for velAvg decay + arrival at the idle perch,
        // then confirm the sprite faces front again instead of staying
        // frozen on back.
        setTimeout(() => {
          sampleRowSettled("0px", (ok2, samples2) => {
            if (!ok2) {
              const el2 = document.getElementById("__vcp1_follower");
              const diag2 = el2 ? { bg: el2.style.backgroundPosition, img: el2.style.backgroundImage, w: el2.style.width, h: el2.style.height } : "no-el";
              ipcRenderer.send("vcp1:smoke-facing", `fail:front:${samples2.join(",")}:${JSON.stringify(diag2)}`);
              return;
            }
            ipcRenderer.send("vcp1:smoke-facing", "ok");
            smokeWanderProbe();
          });
        }, 2500);
      });
    }, 900);
  }, 4500);
}

// Switch to wander mode the same way the popup's mode toggle would (a
// storage write — there's no mode-toggle UI in the overlay window itself),
// then feed NO cursor input at all and confirm the follower (a) moves on its
// own and (b) never strays outside the viewport. The wander FSM always starts
// in "roam" (see content.js's WANDER.state lazy-init), so movement begins
// immediately — poll with early-exit instead of a fixed sample-then-evaluate
// window so a stray PAUSE right after an unlucky near-instant waypoint arrival
// can't make an otherwise-passing run look stalled.
function smokeWanderProbe() {
  window.chrome.storage.sync.set({ vcp1_mode: "wander" }, () => {
    setTimeout(() => {
      const start = Date.now();
      const deadline = start + 10000; // covers a worst-case 8s PAUSE backstop
      const MOVE_THRESHOLD_PX = 15;
      let last = readFollowerPos();
      let moved = 0;
      const poll = setInterval(() => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const p = readFollowerPos();
        if (p) {
          if (p.x < -1 || p.x > vw + 1 || p.y < -1 || p.y > vh + 1) {
            clearInterval(poll);
            ipcRenderer.send("vcp1:smoke-wander", `fail:oob:${JSON.stringify(p)}`);
            return;
          }
          if (last) moved += Math.hypot(p.x - last.x, p.y - last.y);
          last = p;
          if (moved >= MOVE_THRESHOLD_PX) {
            clearInterval(poll);
            ipcRenderer.send("vcp1:smoke-wander", "ok");
            return;
          }
        }
        if (Date.now() >= deadline) {
          clearInterval(poll);
          ipcRenderer.send("vcp1:smoke-wander", `fail:no-movement:${moved.toFixed(2)}`);
        }
      }, 100);
    }, 250);
  });
}

function readFollowerPos() {
  const el = document.getElementById("__vcp1_follower");
  const m = el && /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || "");
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}
