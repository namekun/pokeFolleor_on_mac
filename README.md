# PokéFollower

> 🇰🇷 한국어: [README.ko.md](README.ko.md) &nbsp;·&nbsp; 🇺🇸 English: README.md

A little nostalgic companion for your screen: a retro 2D Pokémon sprite that
follows your cursor around, idling, walking, and facing whichever way you move.

This is a fork of [ThinkrDoer/pokefollower_cursor_web_plugin](https://github.com/ThinkrDoer/pokefollower_cursor_web_plugin),
originally created by **Ali Hamad**. The original is a Chrome extension that adds
the follower to web pages. This fork keeps that extension and adds a native
**macOS desktop app** so the same Pokémon can follow your cursor across your
whole desktop — over every app, not just the browser.

---

## macOS Desktop App

The desktop app is an Electron wrapper around the extension's sprite engine. A
transparent, click-through overlay sits above your other windows, and the
extension's settings popup is reused as-is for a native Settings window.

### Quick start

One command installs dependencies, repairs the Electron binary if its integrity
check fails, runs the smoke test, builds the app, installs it to `/Applications`,
and launches it:

```bash
npm run setup:mac
```

### Manual steps

If you'd rather run each step yourself:

```bash
npm install        # install dependencies
npm run app        # run the app in development (Electron)
npm run dist       # build a standalone .app (unsigned)
```

`npm run dist` outputs an unsigned `PokeFollower.app` under `dist/`.

### Using it

The app has no Dock icon — it lives in the menu bar as a Pokéball. From the tray
menu you can:

- **Enable / Disable** the follower
- Open **Settings…**
- **Quit**

Once enabled, the sprite:

- rides on a **click-through overlay** on every connected display, one window
  each, that never steals focus, so it floats over your work without getting
  in the way,
- **follows your cursor across displays**, walking across the boundary onto
  whichever monitor the cursor is on instead of jumping there,
- **wanders across your whole desktop** in wander mode, not just one screen,
- and **falls asleep after ~30 seconds** of no cursor movement, waking up when you
  move again (for packs that include a sleep animation).

### Settings window

Opening **Settings…** shows the same UI as the browser extension popup:

- **Pick a Pokémon** — select from the list, **search** by name or Pokédex number,
  or **shuffle** for a random one.
- **SCALE** — how large the sprite is drawn.
- **DISTANCE** — how far it perches from the cursor.
- **SPEED** — how quickly it catches up as you move.
- **Language (EN / 한글)** — show Pokémon names and search suggestions in
  **Korean** (new in this fork).

Settings are stored at:

```
~/Library/Application Support/pokefollower_cursor_web_plugin/settings.json
```

### First launch (unsigned app)

The built app is not code-signed, so on first launch macOS Gatekeeper will refuse
to open it directly. To get past this once:

1. In Finder, **right-click** (or Control-click) `PokeFollower.app`.
2. Choose **Open**.
3. Confirm **Open** in the dialog.

After that first time, it opens normally.

---

## Chrome Extension

To run the original extension in Chrome (or any Chromium browser):

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `src/` folder.

The follower then appears on web pages, with the same settings popup as the
desktop app.

---

## Development

The desktop app deliberately **reuses the extension's `src/` code unmodified**.
A thin Electron layer stands in for the parts of Chrome the extension expects:

- **`desktop/main.cjs`** — the Electron wrapper: creates one overlay window per
  display, feeds the "engine" display's window the raw cursor position (~60 Hz,
  in global desktop coordinates), reconfigures the windows on display
  hotplug, builds the tray menu, and opens the Settings window.
- **`desktop/shim-preload.cjs`** — a small `chrome.*` shim, loaded by the engine
  and Settings windows. It implements `chrome.storage.sync/local`
  (`get`/`set`/`onChanged`) and `chrome.runtime`
  (`getURL`/`sendMessage`/`onMessage`/`id`) over Electron IPC, so `src/popup`
  and `src/content.js` run without any changes. It also pushes the
  multi-display layout (`window.__VCP1_WORLD__`) into the page and relays the
  engine's per-frame sprite snapshot to `main.cjs` for the mirror windows.
- **`desktop/mirror.html` / `mirror-preload.cjs` / `mirror-render.js`** — every
  display *except* the one running the engine loads these instead of
  `overlay.html`. They carry no follow/wander logic at all: `main.cjs`
  broadcasts the engine's per-frame sprite snapshot (position, sheet, frame),
  and `mirror-render.js` just repaints an identical-looking sprite element at
  that position translated into its own display's local coordinates — so the
  sprite is never running two independent physics simulations, only one engine
  with N passive views of it.
- **`poke://` protocol** — repo files are served over a custom `poke://app/<path>`
  scheme so `fetch()` works for pack JSON and assets (the `file://` scheme blocks
  fetch).
- **`src/`** — the shared sprite engine (`content.js`) and settings popup
  (`popup/`), used identically by the extension and the desktop app.

### Smoke test

```bash
npm run app:smoke
```

The smoke test boots the app headlessly and verifies the core paths end to end:

- the **overlay sprite** loads and renders,
- the **Settings window** loads and reads a pack,
- **8-way facing** resolves correctly, and
- the **language switch** (EN / 한글) works.

On success it prints `SMOKE_OK` and exits `0`.

### Korean names

```bash
npm run build:ko-names
```

This regenerates `src/assets/packs/names-ko.json`, the lookup of Korean Pokémon
names (keyed by Pokédex number) used by the language switch. It fetches names from
PokéAPI based on `src/assets/packs/index.json`.

---

## Credits & License

- **Code** — MIT License, © Ali Hamad and contributors. See
  [CREDITS.txt](CREDITS.txt).
- **Sprites** — from the [PMD Sprite Collab](https://sprites.pmdcollab.org)
  community, used under **Creative Commons BY-NC-SA 4.0**. Non-commercial use only.
- **Pokémon** — Pokémon and all related names and imagery are the intellectual
  property of **Nintendo / Game Freak / The Pokémon Company**.

This project is a fan-made, **personal and non-commercial** work. It is not
affiliated with or endorsed by Nintendo, Game Freak, or The Pokémon Company.

Full attributions are in [CREDITS.txt](CREDITS.txt).
