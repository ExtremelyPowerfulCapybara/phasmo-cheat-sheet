# Overlay Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user reposition, rescale, retheme, and show/hide panels on the Electron overlay window via a new dedicated settings window, with choices persisted across restarts.

**Architecture:** Two new small pure-logic modules (`overlay-bounds.js` for corner/scale → window-bounds math, `overlay-settings-store.js` for load/save/validate of `overlay-settings.json`) get unit tests. `main.js` wires them into a new `overlay-settings-window.html` (a `Ctrl+Shift+O`-triggered dedicated window, modeled on the existing Hotkey Manager) and into the existing overlay window via two new/extended preload bridges and a live-apply `overlay-settings-update` IPC broadcast. `overlay.html` gets a CSS custom-property theme refactor plus JS that applies theme/scale/panel-visibility on load and on live update.

**Tech Stack:** Electron 33 (main/renderer/preload, `contextBridge`, `ipcMain`/`ipcRenderer`), plain HTML/CSS/JS (no framework), Node's built-in `assert`-free `console.assert` test style already used by `electron/state.test.js`.

## Global Constraints

- No `fs`/`path`/other Node built-ins in any `preload*.js` — Electron 33's renderer sandbox blocks them (see `electron/preload-overlay.js` history; this broke the app once before).
- `scale` must be clamped to `[0.75, 1.5]` wherever it is read from disk or from an IPC message, not just at the UI-input boundary.
- `corner` ∈ `top-left | top-right | bottom-left | bottom-right`; `theme` ∈ `default | high-contrast | colorblind-friendly | minimal`. Any other value falls back to that field's individual default — never resets the whole settings object.
- `electron/overlay-settings.json` is machine-local generated state — gitignored, same as `electron/shortcuts.json`.
- No dynamic window resize-to-content when panels are hidden/shown (out of scope per spec — YAGNI).
- Follow existing codebase conventions: `try/catch`-returns-defaults for JSON persistence (see `loadConfig`/`loadShortcuts` in `electron/main.js`), `overlay && !overlay.isDestroyed()` guards before any `overlay.webContents.send(...)` or `overlay.setBounds(...)` call, dedicated settings windows modeled on `electron/shortcuts-window.html` (no Save button — controls live-apply immediately).
- Spec reference: `docs/superpowers/specs/2026-08-03-overlay-customization-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/overlay-bounds.js` (new) | Pure function: `(corner, scale, workAreaSize) → {x, y, width, height}`, plus scale clamping. No Electron/fs dependency — fully unit-testable. |
| `electron/overlay-bounds.test.js` (new) | Unit tests for the above. |
| `electron/overlay-settings-store.js` (new) | Load/save/normalize `overlay-settings.json`. No Electron dependency (just `fs`/`path`) — unit-testable with a temp file path. |
| `electron/overlay-settings-store.test.js` (new) | Unit tests for the above. |
| `electron/main.js` (modify) | Load settings at startup, compute initial overlay bounds from them, add `Ctrl+Shift+O` hotkey + `openOverlaySettingsWindow()`, add `overlay-settings-get`/`overlay-settings-update` IPC handlers. |
| `electron/preload-overlay-settings.js` (new) | `contextBridge` API for the new settings window: `get()`, `update(partial)`, `onUpdate(cb)`. |
| `electron/overlay-settings-window.html` (new) | Settings window UI: corner picker, scale slider, theme swatches, panel checkboxes. Modeled on `electron/shortcuts-window.html`. |
| `electron/preload-overlay.js` (modify) | Add `getSettings()` and `onSettingsUpdate(cb)` to the existing `overlayAPI`. |
| `electron/overlays/overlay.html` (modify) | CSS refactor to theme-scoped custom properties; JS to fetch settings on load, apply live updates (theme class, CSS zoom, panel visibility). |
| `electron/.gitignore` via root `.gitignore` (modify) | Add `electron/overlay-settings.json`. |
| `docs/PROGRESS.md` (modify) | Log the feature, check off the to-do item. |

---

### Task 1: Overlay bounds pure function

**Files:**
- Create: `electron/overlay-bounds.js`
- Test: `electron/overlay-bounds.test.js`

**Interfaces:**
- Produces: `computeOverlayBounds(corner, scale, workAreaSize)` → `{ x, y, width, height }` (all numbers). `clampScale(scale)` → number in `[0.75, 1.5]`. `MIN_SCALE`, `MAX_SCALE`, `BASE_WIDTH` constants. Later tasks (`overlay-settings-store.js`, `main.js`) import `clampScale` and `computeOverlayBounds` from this module.

- [ ] **Step 1: Write the failing test**

Create `electron/overlay-bounds.test.js`:

```js
'use strict';
const { computeOverlayBounds, clampScale, MIN_SCALE, MAX_SCALE, BASE_WIDTH } = require('./overlay-bounds.js');

const workArea = { width: 1920, height: 1080 };

// clampScale
console.assert(clampScale(1.0) === 1.0, 'FAIL: 1.0 should pass through unchanged');
console.assert(clampScale(0.5) === MIN_SCALE, 'FAIL: below-range scale should clamp to MIN_SCALE');
console.assert(clampScale(3) === MAX_SCALE, 'FAIL: above-range scale should clamp to MAX_SCALE');
console.assert(clampScale(undefined) === 1.0, 'FAIL: missing scale should default to 1.0');
console.assert(clampScale('bogus') === 1.0, 'FAIL: non-numeric scale should default to 1.0');
console.assert(clampScale(NaN) === 1.0, 'FAIL: NaN scale should default to 1.0');

// computeOverlayBounds — corners at scale 1.0
const tl = computeOverlayBounds('top-left', 1.0, workArea);
console.assert(tl.x === 8 && tl.y === 20, 'FAIL: top-left should be x=8,y=20');
console.assert(tl.width === BASE_WIDTH, 'FAIL: width should equal BASE_WIDTH at scale 1.0');
console.assert(tl.height === workArea.height - 40, 'FAIL: height should be workArea.height-40');

const tr = computeOverlayBounds('top-right', 1.0, workArea);
console.assert(tr.x === workArea.width - BASE_WIDTH - 8, 'FAIL: top-right x should hug the right edge');
console.assert(tr.y === 20, 'FAIL: top-right y should match top-left y');

const bl = computeOverlayBounds('bottom-left', 1.0, workArea);
console.assert(bl.x === 8 && bl.y === 20, 'FAIL: bottom-left should match top-left (full-height window)');

const br = computeOverlayBounds('bottom-right', 1.0, workArea);
console.assert(br.x === tr.x && br.y === 20, 'FAIL: bottom-right should match top-right x');

// computeOverlayBounds — scale affects width and (for right corners) x
const trScaled = computeOverlayBounds('top-right', 1.5, workArea);
console.assert(trScaled.width === Math.round(BASE_WIDTH * 1.5), 'FAIL: width should scale with scale factor');
console.assert(trScaled.x === workArea.width - trScaled.width - 8, 'FAIL: right-corner x must account for scaled width');

// computeOverlayBounds — out-of-range scale gets clamped internally
const clampedBounds = computeOverlayBounds('top-left', 99, workArea);
console.assert(clampedBounds.width === Math.round(BASE_WIDTH * MAX_SCALE), 'FAIL: bounds computation should clamp scale internally');

console.log('All overlay-bounds.js tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node electron/overlay-bounds.test.js`
Expected: `Error: Cannot find module './overlay-bounds.js'`

- [ ] **Step 3: Write minimal implementation**

Create `electron/overlay-bounds.js`:

```js
'use strict';

const BASE_WIDTH = 280;
const H_MARGIN   = 8;
const V_MARGIN   = 20;
const MIN_SCALE  = 0.75;
const MAX_SCALE  = 1.5;

function clampScale(scale) {
  const n = typeof scale === 'number' && !Number.isNaN(scale) ? scale : 1.0;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
}

// Mirrors the pre-customization hardcoded layout (x:8, y:20, width:280,
// height:workAreaHeight-40) per corner. Because the window spans the full
// work-area height minus symmetric top/bottom margins, "top" and "bottom"
// corners always produce the same y — only left/right corners change x.
function computeOverlayBounds(corner, scale, workAreaSize) {
  const s      = clampScale(scale);
  const width  = Math.round(BASE_WIDTH * s);
  const height = workAreaSize.height - (V_MARGIN * 2);

  const isRight = corner === 'top-right' || corner === 'bottom-right';
  const x = isRight ? workAreaSize.width - width - H_MARGIN : H_MARGIN;
  const y = V_MARGIN;

  return { x, y, width, height };
}

module.exports = { computeOverlayBounds, clampScale, MIN_SCALE, MAX_SCALE, BASE_WIDTH };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node electron/overlay-bounds.test.js`
Expected: `All overlay-bounds.js tests passed` with no `FAIL:` assertions printed above it.

- [ ] **Step 5: Commit**

```bash
git add electron/overlay-bounds.js electron/overlay-bounds.test.js
git commit -m "feat: add overlay corner/scale bounds calculation with tests"
```

---

### Task 2: Overlay settings persistence store

**Files:**
- Create: `electron/overlay-settings-store.js`
- Test: `electron/overlay-settings-store.test.js`

**Interfaces:**
- Consumes: `clampScale` from `electron/overlay-bounds.js` (Task 1).
- Produces: `load(settingsPath?)` → normalized settings object. `save(settings, settingsPath?)` → void. `normalize(raw)` → normalized settings object (pure, no fs). `DEFAULTS`, `VALID_CORNERS`, `VALID_THEMES`, `SETTINGS_PATH` (the real default path, `electron/overlay-settings.json`). Later tasks (`main.js`) call `load()`/`save()` with no arguments to use the real path.

- [ ] **Step 1: Write the failing test**

Create `electron/overlay-settings-store.test.js`:

```js
'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const store = require('./overlay-settings-store.js');

// normalize() — empty/missing input falls back to full defaults
const normalizedEmpty = store.normalize({});
console.assert(JSON.stringify(normalizedEmpty) === JSON.stringify(store.DEFAULTS),
  'FAIL: normalize({}) should equal DEFAULTS');

const normalizedNull = store.normalize(null);
console.assert(JSON.stringify(normalizedNull) === JSON.stringify(store.DEFAULTS),
  'FAIL: normalize(null) should equal DEFAULTS');

// normalize() — invalid fields fall back individually, valid fields preserved
const partiallyBad = store.normalize({ corner: 'sideways', scale: 1.2, theme: 'invisible', panels: { timers: false } });
console.assert(partiallyBad.corner === store.DEFAULTS.corner, 'FAIL: invalid corner should fall back to default');
console.assert(partiallyBad.scale === 1.2, 'FAIL: valid scale should be preserved');
console.assert(partiallyBad.theme === store.DEFAULTS.theme, 'FAIL: invalid theme should fall back to default');
console.assert(partiallyBad.panels.timers === false, 'FAIL: valid panel override should be preserved');
console.assert(partiallyBad.panels.evidence === true, 'FAIL: unspecified panel should default to true');

// normalize() — out-of-range scale gets clamped
const clamped = store.normalize({ scale: 50 });
console.assert(clamped.scale === 1.5, 'FAIL: out-of-range scale should clamp to MAX_SCALE (1.5)');

// load() — missing file returns defaults, does not throw
const missingPath = path.join(os.tmpdir(), 'overlay-settings-test-missing-' + Date.now() + '.json');
const loadedMissing = store.load(missingPath);
console.assert(JSON.stringify(loadedMissing) === JSON.stringify(store.DEFAULTS),
  'FAIL: load() of a missing file should return DEFAULTS');

// load() — corrupt file returns defaults, does not throw
const corruptPath = path.join(os.tmpdir(), 'overlay-settings-test-corrupt-' + Date.now() + '.json');
fs.writeFileSync(corruptPath, '{ not valid json');
const loadedCorrupt = store.load(corruptPath);
console.assert(JSON.stringify(loadedCorrupt) === JSON.stringify(store.DEFAULTS),
  'FAIL: load() of a corrupt file should return DEFAULTS');
fs.unlinkSync(corruptPath);

// save() then load() round-trips correctly
const roundTripPath = path.join(os.tmpdir(), 'overlay-settings-test-roundtrip-' + Date.now() + '.json');
const custom = { corner: 'bottom-right', scale: 1.25, theme: 'minimal', panels: { timers: true, evidence: false, ghosts: true } };
store.save(custom, roundTripPath);
const roundTripped = store.load(roundTripPath);
console.assert(JSON.stringify(roundTripped) === JSON.stringify(custom),
  'FAIL: save() then load() should round-trip the exact settings');
fs.unlinkSync(roundTripPath);

console.log('All overlay-settings-store.js tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node electron/overlay-settings-store.test.js`
Expected: `Error: Cannot find module './overlay-settings-store.js'`

- [ ] **Step 3: Write minimal implementation**

Create `electron/overlay-settings-store.js`:

```js
'use strict';
const fs   = require('fs');
const path = require('path');
const { clampScale } = require('./overlay-bounds.js');

const SETTINGS_PATH = path.join(__dirname, 'overlay-settings.json');

const DEFAULTS = {
  corner: 'top-left',
  scale:  1.0,
  theme:  'default',
  panels: { timers: true, evidence: true, ghosts: true },
};

const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const VALID_THEMES  = ['default', 'high-contrast', 'colorblind-friendly', 'minimal'];

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    corner: VALID_CORNERS.includes(src.corner) ? src.corner : DEFAULTS.corner,
    scale:  clampScale(src.scale),
    theme:  VALID_THEMES.includes(src.theme) ? src.theme : DEFAULTS.theme,
    panels: Object.assign(
      {},
      DEFAULTS.panels,
      src.panels && typeof src.panels === 'object' ? src.panels : {}
    ),
  };
}

function load(settingsPath = SETTINGS_PATH) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { raw = {}; }
  return normalize(raw);
}

function save(settings, settingsPath = SETTINGS_PATH) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('[overlay-settings] save failed:', e.message); }
}

module.exports = { load, save, normalize, DEFAULTS, VALID_CORNERS, VALID_THEMES, SETTINGS_PATH };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node electron/overlay-settings-store.test.js`
Expected: `All overlay-settings-store.js tests passed` with no `FAIL:` assertions printed above it.

- [ ] **Step 5: Commit**

```bash
git add electron/overlay-settings-store.js electron/overlay-settings-store.test.js
git commit -m "feat: add overlay-settings.json persistence store with tests"
```

---

### Task 3: Gitignore the generated settings file

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- None (repo hygiene only).

- [ ] **Step 1: Add the ignore entry**

In `.gitignore`, directly below the existing `electron/shortcuts.json` line (in the "Local, machine-specific state" section), add:

```
electron/overlay-settings.json
```

So that section reads:

```
# Local, machine-specific state (regenerated with defaults on first run)
electron/shortcuts.json
electron/overlay-settings.json
```

- [ ] **Step 2: Verify**

Run: `git check-ignore -v electron/overlay-settings.json`
Expected: prints the `.gitignore` line that matched (confirms it's ignored), exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore generated overlay-settings.json"
```

---

### Task 4: Wire settings load/persist and a settings window into main.js

**Files:**
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: `computeOverlayBounds`, `clampScale` from `electron/overlay-bounds.js` (Task 1); `load`, `save`, `VALID_CORNERS`, `VALID_THEMES` from `electron/overlay-settings-store.js` as `overlaySettingsStore` (Task 2).
- Produces: module-level `overlaySettings` object (read by Task 6's `overlay-settings-get` IPC handler, already added here); `openOverlaySettingsWindow()` function; IPC handler `overlay-settings-get` (returns current settings) and `overlay-settings-update` (merges + persists + re-broadcasts, used by Task 5's settings window and consumed by Task 7's overlay window).

- [ ] **Step 1: Add requires and settings state**

In `electron/main.js`, after the existing `const state = require('./state.js');` (line 4), add:

```js
const overlayBounds  = require('./overlay-bounds.js');
const overlaySettingsStore = require('./overlay-settings-store.js');
```

After the existing `let currentBindings = {};` (line 35), add:

```js
let overlaySettings       = overlaySettingsStore.DEFAULTS;
let overlaySettingsWindow = null;
```

- [ ] **Step 2: Compute overlay's initial bounds from persisted settings**

Replace the `createOverlay()` function (lines 132–163) with:

```js
function createOverlay() {
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
  const bounds = overlayBounds.computeOverlayBounds(
    overlaySettings.corner,
    overlaySettings.scale,
    workAreaSize
  );

  overlay = new BrowserWindow({
    x:      bounds.x,
    y:      bounds.y,
    width:  bounds.width,
    height: bounds.height,
    transparent:   true,
    alwaysOnTop:   true,
    frame:         false,
    skipTaskbar:   true,
    resizable:     false,
    focusable:     false,
    hasShadow:     false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlays', 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => {
    console.log('[overlay] loaded');
    overlay.webContents.executeJavaScript(
      `window.overlayAPI ? 'overlayAPI_defined' : 'overlayAPI_undefined'`
    ).then(r => console.log('[overlay] overlayAPI:', r)).catch(e => console.error('[overlay] check failed:', e.message));
  });
  overlay.webContents.on('console-message', (_, level, msg) => console.log('[overlay-console]', msg));
}
```

(This changes only the bounds source — `x:8, y:20, width:280, height:height-40` becomes the computed `bounds`. Everything else is unchanged.)

- [ ] **Step 3: Add the settings window, modeled on the Hotkey Manager**

After the existing `openHotkeyManager()` function (ends at line 187), add:

```js
function openOverlaySettingsWindow() {
  if (overlaySettingsWindow && !overlaySettingsWindow.isDestroyed()) {
    overlaySettingsWindow.focus();
    return;
  }
  overlaySettingsWindow = new BrowserWindow({
    width:       420,
    height:      520,
    title:       'Overlay Settings',
    resizable:   false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-overlay-settings.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  overlaySettingsWindow.setMenuBarVisibility(false);
  overlaySettingsWindow.loadFile(path.join(__dirname, 'overlay-settings-window.html'));
  overlaySettingsWindow.on('closed', () => { overlaySettingsWindow = null; });
}
```

- [ ] **Step 4: Add the IPC handlers**

After the existing `ipcMain.on('overlay-toggle-evidence', ...)` block (ends at line 258), add:

```js
// Overlay settings window / overlay → main: read current overlay settings
ipcMain.handle('overlay-settings-get', () => Object.assign({}, overlaySettings));

// Overlay settings window → main: merge + persist + live-apply a partial settings update
ipcMain.handle('overlay-settings-update', (_, partial) => {
  const merged = Object.assign({}, overlaySettings, partial);
  if (partial && partial.panels) {
    merged.panels = Object.assign({}, overlaySettings.panels, partial.panels);
  }
  const next = overlaySettingsStore.normalize(merged);

  const boundsAffectingChange = next.corner !== overlaySettings.corner || next.scale !== overlaySettings.scale;
  overlaySettings = next;
  overlaySettingsStore.save(overlaySettings);

  if (overlay && !overlay.isDestroyed()) {
    if (boundsAffectingChange) {
      const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
      overlay.setBounds(overlayBounds.computeOverlayBounds(overlaySettings.corner, overlaySettings.scale, workAreaSize));
    }
    overlay.webContents.send('overlay-settings-update', overlaySettings);
  }

  return Object.assign({}, overlaySettings);
});

ipcMain.on('open-overlay-settings', () => openOverlaySettingsWindow());
```

- [ ] **Step 5: Load settings before the overlay is created, and register the hotkey**

In the `app.whenReady().then(() => { ... })` block, change the start of the block (currently lines 267–270):

```js
app.whenReady().then(() => {
  createMainWindow();
  createOverlay();

  buildHandlers();
```

to:

```js
app.whenReady().then(() => {
  overlaySettings = overlaySettingsStore.load();

  createMainWindow();
  createOverlay();

  buildHandlers();
```

Then, right after the existing `globalShortcut.register('Control+Shift+K', openHotkeyManager);` line (line 283), add:

```js
  globalShortcut.register('Control+Shift+O', openOverlaySettingsWindow);
```

- [ ] **Step 6: Manual smoke check**

Run: `cd electron && npm start`
Expected console output includes `[overlay] loaded` and `[overlay] overlayAPI: overlayAPI_defined` with no thrown errors, and the overlay still appears top-left as before (no `electron/overlay-settings.json` exists yet, so defaults apply). Press `Ctrl+Shift+O` — expected: no visible window yet (its HTML file doesn't exist until Task 5), but check the terminal for an `Error: ENOENT ... overlay-settings-window.html` — this confirms the hotkey and handler wiring fired correctly. Close the app (`Get-Process electron | Stop-Process -Force` per project convention) before moving on.

- [ ] **Step 7: Commit**

```bash
git add electron/main.js
git commit -m "feat: load persisted overlay settings, compute initial bounds, wire settings IPC + hotkey"
```

---

### Task 5: Overlay settings window (preload + UI)

**Files:**
- Create: `electron/preload-overlay-settings.js`
- Create: `electron/overlay-settings-window.html`

**Interfaces:**
- Consumes: IPC handlers `overlay-settings-get` / `overlay-settings-update` from Task 4's `main.js`.
- Produces: `window.overlaySettingsAPI.get()`, `.update(partial)`, `.onUpdate(cb)` — used only within `overlay-settings-window.html` in this task.

- [ ] **Step 1: Write the preload bridge**

Create `electron/preload-overlay-settings.js`:

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlaySettingsAPI', {
  get:      ()        => ipcRenderer.invoke('overlay-settings-get'),
  update:   (partial)  => ipcRenderer.invoke('overlay-settings-update', partial),
  onUpdate: (cb)       => ipcRenderer.on('overlay-settings-update', (_, d) => cb(d)),
});
```

(No `fs`/`path` — matches the hard constraint that broke the app once before when a preload used Node built-ins under Electron 33's sandbox.)

- [ ] **Step 2: Write the settings window UI**

Create `electron/overlay-settings-window.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Overlay Settings</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Segoe UI', sans-serif;
    background: #0d0f14;
    color: #cdd6e0;
    user-select: none;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    padding: 14px 18px 10px;
    background: #151820;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  header h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.3px; }
  header .subtitle { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }

  .content { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 20px; }

  .field-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px;
    color: rgba(255,255,255,0.35); margin-bottom: 8px;
  }

  /* Corner picker: 2x2 grid */
  .corner-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 6px;
    width: 140px;
    height: 90px;
  }
  .corner-btn {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .corner-btn:hover { border-color: rgba(79,200,204,0.5); }
  .corner-btn.active { background: rgba(79,200,204,0.20); border-color: #4fc; }

  /* Scale slider */
  .scale-row { display: flex; align-items: center; gap: 10px; }
  .scale-row input[type="range"] { flex: 1; }
  .scale-value { font-family: 'Consolas', monospace; font-size: 12px; width: 46px; text-align: right; }

  /* Theme swatches */
  .theme-grid { display: flex; gap: 8px; }
  .theme-swatch {
    width: 64px; height: 44px;
    border-radius: 6px;
    border: 2px solid rgba(255,255,255,0.14);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; text-align: center; padding: 4px;
    transition: all 0.15s;
  }
  .theme-swatch.active { border-color: #4fc; }
  .theme-swatch[data-theme="default"]             { background: linear-gradient(135deg, #0a0a14, #4fc060); color: #cdd6e0; }
  .theme-swatch[data-theme="high-contrast"]        { background: linear-gradient(135deg, #000000, #33ff33); color: #ffffff; }
  .theme-swatch[data-theme="colorblind-friendly"]  { background: linear-gradient(135deg, #0a0a14, #3399ff); color: #cdd6e0; }
  .theme-swatch[data-theme="minimal"]              { background: linear-gradient(135deg, #0a0a14, #6c6c6c); color: rgba(255,255,255,0.6); }

  /* Panel checkboxes */
  .panel-list { display: flex; flex-direction: column; gap: 8px; }
  .panel-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }

  footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 14px;
    background: #151820;
    border-top: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  button.btn-close {
    padding: 5px 14px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    background: rgba(79,200,204,0.15);
    border: 1px solid rgba(79,200,204,0.4);
    color: #4fc;
  }
  button.btn-close:hover { background: rgba(79,200,204,0.25); }
</style>
</head>
<body>

<header>
  <h1>Overlay Settings</h1>
  <div class="subtitle">Changes apply immediately — watch the overlay update live</div>
</header>

<div class="content">
  <div>
    <div class="field-label">Corner</div>
    <div class="corner-grid">
      <button class="corner-btn" data-corner="top-left"></button>
      <button class="corner-btn" data-corner="top-right"></button>
      <button class="corner-btn" data-corner="bottom-left"></button>
      <button class="corner-btn" data-corner="bottom-right"></button>
    </div>
  </div>

  <div>
    <div class="field-label">Scale</div>
    <div class="scale-row">
      <input type="range" id="scaleSlider" min="0.75" max="1.5" step="0.05" value="1.0">
      <span class="scale-value" id="scaleValue">100%</span>
    </div>
  </div>

  <div>
    <div class="field-label">Theme</div>
    <div class="theme-grid">
      <div class="theme-swatch" data-theme="default">Default</div>
      <div class="theme-swatch" data-theme="high-contrast">High Contrast</div>
      <div class="theme-swatch" data-theme="colorblind-friendly">Colorblind Friendly</div>
      <div class="theme-swatch" data-theme="minimal">Minimal</div>
    </div>
  </div>

  <div>
    <div class="field-label">Panels</div>
    <div class="panel-list">
      <label class="panel-row"><input type="checkbox" id="panel-timers" checked> Timers</label>
      <label class="panel-row"><input type="checkbox" id="panel-evidence" checked> Evidence</label>
      <label class="panel-row"><input type="checkbox" id="panel-ghosts" checked> Possible Ghosts</label>
    </div>
  </div>
</div>

<footer>
  <button class="btn-close" id="btnClose">Close</button>
</footer>

<script>
let current = null;

function renderCorner(corner) {
  document.querySelectorAll('.corner-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.corner === corner);
  });
}

function renderScale(scale) {
  document.getElementById('scaleSlider').value = scale;
  document.getElementById('scaleValue').textContent = Math.round(scale * 100) + '%';
}

function renderTheme(theme) {
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
}

function renderPanels(panels) {
  document.getElementById('panel-timers').checked   = panels.timers   !== false;
  document.getElementById('panel-evidence').checked = panels.evidence !== false;
  document.getElementById('panel-ghosts').checked   = panels.ghosts   !== false;
}

function render(settings) {
  current = settings;
  renderCorner(settings.corner);
  renderScale(settings.scale);
  renderTheme(settings.theme);
  renderPanels(settings.panels);
}

async function update(partial) {
  current = await window.overlaySettingsAPI.update(partial);
}

document.querySelectorAll('.corner-btn').forEach(el => {
  el.addEventListener('click', () => {
    renderCorner(el.dataset.corner);
    update({ corner: el.dataset.corner });
  });
});

document.getElementById('scaleSlider').addEventListener('input', (e) => {
  const scale = parseFloat(e.target.value);
  document.getElementById('scaleValue').textContent = Math.round(scale * 100) + '%';
  update({ scale });
});

document.querySelectorAll('.theme-swatch').forEach(el => {
  el.addEventListener('click', () => {
    renderTheme(el.dataset.theme);
    update({ theme: el.dataset.theme });
  });
});

['timers', 'evidence', 'ghosts'].forEach(key => {
  document.getElementById('panel-' + key).addEventListener('change', (e) => {
    const panels = Object.assign({}, current.panels, { [key]: e.target.checked });
    update({ panels });
  });
});

document.getElementById('btnClose').addEventListener('click', () => window.close());

window.overlaySettingsAPI.onUpdate(render);

(async () => {
  render(await window.overlaySettingsAPI.get());
})();
</script>
</body>
</html>
```

- [ ] **Step 3: Manual smoke check**

Run: `cd electron && npm start`, press `Ctrl+Shift+O`. Expected: a 420×520 "Overlay Settings" window opens, showing Top-Left highlighted, scale at 100%, Default theme highlighted, all three panel checkboxes checked. Click each corner button, drag the scale slider, click each theme swatch, toggle each checkbox — none should throw errors in the terminal (the overlay window itself won't visibly react yet since Task 7 hasn't wired that side). Close both windows (`Get-Process electron | Stop-Process -Force`).

- [ ] **Step 4: Commit**

```bash
git add electron/preload-overlay-settings.js electron/overlay-settings-window.html
git commit -m "feat: add overlay settings window UI (corner, scale, theme, panels)"
```

---

### Task 6: Extend the overlay's own preload bridge

**Files:**
- Modify: `electron/preload-overlay.js`

**Interfaces:**
- Consumes: `overlay-settings-get` IPC handler (Task 4), `overlay-settings-update` broadcast channel (Task 4).
- Produces: `window.overlayAPI.getSettings()` and `window.overlayAPI.onSettingsUpdate(cb)` — consumed by Task 7's `overlay.html`.

- [ ] **Step 1: Add the two new bridge methods**

Replace the full contents of `electron/preload-overlay.js` with:

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onTimerUpdate:     (cb) => ipcRenderer.on('timer-update',    (_, d) => cb(d)),
  onEvidenceUpdate:  (cb) => ipcRenderer.on('evidence-update', (_, d) => cb(d)),
  onPlayAudio:       (cb) => ipcRenderer.on('play-audio',      (_, d) => cb(d)),
  onResetAll:        (cb) => ipcRenderer.on('reset-all',       ()     => cb()),
  setInteractive:    (interactive) => ipcRenderer.send('overlay-set-interactive', interactive),
  toggleEvidence:    (index)       => ipcRenderer.send('overlay-toggle-evidence', index),
  getSettings:       ()   => ipcRenderer.invoke('overlay-settings-get'),
  onSettingsUpdate:  (cb) => ipcRenderer.on('overlay-settings-update', (_, d) => cb(d)),
});
```

- [ ] **Step 2: Manual smoke check**

Run: `cd electron && npm start`. Expected console output still includes `[overlay] overlayAPI: overlayAPI_defined` (the diagnostic check in `main.js` only checks `window.overlayAPI` exists at all, so this confirms the file still loads without a syntax error). Close the app.

- [ ] **Step 3: Commit**

```bash
git add electron/preload-overlay.js
git commit -m "feat: expose overlay settings get/subscribe on overlayAPI"
```

---

### Task 7: Apply theme/scale/panel-visibility in the overlay window

**Files:**
- Modify: `electron/overlays/overlay.html`

**Interfaces:**
- Consumes: `window.overlayAPI.getSettings()`, `window.overlayAPI.onSettingsUpdate(cb)` (Task 6).

- [ ] **Step 1: Tag the body and each panel**

In `electron/overlays/overlay.html`, change the opening `<body>` tag (line 68) to:

```html
<body class="theme-default">
```

Change the three `<div class="panel">` opening tags (lines 71, 90, 125) to include a `data-panel` attribute identifying which settings key controls them:

```html
<div class="panel" data-panel="timers">
```
```html
<div class="panel" data-panel="evidence">
```
```html
<div class="panel" data-panel="ghosts">
```

- [ ] **Step 2: Refactor the hardcoded colors into theme-scoped CSS custom properties**

Replace the `<style>` block's color-bearing rules. The full new `<style>` block (replacing lines 5–66) is:

```html
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; overflow: hidden; user-select: none; height: 100vh; }
  body { font-family: 'Segoe UI', sans-serif; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  /* ── Theme variable sets ─────────────────────────────────────────────── */
  body.theme-default {
    --bg: rgba(10,10,20,0.85); --border: rgba(255,255,255,0.10);
    --text: rgba(255,255,255,0.80); --dim: rgba(255,255,255,0.35);
    --label: rgba(255,255,255,0.30); --accent: #4fc; --bad-text: #f64;
    --empty: rgba(255,255,255,0.25); --nomatch: rgba(255,80,80,0.7);
  }
  body.theme-high-contrast {
    --bg: rgba(0,0,0,0.95); --border: rgba(255,255,255,0.35);
    --text: #ffffff; --dim: rgba(255,255,255,0.65);
    --label: rgba(255,255,255,0.60); --accent: #00eaff; --bad-text: #ff3333;
    --empty: rgba(255,255,255,0.45); --nomatch: #ff5555;
  }
  body.theme-colorblind-friendly {
    --bg: rgba(10,10,20,0.85); --border: rgba(255,255,255,0.10);
    --text: rgba(255,255,255,0.80); --dim: rgba(255,255,255,0.35);
    --label: rgba(255,255,255,0.30); --accent: #4fc; --bad-text: #ff9900;
    --empty: rgba(255,255,255,0.25); --nomatch: #ff9900;
  }
  body.theme-minimal {
    --bg: rgba(10,10,20,0.45); --border: rgba(255,255,255,0.05);
    --text: rgba(255,255,255,0.65); --dim: rgba(255,255,255,0.25);
    --label: rgba(255,255,255,0.20); --accent: #8fd; --bad-text: #c66;
    --empty: rgba(255,255,255,0.15); --nomatch: #c66;
  }

  .panel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    backdrop-filter: blur(4px);
  }

  .sec-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.7px;
    color: var(--label); margin-bottom: 6px;
  }

  /* Timers */
  .timer-grid { display: flex; gap: 4px; justify-content: space-between; }
  .timer-cell { text-align: center; flex: 1; }
  .t-label { display: block; font-size: 9px; color: var(--dim);
             text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
  .t-value { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums;
             color: var(--dim); }
  .t-value.running  { color: var(--accent); }
  .t-value.ended    { color: var(--bad-text); }
  .t-value.overtime { color: var(--bad-text); }

  /* Evidence icons */
  .evi-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .evi-item {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    opacity: 0.45; transition: opacity 0.15s;
  }
  .evi-item img { width: 26px; height: 26px; filter: brightness(0) invert(1); }

  /* good (confirmed present) — default: green */
  .evi-item.good { opacity: 1.0; }
  .evi-item.good img {
    filter: brightness(0) saturate(100%) invert(80%) sepia(80%)
            saturate(400%) hue-rotate(100deg) brightness(1.1);
  }

  /* bad (confirmed absent) — default: dim red */
  .evi-item.bad { opacity: 0.55; }
  .evi-item.bad img {
    filter: brightness(0) saturate(100%) invert(30%) sepia(90%)
            saturate(2000%) hue-rotate(340deg) brightness(0.9);
  }
  .evi-key { font-size: 8px; color: var(--label); }

  .evi-item { cursor: pointer; }
  .evi-item:hover { opacity: 0.75; }
  .evi-item.good:hover, .evi-item.bad:hover { opacity: 0.85; }

  /* Theme overrides for good/bad icon tint — colorblind-friendly swaps
     green/red for blue/orange; high-contrast and minimal adjust intensity. */
  body.theme-high-contrast .evi-item.good img {
    filter: brightness(0) saturate(100%) invert(90%) sepia(90%) saturate(800%) hue-rotate(95deg) brightness(1.4);
  }
  body.theme-high-contrast .evi-item.bad img {
    filter: brightness(0) saturate(100%) invert(40%) sepia(100%) saturate(3000%) hue-rotate(345deg) brightness(1.2);
  }
  body.theme-colorblind-friendly .evi-item.good img {
    filter: brightness(0) saturate(100%) invert(50%) sepia(90%) saturate(600%) hue-rotate(180deg) brightness(1.1);
  }
  body.theme-colorblind-friendly .evi-item.bad img {
    filter: brightness(0) saturate(100%) invert(60%) sepia(85%) saturate(900%) hue-rotate(0deg) brightness(1.3);
  }
  body.theme-minimal .evi-item.good img {
    filter: brightness(0) saturate(100%) invert(75%) sepia(30%) saturate(150%) hue-rotate(100deg) brightness(0.9);
  }
  body.theme-minimal .evi-item.bad img {
    filter: brightness(0) saturate(100%) invert(40%) sepia(40%) saturate(500%) hue-rotate(340deg) brightness(0.7);
  }

  /* Ghost list */
  .ghost-list { display: flex; flex-direction: column; gap: 2px; }
  .ghost { font-size: 12px; color: var(--text); padding: 1px 0; }
  .ghost.empty { color: var(--empty); font-size: 11px; font-style: italic; }
  .ghost.no-match { color: var(--nomatch); font-style: italic; font-size: 11px; }
</style>
```

- [ ] **Step 3: Add the settings-apply JS and wire it up on load + live update**

In the `<script>` block, after the existing `resetDisplay()` function (ends around line 213) and before the "Evidence panel: hover-driven interactivity" comment, add:

```js
  // ── Overlay settings (theme / scale / panel visibility) ────────────────────
  function applySettings(settings) {
    if (!settings) return;
    document.body.className = 'theme-' + (settings.theme || 'default');
    document.body.style.zoom = settings.scale || 1;
    const panels = settings.panels || {};
    document.querySelectorAll('.panel[data-panel]').forEach(el => {
      const visible = panels[el.dataset.panel] !== false;
      el.style.display = visible ? '' : 'none';
    });
  }
```

Then, at the end of the existing `if (window.overlayAPI) { ... }` IPC-wiring block (the one containing `onTimerUpdate`, `onEvidenceUpdate`, `onPlayAudio`, `onResetAll` — ends around line 242), add two more lines inside that same `if` block, right before its closing `}`:

```js
    window.overlayAPI.getSettings().then(applySettings).catch(e => console.error('[overlay] getSettings failed:', e.message));
    window.overlayAPI.onSettingsUpdate(applySettings);
```

- [ ] **Step 4: Manual verification pass (real hardware — matches the spec's testing section)**

Run: `cd electron && del overlay-settings.json 2>$null; npm start` (deleting any stale file forces defaults). Then, with the app running, open the settings window (`Ctrl+Shift+O`) and, watching the overlay window live:

1. Click each of the 4 corner buttons — overlay repositions correctly and stays fully on-screen.
2. Drag the scale slider — overlay text/icons/panels visibly resize.
3. Click each of the 4 theme swatches — overlay panel background/text/accent colors visibly change, and the Evidence panel's good/bad icon tints visibly differ per theme (spot-check by toggling an evidence icon in the main web app or via `Ctrl+1`).
4. Uncheck each panel checkbox — the corresponding overlay panel disappears immediately; re-check restores it.
5. Close the app fully (`Get-Process electron | Stop-Process -Force`), relaunch (`npm start`) — overlay comes up already reflecting the last-saved corner/scale/theme/panel state (check `electron/overlay-settings.json` was written with your last choices).
6. Temporarily corrupt the file (`echo not-json > electron/overlay-settings.json`), relaunch — app starts normally with default overlay settings, no crash.
7. Confirm unrelated overlay behavior still works: evidence icons still toggle via `Ctrl+1`..`Ctrl+7` and via click, timers still count via `Shift+F1`/`F2`/`F3`, and timer audio still plays.

Fix anything that fails before proceeding. Delete the corrupt test file's contents back to a clean state (or just delete it — it regenerates) when done.

- [ ] **Step 5: Commit**

```bash
git add electron/overlays/overlay.html
git commit -m "feat: apply overlay theme/scale/panel-visibility live and on load"
```

---

### Task 8: Update project docs

**Files:**
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add a session entry and check off the to-do item**

In `docs/PROGRESS.md`, add a new section after the "2026-08-03 session, part 2 — Packaged installer + shared server" section (before `## To Do`):

```markdown
## 2026-08-03 session, part 3 — Overlay customization

Added a dedicated Overlay Settings window (`Ctrl+Shift+O`), modeled on the existing Hotkey Manager, letting
the user control the combined overlay's corner (top-left/top-right/bottom-left/bottom-right), scale
(75%–150%), color theme (Default / High Contrast / Colorblind Friendly / Minimal), and per-panel visibility
(Timers / Evidence / Possible Ghosts). Settings persist to `electron/overlay-settings.json` (gitignored,
machine-local) and apply live — no restart needed, and no Save button, matching the Hotkey Manager's UX.

Two new pure, unit-tested modules: `electron/overlay-bounds.js` (corner+scale → window bounds math) and
`electron/overlay-settings-store.js` (load/save/validate the settings file, with per-field fallback to
defaults so one bad value — e.g. hand-edited to an invalid corner — doesn't reset the whole file). The
overlay's CSS was refactored from hardcoded colors to theme-scoped custom properties (`--bg`, `--text`,
`--accent`, etc.) so `.theme-default` reproduces the pre-existing look exactly, with three additional theme
blocks layered on top.

Built via the full brainstorm → spec → plan → implementation workflow — see
`docs/superpowers/specs/2026-08-03-overlay-customization-design.md` and
`docs/superpowers/plans/2026-08-03-overlay-customization.md`.
```

Then change the `## To Do` list's overlay-customization line from:

```markdown
- [ ] Overlay customization
```

to:

```markdown
- [x] Overlay customization
```

- [ ] **Step 2: Commit**

```bash
git add docs/PROGRESS.md
git commit -m "docs: log overlay customization feature in progress notes"
```

---

## Post-plan reminder

Per `CLAUDE.md`'s graphify rule: after this plan's code-file changes are complete, run `graphify update .` from the repo root to keep the knowledge graph current (AST-only, no API cost).
