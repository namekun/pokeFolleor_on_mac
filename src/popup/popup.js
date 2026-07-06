const DEFAULT_PACK = "retro/gen-1/001-bulbasaur";

document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const packEl    = document.getElementById("pack");
  const pickerEl  = document.querySelector(".picker");
  const searchBtn = pickerEl ? pickerEl.querySelector(".glass") : null;
  const searchEl  = document.getElementById("packSearch");
  const searchListEl = document.getElementById("packSuggestions");
  const shuffleBtn = document.querySelector(".shuffle");

  // Normalize pack <option>s: sort by Pokédex number and label as "###-Name"
  function titleCaseSlug(name) {
    return String(name || "")
      .split("-")
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join("-");
  }
  function formatPackLabel(val) {
    // val looks like "retro/gen-1/009-blastoise"
    const last = (val || "").split("/").pop() || "";
    const dash = last.indexOf("-");
    const numStr = dash >= 0 ? last.slice(0, dash) : last;
    const nameSlug = dash >= 0 ? last.slice(dash + 1) : "";
    const num = (numStr || "").padStart(3, "0");
    const name = nameSlug ? titleCaseSlug(nameSlug) : last;
    return `${num}-${name}`;
  }
  function dexFromValue(val) {
    const last = (val || "").split("/").pop() || "";
    const n = parseInt(last, 10);
    return Number.isFinite(n) ? n : 9999;
  }

  // --- Localization (English default, optional Korean names) ---
  const KO_NAMES = {};          // { "001": "이상해씨", ... } keyed by 3-digit dex
  let CUR_LANG = "en";          // "en" | "ko"
  const langEl = document.getElementById("lang");

  // --- Mode toggle (follow the cursor vs. wander the screen autonomously) ---
  let CUR_MODE = "follow";      // "follow" | "wander"
  const modeEl = document.getElementById("mode");
  const MODE_LABELS = {
    follow: { en: "Follow", ko: "따라오기" },
    wander: { en: "Wander", ko: "배회하기" }
  };
  function updateModeUI() {
    if (!modeEl) return;
    for (const btn of Array.from(modeEl.querySelectorAll(".langOpt"))) {
      btn.setAttribute("aria-pressed", btn.dataset.mode === CUR_MODE ? "true" : "false");
    }
  }
  function applyModeLabels() {
    if (!modeEl) return;
    for (const btn of Array.from(modeEl.querySelectorAll(".langOpt"))) {
      const m = btn.dataset.mode === "wander" ? "wander" : "follow";
      btn.textContent = MODE_LABELS[m][CUR_LANG] || MODE_LABELS[m].en;
    }
  }

  // "retro/gen-1/025-pikachu" -> "025" (empty when not derivable)
  function dexKeyFromValue(val) {
    const last = (val || "").split("/").pop() || "";
    const dash = last.indexOf("-");
    const numStr = dash >= 0 ? last.slice(0, dash) : last;
    const n = parseInt(numStr, 10);
    return Number.isFinite(n) ? String(n).padStart(3, "0") : "";
  }
  function koNameForValue(val) {
    const key = dexKeyFromValue(val);
    return key && KO_NAMES[key] ? KO_NAMES[key] : null;
  }
  // English label an option was built with (survives Korean relabeling)
  function enLabelForOption(opt) {
    return (opt && (opt.dataset.enLabel || formatPackLabel(opt.value))) || "";
  }
  // Display label for the current language: "025-피카츄" in ko, else English
  function labelForOption(opt) {
    const enLabel = enLabelForOption(opt);
    if (CUR_LANG === "ko") {
      const ko = koNameForValue(opt.value);
      if (ko) {
        const key = dexKeyFromValue(opt.value);
        return key ? `${key}-${ko}` : ko;
      }
    }
    return enLabel;
  }
  // Locked options get a 🔒 prefix on top of the language-aware base label.
  function finalLabelForOption(opt) {
    const base = labelForOption(opt);
    return opt.disabled ? `🔒 ${base}` : base;
  }
  function applyLangToOptions() {
    if (!packEl) return;
    for (const opt of Array.from(packEl.options)) {
      opt.textContent = finalLabelForOption(opt);
    }
  }
  function updateLangUI() {
    if (!langEl) return;
    for (const btn of Array.from(langEl.querySelectorAll(".langOpt"))) {
      btn.setAttribute("aria-pressed", btn.dataset.lang === CUR_LANG ? "true" : "false");
    }
  }
  // Switch language: relabel options, rebuild search meta/datalist, reflect UI.
  // Selection (packEl.value) is untouched.
  function applyLang(lang) {
    CUR_LANG = (lang === "ko") ? "ko" : "en";
    applyLangToOptions();
    capturePackMeta();
    updateLangUI();
    applyModeLabels();
  }
  // Best-effort fetch of Korean names; silent English fallback on failure.
  async function loadKoNames() {
    try {
      const url = chrome.runtime.getURL("assets/packs/names-ko.json");
      const res = await fetch(url);
      if (!res.ok) throw new Error("names-ko.json not found");
      const data = await res.json();
      if (data && typeof data === "object") Object.assign(KO_NAMES, data);
    } catch (e) {
      console.warn("PokeFollower: Korean names unavailable, using English", e);
    }
  }

  // --- Evolution lock + growth (XP/level) display (Phase 1) ---
  // Pure XP curve duplicated from content.js's engine -- LEVEL_XP_BASE must
  // stay in sync with that file (see its "evolution / growth" section for
  // the full design rationale). Two independent scripts, no shared module
  // system in this codebase (same as DEFAULT_PACK above already differing).
  const LEVEL_XP_BASE = 5; // xpForLevel(L) = LEVEL_XP_BASE * (L-1)^2
  function xpForLevel(level) {
    const n = Math.max(1, level) - 1;
    return LEVEL_XP_BASE * n * n;
  }
  function levelForXp(xp) {
    return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_XP_BASE));
  }

  let EVOLUTIONS = {};             // { [dex3]: { to: [{ dex, level }] } }
  const LOCKED_DEX = new Set();    // dex3 strings that are *someone's* evolution result
  let UNLOCKED_DEX = new Set();    // dex3 strings the user has unlocked
  let GROWTH_DATA = {};            // { [dex3]: { xp } }
  let PENDING_EVOLUTION = null;    // { dex, choices: [{dex, level}] } | null

  const GROWTH_LABELS = {
    evolvesAt: { en: (lv) => `Evolves at Lv.${lv}`, ko: (lv) => `Lv.${lv}에 진화` },
    finalForm: { en: "Final form", ko: "최종 진화형" },
    chooseEvolution: { en: "Choose evolution:", ko: "진화를 선택하세요:" },
    hunger: { en: (pct) => `Hunger: ${pct}%`, ko: (pct) => `배고픔: ${pct}%` },
    feedButton: { en: "Feed", ko: "밥 주기" }
  };
  // Simple emoji-level gauge (per spec: no separate bar/animation system) --
  // three tiers matching the same feel as HUNGER_SAD_THRESHOLD (70) in content.js.
  function hungerEmoji(pct) {
    if (pct >= 70) return "😣";
    if (pct >= 30) return "😐";
    return "😊";
  }

  // Best-effort fetch of the evolution graph; silent fallback (nothing
  // locked) on failure -- same pattern as loadKoNames() below.
  async function loadEvolutions() {
    try {
      const url = chrome.runtime.getURL("assets/packs/evolutions.json");
      const res = await fetch(url);
      if (!res.ok) throw new Error("evolutions.json not found");
      const data = await res.json();
      if (data && typeof data === "object") {
        EVOLUTIONS = data;
        // A baby's own immediate evolution (e.g. Pichu -> Pikachu) is exempt
        // from the lock: nobody starts with a baby (it only appears via
        // breeding), so its result is selectable from the start. The baby's
        // own further evolution (e.g. Pikachu -> Raichu) still locks as usual.
        for (const key of Object.keys(data)) {
          if (data[key].baby) continue;
          for (const t of (data[key].to || [])) LOCKED_DEX.add(t.dex);
        }
      }
    } catch (e) {
      console.warn("PokeFollower: evolutions.json unavailable, all packs unlocked", e);
    }
  }

  function optionForDex3(dex3) {
    if (!packEl) return null;
    return Array.from(packEl.options).find((o) => dexKeyFromValue(o.value) === dex3);
  }

  // Disable (and later, prefix 🔒 via finalLabelForOption) any option that's
  // a locked evolution result the user hasn't unlocked -- except the
  // currently-selected pack, which always displays as selectable regardless
  // of lock state (avoids a migration-timing race where this popup reads
  // vcp1_unlocked before content.js's own migration write lands).
  function applyLockState() {
    if (!packEl) return;
    const current = dexKeyFromValue(packEl.value);
    for (const opt of Array.from(packEl.options)) {
      const dex3 = dexKeyFromValue(opt.value);
      opt.disabled = !!dex3 && LOCKED_DEX.has(dex3) && !UNLOCKED_DEX.has(dex3) && dex3 !== current;
    }
  }

  function currentDex3() {
    return dexKeyFromValue(packEl ? packEl.value : "");
  }

  function renderGrowthUI() {
    if (!levelLabelEl || !xpBarFillEl || !evolveHintEl) return;
    const dex3 = currentDex3();
    const xp = (GROWTH_DATA[dex3] && GROWTH_DATA[dex3].xp) || 0;
    const level = levelForXp(xp);
    levelLabelEl.textContent = `Lv. ${level}`;
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const pct = next > base ? Math.min(100, Math.max(0, ((xp - base) / (next - base)) * 100)) : 100;
    xpBarFillEl.style.width = `${pct}%`;

    const entry = EVOLUTIONS[dex3];
    if (!entry || !entry.to || !entry.to.length) {
      evolveHintEl.textContent = GROWTH_LABELS.finalForm[CUR_LANG] || GROWTH_LABELS.finalForm.en;
    } else {
      const minLevel = Math.min(...entry.to.map((t) => t.level));
      const fn = GROWTH_LABELS.evolvesAt[CUR_LANG] || GROWTH_LABELS.evolvesAt.en;
      evolveHintEl.textContent = fn(minLevel);
    }

    if (hungerLabelEl && hungerEmojiEl) {
      const hunger = Math.max(0, Math.min(100, (GROWTH_DATA[dex3] && GROWTH_DATA[dex3].hunger) || 0));
      const pct = Math.round(hunger);
      const fn = GROWTH_LABELS.hunger[CUR_LANG] || GROWTH_LABELS.hunger.en;
      hungerLabelEl.textContent = fn(pct);
      hungerEmojiEl.textContent = hungerEmoji(pct);
    }
    if (feedBtnEl) feedBtnEl.textContent = GROWTH_LABELS.feedButton[CUR_LANG] || GROWTH_LABELS.feedButton.en;
  }

  function renderEvolveChoice() {
    if (!evolveChoiceEl || !evolveChoiceButtonsEl || !evolveChoiceLabelEl) return;
    const dex3 = currentDex3();
    const show = !!(PENDING_EVOLUTION && PENDING_EVOLUTION.dex === dex3 && Array.isArray(PENDING_EVOLUTION.choices));
    evolveChoiceEl.hidden = !show;
    if (!show) return;
    evolveChoiceLabelEl.textContent = GROWTH_LABELS.chooseEvolution[CUR_LANG] || GROWTH_LABELS.chooseEvolution.en;
    evolveChoiceButtonsEl.innerHTML = "";
    for (const choice of PENDING_EVOLUTION.choices) {
      const opt = optionForDex3(choice.dex);
      if (!opt) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = labelForOption(opt);
      btn.addEventListener("click", () => {
        // Disable immediately -- content.js's own reentrancy guard is the
        // real fix for a double-click, but the storage round-trip that
        // clears PENDING_EVOLUTION (and re-hides this section) isn't
        // instant, so a fast second click here shouldn't even get a chance to fire.
        Array.from(evolveChoiceButtonsEl.querySelectorAll("button")).forEach((b) => { b.disabled = true; });
        // Storage write (fresh {to, ts} object each click, so onChanged
        // always fires), same "vcp1_feed_trigger" pattern used by the Feed
        // button above. NOT chrome.runtime.sendMessage: in a real
        // (non-Electron) Chrome extension with no background page,
        // runtime.sendMessage from a popup never reaches a content script in
        // a tab (only tabs.sendMessage from a background context does) --
        // this silently broke branch-evolution picking (e.g. Eevee) in a
        // real browser install, only appearing to work in the Electron
        // desktop app because its shim broadcasts messages to all windows
        // directly. storage.onChanged is the mechanism already proven to
        // reach content.js for vcp1_pack/vcp1_mode/vcp1_feed_trigger/etc.
        try { chrome.storage.sync.set({ vcp1_evolve_trigger: { to: choice.dex, ts: Date.now() } }); } catch (_) {}
      });
      evolveChoiceButtonsEl.appendChild(btn);
    }
  }

  const PACK_META = [];
  function normalizePackOptions() {
    if (!packEl) return;
    const opts = Array.from(packEl.options).map(o => ({ value: o.value }));
    // sort numerically by dex
    opts.sort((a, b) => dexFromValue(a.value) - dexFromValue(b.value));
    // preserve current selection
    const current = packEl.value;
    // rebuild options with formatted labels
    packEl.innerHTML = "";
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.dataset.enLabel = formatPackLabel(o.value);
      opt.textContent = labelForOption(opt);
      packEl.appendChild(opt);
    }
    // restore selection if possible
    if (current) packEl.value = current;
    capturePackMeta();
  }

  // Dynamically build the pack list from a generated index.json; fallback to existing options on error
  async function populatePacksFromIndex(storedValue) {
    try {
      const url = chrome.runtime.getURL('assets/packs/index.json');
      const res = await fetch(url);
      if (!res.ok) throw new Error('index not found');
      const data = await res.json();
      const list = (data && data.retro) || [];
      if (!Array.isArray(list) || !list.length) throw new Error('index empty');

      const current = storedValue || packEl.value;
      packEl.innerHTML = '';
      for (const item of list) {
        const opt = document.createElement('option');
        opt.value = item.id;                       // e.g., "retro/gen-1/009-blastoise"
        opt.dataset.enLabel = item.name || formatPackLabel(item.id);
        opt.textContent = labelForOption(opt);
        packEl.appendChild(opt);
      }
      capturePackMeta();
      if (current) {
        packEl.value = current;
        if (packEl.selectedIndex === -1 && packEl.options.length) {
          packEl.selectedIndex = 0;
        }
      }
      return true;
    } catch (e) {
      // Defer to static HTML options if index missing
      return false;
    }
  }

  // Sliders + readouts
  const scaleEl   = document.getElementById("scale");
  const offsetEl  = document.getElementById("offset");
  const lerpEl    = document.getElementById("lerp");

  const scaleVal  = document.getElementById("scaleVal");
  const offsetVal = document.getElementById("offsetVal");
  const lerpVal   = document.getElementById("lerpVal");
  const previewSpriteEl = document.getElementById("previewSprite");

  // Growth (level/XP) + branch-evolution choice UI
  const levelLabelEl = document.getElementById("levelLabel");
  const xpBarFillEl  = document.getElementById("xpBarFill");
  const evolveHintEl = document.getElementById("evolveHint");
  const evolveChoiceEl = document.getElementById("evolveChoice");
  const evolveChoiceLabelEl = document.getElementById("evolveChoiceLabel");
  const evolveChoiceButtonsEl = document.getElementById("evolveChoiceButtons");
  const moodPreviewEl = document.getElementById("moodPreview");
  const hungerLabelEl = document.getElementById("hungerLabel");
  const hungerEmojiEl = document.getElementById("hungerEmoji");
  const feedBtnEl = document.getElementById("feedBtn");

  // Defaults align with current content.js constants
  const DEFAULTS = {
    vcp1_scale: 1.25,   // SCALE
    vcp1_offset: 30,    // OFFSET_PX
    vcp1_lerp: 0.20     // LERP_ALPHA (lower = floatier/slower follow)
  };

  // --- Hot-path local writes + dragging signal for smooth live updates ---
  const setLocal = (patch) => chrome.storage.local.set(patch);
  // let dragging = false;
  // function setDragging(on) {
  //   if (dragging === on) return;
  //   dragging = on;
  //   try { chrome.runtime.sendMessage({ type: "vcp1_drag", dragging }); } catch (_) {}
  // }

  // Debounced persist + live-apply to content scripts
  let pending = {};
  let saveTimer = null;

  function pushConfig(patch, { flush = false } = {}) {
    // 1) Live-apply immediately in active tabs without hitting sync limits
    try { chrome.runtime.sendMessage({ type: "vcp1_config", patch }); } catch (_) {}

    // 2) Batch+debounce writes to chrome.storage.sync to avoid rate limiting
    Object.assign(pending, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const toSave = { ...pending };
      pending = {};
      chrome.storage.sync.set(toSave, () => {});
    }, 250);

    if (flush) {
      clearTimeout(saveTimer);
      if (Object.keys(pending).length) {
        const toSaveNow = { ...pending };
        pending = {};
        chrome.storage.sync.set(toSaveNow, () => {});
      }
    }
  }

  const asNum = (v) => Number(v);

  // Load saved settings
  chrome.storage.sync.get(
    ["vcp1_enabled", "vcp1_pack", "vcp1_scale", "vcp1_offset", "vcp1_lerp", "vcp1_lang", "vcp1_mode",
     "vcp1_unlocked", "vcp1_growth", "vcp1_pending_evolution"],
    (res) => {
      enabledEl.checked = !!res.vcp1_enabled;
      const storedPack  = res.vcp1_pack || DEFAULT_PACK;
      CUR_LANG = (res.vcp1_lang === "ko") ? "ko" : "en";
      updateLangUI();
      CUR_MODE = (res.vcp1_mode === "wander") ? "wander" : "follow";
      updateModeUI();
      UNLOCKED_DEX = new Set(res.vcp1_unlocked || []);
      GROWTH_DATA = res.vcp1_growth || {};
      PENDING_EVOLUTION = res.vcp1_pending_evolution || null;

      const scale  = (typeof res.vcp1_scale  === "number") ? res.vcp1_scale  : DEFAULTS.vcp1_scale;
      const offset = (typeof res.vcp1_offset === "number") ? res.vcp1_offset : DEFAULTS.vcp1_offset;
      const lerp   = (typeof res.vcp1_lerp   === "number") ? res.vcp1_lerp   : DEFAULTS.vcp1_lerp;

      scaleEl.value  = String(scale);
      offsetEl.value = String(offset);

      // UI shows speed as 0.5–5.0 (×10 of internal lerp 0.05–0.50)
      const lerpUI = lerp * 10;
      lerpEl.value = String(lerpUI.toFixed(1));

      scaleVal.textContent  = scale.toFixed(2) + "×";
      offsetVal.textContent = offset + " px";
      lerpVal.textContent   = lerpUI.toFixed(1);

      // Prefer dynamic index.json; fallback to static options then normalize labels/order
      (async () => {
        await Promise.all([loadKoNames(), loadEvolutions()]);
        const ok = await populatePacksFromIndex(storedPack);
        if (!ok) {
          // Use whatever is in HTML, but fix labels/order
          normalizePackOptions();
          packEl.value = storedPack;
          if (packEl.selectedIndex === -1 && packEl.options.length) packEl.selectedIndex = 0;
        }
        applyLockState();
        // Final word on option labels + search meta for the active language
        applyLang(CUR_LANG);
        setPreviewForPack(packEl.value);
        setMoodPreviewForPack(packEl.value);
        renderGrowthUI();
        renderEvolveChoice();
      })();
    }
  );

  // React to changes from other windows (content.js's engine): evolution
  // switches the active pack + unlocks the result, XP flushes update the
  // level bar, and a branch decision (e.g. Eevee) becoming available/resolved
  // toggles the choice section -- all without needing to reopen Settings.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let needsLockRefresh = false;

    if (changes.vcp1_unlocked) {
      UNLOCKED_DEX = new Set(changes.vcp1_unlocked.newValue || []);
      needsLockRefresh = true;
    }
    if (changes.vcp1_pack) {
      const nextPack = changes.vcp1_pack.newValue || DEFAULT_PACK;
      if (packEl && packEl.value !== nextPack) {
        packEl.value = nextPack;
        if (packEl.selectedIndex === -1 && packEl.options.length) packEl.selectedIndex = 0;
        setPreviewForPack(packEl.value);
        setMoodPreviewForPack(packEl.value);
      }
      needsLockRefresh = true; // current-pack-always-unlocked-for-display depends on this
    }
    if (changes.vcp1_growth) {
      GROWTH_DATA = changes.vcp1_growth.newValue || {};
      renderGrowthUI();
    }
    if (changes.vcp1_pending_evolution) {
      PENDING_EVOLUTION = changes.vcp1_pending_evolution.newValue || null;
      renderEvolveChoice();
    }
    if (needsLockRefresh) {
      applyLockState();
      applyLang(CUR_LANG);
      renderGrowthUI();
      renderEvolveChoice();
    }
  });

  // Helper: save but do NOT auto-close (except when toggling enable)
  const save = (obj) => chrome.storage.sync.set(obj);

  // Toggle enable — close popup (people expect immediate feedback here)
  enabledEl.addEventListener("change", () => {
    save({ vcp1_enabled: enabledEl.checked });
    window.close();
  });

  // Pack select — save but keep popup open, and update preview
  packEl.addEventListener("change", () => {
    save({ vcp1_pack: packEl.value });
    setPreviewForPack(packEl.value);
    setMoodPreviewForPack(packEl.value);
    renderGrowthUI();
    renderEvolveChoice();
  });

  // Language toggle — relabel options/datalist/search meta, keep pack selection
  if (langEl) {
    langEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".langOpt");
      if (!btn) return;
      const lang = (btn.dataset.lang === "ko") ? "ko" : "en";
      if (lang === CUR_LANG) return;
      save({ vcp1_lang: lang });
      applyLang(lang);
      renderGrowthUI(); // refresh hunger/Feed labels (and evolve hint) for the new language
    });
  }

  // Feed button — a storage write (fresh Date.now() each click, so
  // storage.onChanged always fires), same "vcp1_feed_trigger" key the
  // desktop tray's "Feed" item writes (see content.js's onChanged listener).
  // NOT chrome.runtime.sendMessage: in a real (non-Electron) Chrome
  // extension with no background page, runtime.sendMessage from a popup
  // never reaches a content script in a tab (only tabs.sendMessage from a
  // background context does) -- storage.onChanged is the mechanism already
  // proven to reach content.js for vcp1_pack/vcp1_mode/etc. above.
  // content.js's own triggerFeed() already guards re-entrancy/evolution/etc.,
  // so this is a plain fire-and-forget click, no local disable/cooldown needed here.
  if (feedBtnEl) {
    feedBtnEl.addEventListener("click", () => {
      try { chrome.storage.sync.set({ vcp1_feed_trigger: Date.now() }); } catch (_) {}
    });
  }

  // Mode toggle — live-switches content.js via storage.onChanged, no reload
  if (modeEl) {
    modeEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".langOpt");
      if (!btn) return;
      const mode = (btn.dataset.mode === "wander") ? "wander" : "follow";
      if (mode === CUR_MODE) return;
      CUR_MODE = mode;
      save({ vcp1_mode: mode });
      updateModeUI();
    });
  }

  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      if (!packEl || !packEl.options.length) return;
      const enabledOpts = Array.from(packEl.options).filter((o) => !o.disabled);
      if (!enabledOpts.length) return;
      const current = packEl.value;
      const candidates = enabledOpts.filter((o) => o.value !== current);
      const pool = candidates.length ? candidates : enabledOpts;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      packEl.value = pick.value;
      packEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", () => openPackSearch());
    searchBtn.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        openPackSearch();
      }
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      searchEl.classList.remove("no-match");
    });
    searchEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commitPackSearch();
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        closePackSearch();
      }
    });
    searchEl.addEventListener("change", () => {
      if (searchEl.value.trim()) commitPackSearch();
    });
    searchEl.addEventListener("blur", () => {
      // Allow other handlers (change) to fire before closing
      setTimeout(() => {
        if (isSearchOpen()) closePackSearch();
      }, 0);
    });
  }

  // function clampFrom helper
  function clampFrom(el) {
    const v = Number(el.value);
    const min = Number(el.min);
    const max = Number(el.max);
    if (!Number.isFinite(v)) {
      if (Number.isFinite(min)) return min;
      if (Number.isFinite(max)) return max;
      return 0;
    }
    if (Number.isFinite(min) && v < min) return min;
    if (Number.isFinite(max) && v > max) return max;
    return v;
  }

  function isPartialNumber(value) {
    return value === "" || value.endsWith(".");
  }

  // --- Preview sprite helpers (robust URL + fallback) ---
  function slugFromPack(pack) {
    // "retro/gen-1/009-blastoise" -> "blastoise"
    const last = (pack || "").split("/").pop() || "";
    return last.replace(/^\d+-/, "");
  }

  function generationFromPack(pack) {
    const parts = (pack || "").split("/");
    if (parts.length < 3) return null;
    const maybe = parts[parts.length - 2] || "";
    return maybe.startsWith("gen-") ? maybe : null;
  }

  function setPreviewForPack(pack) {
    if (!previewSpriteEl) return;

    // Ensure preview never mirrors even if other CSS flips the main sprite
    previewSpriteEl.style.transform = "scaleX(1)";

    const slugFull = (pack || "").split("/").pop() || "";
    const slug = slugFromPack(pack);
    const slugCompact = slugFull.replace(/-/g, "");
    const names = Array.from(new Set([slugFull, slug, slugCompact]));
    const generation = generationFromPack(pack);
    const candidates = [];
    const pushCandidate = (path) => {
      if (!candidates.includes(path)) candidates.push(path);
    };
    for (const name of names) {
      if (generation) {
        pushCandidate(chrome.runtime.getURL(`assets/ui/${generation}/${name}.png`));
      }
      pushCandidate(chrome.runtime.getURL(`assets/ui/${name}.png`));
      pushCandidate(chrome.runtime.getURL(`assets/retro/${name}.png`));
    }

    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        previewSpriteEl.removeAttribute("src");
        previewSpriteEl.alt = "";
        return;
      }
      const url = candidates[i++];
      const img = new Image();
      img.onload = () => {
        previewSpriteEl.src = url;
        previewSpriteEl.alt = `${slug} preview`;
      };
      img.onerror = tryNext;
      img.src = url;
    };

    tryNext();
  }

  // Small "current mood" thumbnail next to the level label (Normal portrait
  // only -- this is just a static preview, not the animated mood bubble that
  // content.js shows on the follower itself). Portrait coverage varies per
  // Pokémon (see assets/portraits/index.json in content.js), so this is
  // hidden rather than shown broken when the selected pack has none.
  function setMoodPreviewForPack(pack) {
    if (!moodPreviewEl) return;
    const slugFull = (pack || "").split("/").pop() || "";
    const generation = generationFromPack(pack);
    if (!generation || !slugFull) {
      moodPreviewEl.style.display = "none";
      return;
    }
    const url = chrome.runtime.getURL(`assets/portraits/${generation}/${slugFull}/Normal.webp`);
    const img = new Image();
    img.onload = () => {
      moodPreviewEl.src = url;
      moodPreviewEl.alt = `${slugFromPack(pack)} mood`;
      moodPreviewEl.style.display = "inline-block";
    };
    img.onerror = () => {
      moodPreviewEl.removeAttribute("src");
      moodPreviewEl.style.display = "none";
    };
    img.src = url;
  }

  // --- Pack search helpers (magnifying glass action) ---
  function normalizeSearch(str) {
    return (str || "").toLowerCase();
  }
  function compactSearch(str) {
    // Keep Hangul syllables so Korean names survive compaction; English unaffected.
    return normalizeSearch(str).replace(/[^a-z0-9가-힣]/g, "");
  }

  function rebuildSearchSuggestions() {
    if (!searchListEl) return;
    searchListEl.innerHTML = "";

    const seen = new Set();
    for (const meta of PACK_META) {
      const display = (meta.display && meta.display.trim()) ||
        (meta.label && meta.label.trim()) ||
        (meta.name && meta.name.trim()) ||
        meta.id;
      if (!display || seen.has(display)) continue;
      seen.add(display);
      const opt = document.createElement("option");
      opt.value = display;
      searchListEl.appendChild(opt);
    }
  }

  function capturePackMeta() {
    PACK_META.length = 0;
    if (!packEl) return;
    const opts = Array.from(packEl.options);
    for (const opt of opts) {
      if (opt.disabled) continue; // locked: excluded from search suggestions + shuffle
      const id = opt.value;
      const label = opt.textContent || formatPackLabel(id);   // current-language display label
      const dex = dexFromValue(id);
      const dexStr = Number.isFinite(dex) ? String(dex).padStart(3, "0") : "";
      const formatted = formatPackLabel(id);
      // English name derived from the option's English label (never the visible
      // label) so English search keeps working while displaying Korean.
      const enLabel = enLabelForOption(opt);
      const enTrimmed = (enLabel || "").replace(/^\s*\d+\s*[-#]?\s*/, "").replace(/\s*\(#\d+\)\s*$/, "").trim();
      const enFallback = (formatted || "").replace(/^\s*\d+\s*[-#]?\s*/, "").trim();
      const name = enTrimmed || enFallback || enLabel || id;   // English name
      const koName = koNameForValue(id);                       // Korean name or null
      const curName = (CUR_LANG === "ko" && koName) ? koName : name;
      const display = dexStr ? `#${dexStr} ${curName}` : curName;
      // Search values are language-independent by construction: English forms are
      // always present, Korean forms added whenever a Korean name exists.
      const values = new Set([
        normalizeSearch(name),
        compactSearch(name),
        normalizeSearch(enLabel),
        compactSearch(enLabel),
        normalizeSearch(id),
        compactSearch(id)
      ]);
      if (formatted) {
        values.add(normalizeSearch(formatted));
        values.add(compactSearch(formatted));
      }
      if (koName) {
        values.add(normalizeSearch(koName));   // 원형
        values.add(compactSearch(koName));     // 공백제거형
      }
      const enDisplay = dexStr ? `#${dexStr} ${name}` : name;
      values.add(normalizeSearch(enDisplay));
      values.add(compactSearch(enDisplay));
      if (display) {
        values.add(normalizeSearch(display));
        values.add(compactSearch(display));
      }
      if (dexStr) {
        values.add(String(dex));
        values.add(dexStr);
        values.add(`#${dexStr}`);
      }
      values.delete("");
      PACK_META.push({
        id,
        label,
        name,
        display,
        dex,
        dexStr,
        searchValues: Array.from(values)
      });
    }
    rebuildSearchSuggestions();
  }

  function resolveSearchTerm(term) {
    const raw = (term || "").trim();
    if (!raw) return null;

    const digits = raw.replace(/[^0-9]/g, "");
    if (digits) {
      const num = parseInt(digits, 10);
      if (Number.isFinite(num)) {
        const byDex = PACK_META.find(meta => meta.dex === num);
        if (byDex) return byDex.id;
      }
    }

    const lower = normalizeSearch(raw);
    const compact = compactSearch(raw);

    const exact = PACK_META.find(meta =>
      meta.searchValues.some(val => val === lower || val === compact)
    );
    if (exact) return exact.id;

    const partial = PACK_META.find(meta =>
      meta.searchValues.some(val => val.includes(compact) || val.includes(lower))
    );
    return partial ? partial.id : null;
  }

  function isSearchOpen() {
    return !!(pickerEl && pickerEl.classList.contains("searching"));
  }

  function openPackSearch() {
    if (!pickerEl || !searchEl) return;
    if (!PACK_META.length) capturePackMeta();
    if (isSearchOpen()) {
      searchEl.focus();
      searchEl.select();
      return;
    }
    pickerEl.classList.add("searching");
    if (packEl) packEl.setAttribute("aria-hidden", "true");
    searchEl.value = "";
    searchEl.classList.remove("no-match");
    searchEl.placeholder = "Search name or #";
    requestAnimationFrame(() => {
      searchEl.focus();
    });
  }

  function closePackSearch() {
    if (!pickerEl || !searchEl) return;
    const wasOpen = isSearchOpen();
    pickerEl.classList.remove("searching");
    if (packEl) packEl.removeAttribute("aria-hidden");
    searchEl.classList.remove("no-match");
    searchEl.value = "";
    if (wasOpen && document.activeElement === searchEl && packEl) {
      packEl.focus();
    }
  }

  function commitPackSearch() {
    if (!searchEl || !packEl) return;
    const term = searchEl.value.trim();
    if (!term) {
      closePackSearch();
      return;
    }
    const matchId = resolveSearchTerm(term);
    if (!matchId) {
      searchEl.classList.add("no-match");
      return;
    }
    searchEl.classList.remove("no-match");
    closePackSearch();
    packEl.value = matchId;
    packEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function attachEnterCommit(input, commitFn) {
    if (!input) return;
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        commitFn({ flush: true });
      }
    });
  }

  // Scale
  function previewScale() {
    const raw = scaleEl.value.trim();
    if (isPartialNumber(raw)) {
      scaleVal.textContent = raw;
      return;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      scaleVal.textContent = num.toFixed(2) + "×";
    } else {
      scaleVal.textContent = raw;
    }
  }
  function commitScale({ flush = false } = {}) {
    const v = clampFrom(scaleEl);
    const normalized = Number.isFinite(v) ? Number(v.toFixed(2)) : DEFAULTS.vcp1_scale;
    scaleEl.value = normalized.toFixed(2);
    scaleVal.textContent = normalized.toFixed(2) + "×";
    setLocal({ vcp1_scale: normalized });
    pushConfig({ vcp1_scale: normalized }, { flush });
  }
  scaleEl.addEventListener("input", previewScale);
  scaleEl.addEventListener("change", () => commitScale({ flush: true }));
  attachEnterCommit(scaleEl, commitScale);

  // Offset
  function previewOffset() {
    const raw = offsetEl.value.trim();
    offsetVal.textContent = raw ? raw + " px" : "";
  }
  function commitOffset({ flush = false } = {}) {
    const v = clampFrom(offsetEl);
    const normalized = Number.isFinite(v) ? Math.round(v) : Math.round(DEFAULTS.vcp1_offset);
    offsetEl.value = String(normalized);
    offsetVal.textContent = normalized + " px";
    setLocal({ vcp1_offset: normalized });
    pushConfig({ vcp1_offset: normalized }, { flush });
  }
  offsetEl.addEventListener("input", previewOffset);
  offsetEl.addEventListener("change", () => commitOffset({ flush: true }));
  attachEnterCommit(offsetEl, commitOffset);

  // Lerp
  function previewLerp() {
    const raw = lerpEl.value.trim();
    if (isPartialNumber(raw)) {
      lerpVal.textContent = raw ? raw : "";
      return;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      lerpVal.textContent = num.toFixed(1);
    } else {
      lerpVal.textContent = raw;
    }
  }
  function commitLerp({ flush = false } = {}) {
    const ui = clampFrom(lerpEl);
    const normalized = Number.isFinite(ui) ? Number(ui.toFixed(1)) : Number((DEFAULTS.vcp1_lerp * 10).toFixed(1));
    lerpEl.value = normalized.toFixed(1);
    lerpVal.textContent = normalized.toFixed(1);
    const lerp = normalized / 10;              // internal 0.05–0.50
    setLocal({ vcp1_lerp: lerp });
    pushConfig({ vcp1_lerp: lerp }, { flush });
  }
  lerpEl.addEventListener("input", previewLerp);
  lerpEl.addEventListener("change", () => commitLerp({ flush: true }));
  attachEnterCommit(lerpEl, commitLerp);

  // Removed dragging pointer event listeners for sliders since number inputs do not need them

  // Safety: end dragging if mouse released outside
  // document.addEventListener("pointerup", () => setDragging(false));

  // ===== TRIANGLES (▲/▼) — JS-only wiring, no HTML changes required =====

  // Find the number input associated with a triangle within the same .triple block
  function inputForTriangle(el) {
    const triple = el.closest(".triple");
    if (!triple) return null;
    // Prefer an explicit number input inside the triple
    return triple.querySelector('input[type="number"]');
  }

  // Use native stepUp/stepDown so min/max/step are respected
  function nudgeInput(input, dir /* 'up' | 'down' */) {
    if (!input) return;
    if (dir === "down") input.stepDown();
    else input.stepUp();
    // Live update and persist via existing handlers
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Press-and-hold repeat
  let holdT = null, rptT = null, holdInput = null, holdDir = "up";

  function stopHold() {
    if (holdT) { clearTimeout(holdT); holdT = null; }
    if (rptT)  { clearInterval(rptT); rptT = null; }
    holdInput = null;
  }

  document.addEventListener("mousedown", (e) => {
    const caret = e.target.closest(".arrowStack .caret");
    if (!caret) return;

    const input = inputForTriangle(caret);
    if (!input) return;

    holdInput = input;
    holdDir = caret.classList.contains("down") ? "down" : "up";

    // First tick immediately
    nudgeInput(holdInput, holdDir);

    // Then start repeating
    stopHold();
    holdT = setTimeout(() => {
      rptT = setInterval(() => nudgeInput(holdInput, holdDir), 90);
    }, 250);
  }, true);

  // Keyboard support for triangles: Space/Enter nudges once
  document.addEventListener("keydown", (e) => {
    const caret = e.target.closest(".arrowStack .caret");
    if (!caret) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    const input = inputForTriangle(caret);
    const dir = caret.classList.contains("down") ? "down" : "up";
    nudgeInput(input, dir);
  }, true);

  window.addEventListener("mouseup", stopHold, true);
  window.addEventListener("mouseleave", stopHold, true);
  window.addEventListener("blur", stopHold, true);

  // ===== CHEVRONS (◀/▶) — cycle the <select id="pack"> and trigger existing change flow =====
  document.addEventListener("click", (e) => {
    const left  = e.target.closest(".preview .chev.left");
    const right = e.target.closest(".preview .chev.right");
    if (!left && !right) return;

    const dir = right ? +1 : -1;
    const total = packEl.options.length;
    if (!total) return;
    let idx = packEl.selectedIndex;
    if (idx < 0) idx = 0;
    // Skip locked options -- bounded by `total` so an all-locked list (should
    // never happen; base forms are always selectable) can't loop forever.
    for (let i = 0; i < total; i++) {
      idx = (idx + dir + total) % total;
      if (!packEl.options[idx].disabled) break;
    }

    packEl.selectedIndex = idx;
    packEl.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // ESC to close (QoL)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isSearchOpen()) {
        e.preventDefault();
        closePackSearch();
        return;
      }
      window.close();
    }
  });
});
