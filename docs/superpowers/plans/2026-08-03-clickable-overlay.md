# Clickable Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the evidence icons on the Electron overlay clickable (hover-activated, click-through everywhere else), reusing the existing hotkey toggle path so clicks and `Ctrl+1..7` behave identically.

**Architecture:** Two layers. (1) Backend IPC: two new `ipcMain.on` handlers in `electron/main.js` — one toggles `overlay.setIgnoreMouseEvents` on hover, one calls the existing `execEvidenceToggle(index)` — exposed to the overlay renderer via two new methods on `preload-overlay.js`'s `overlayAPI`. (2) Overlay UI: `overlay.html` gets `data-idx` attributes on evidence icons, `mouseenter`/`mouseleave` on the evidence panel, and `click` per icon, plus a small CSS affordance.

**Tech Stack:** Electron (BrowserWindow, ipcMain/ipcRenderer, contextBridge). No test framework exists in this project — verification is manual, driven by the app's existing console-log diagnostics (`[main-console]`, `[overlay-console]` forwarding already wired in `main.js`).

## Global Constraints

- Scope is evidence icons only — timers and the ghost list stay display-only (per spec).
- Never add `fs`/`path`/other Node built-ins to `preload-overlay.js` — Electron's sandbox blocks Node built-ins in preloads and this previously broke `window.overlayAPI` entirely (documented incident in project memory).
- Overlay clicks must reuse `execEvidenceToggle(index)` exactly — no parallel/duplicate evidence-toggle logic.
- Only the evidence panel becomes interactive; the rest of the overlay must remain click-through at all times.

---

### Task 1: Backend IPC wiring (main.js + preload-overlay.js)

**Files:**
- Modify: `electron/main.js:241-245` (add two new `ipcMain.on` handlers next to the existing `evidence-result` handler)
- Modify: `electron/preload-overlay.js:4-9` (add two new methods to the exposed `overlayAPI`)

**Interfaces:**
- Consumes: existing `execEvidenceToggle(index)` function already defined in `main.js:59-63`; existing `overlay` module-level variable (`main.js:33`).
- Produces: `ipcMain` channels `'overlay-set-interactive'` (payload: `boolean`) and `'overlay-toggle-evidence'` (payload: `number` 0-6); preload-exposed `window.overlayAPI.setInteractive(interactive: boolean)` and `window.overlayAPI.toggleEvidence(index: number)`, both fire-and-forget `ipcRenderer.send` wrappers. Task 2 calls these two methods directly.

- [ ] **Step 1: Add the two IPC handlers in `main.js`**

Insert immediately after the existing `evidence-result` handler (after line 245, before the `toggle-timer` comment block):

```javascript
// Overlay → main: toggle overlay's click-through state for hover-driven interactivity
ipcMain.on('overlay-set-interactive', (_, interactive) => {
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  }
});

// Overlay → main: evidence icon clicked; reuse the same path as Ctrl+1..7 hotkeys
ipcMain.on('overlay-toggle-evidence', (_, index) => {
  console.log('[overlay-toggle-evidence] index:', index);
  execEvidenceToggle(index);
});
```

- [ ] **Step 2: Expose the two methods in `preload-overlay.js`**

Replace the full file contents with:

```javascript
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onTimerUpdate:    (cb) => ipcRenderer.on('timer-update',    (_, d) => cb(d)),
  onEvidenceUpdate: (cb) => ipcRenderer.on('evidence-update', (_, d) => cb(d)),
  onPlayAudio:      (cb) => ipcRenderer.on('play-audio',      (_, d) => cb(d)),
  onResetAll:       (cb) => ipcRenderer.on('reset-all',       ()     => cb()),
  setInteractive:   (interactive) => ipcRenderer.send('overlay-set-interactive', interactive),
  toggleEvidence:   (index)       => ipcRenderer.send('overlay-toggle-evidence', index),
});
```

- [ ] **Step 3: Manually verify the IPC plumbing works before wiring the UI**

Temporarily add one line at the end of `createOverlay()` in `main.js` (right after the `overlay.webContents.on('console-message', ...)` line, `main.js:162`):

```javascript
overlay.webContents.openDevTools({ mode: 'detach' });
```

Run: `cd electron && npm start`
In the detached DevTools console that opens for the overlay window, run:

```javascript
window.overlayAPI.toggleEvidence(0)
```

Expected: the terminal running `npm start` prints `[overlay-toggle-evidence] index: 0` followed by the existing `[evidence-result] received, ghosts: N` log line (confirms the round-trip through `execEvidenceToggle` → web page → `sendFilterResult` all still fires). Also run `window.overlayAPI.setInteractive(true)` and confirm no error is thrown in that console.

Then remove the temporary `overlay.webContents.openDevTools(...)` line — it must not ship.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload-overlay.js
git commit -m "feat: add overlay IPC handlers for hover-interactive click-through and evidence toggle"
```

---

### Task 2: Overlay UI wiring (overlay.html)

**Files:**
- Modify: `electron/overlays/overlay.html` (CSS block `:36-40`, evidence markup `:89-116`, script block `:211-225`)

**Interfaces:**
- Consumes: `window.overlayAPI.setInteractive(interactive: boolean)` and `window.overlayAPI.toggleEvidence(index: number)` from Task 1.
- Produces: fully working feature — nothing downstream depends on this task.

- [ ] **Step 1: Add `data-idx` to each evidence icon**

In the evidence markup (`overlay.html:89-116`), add a `data-idx` attribute to each `.evi-item`, matching the existing `Ctrl+1..7` order (EMF 5=0, Ultraviolet=1, Writing=2, Ghost Orbs=3, Spirit Box=4, Freezing=5, DOTs=6):

```html
<div class="evi-item" data-evi="EMF 5" data-idx="0">
  <img src="../../imgs/emf5-icon.png" alt="EMF 5">
  <span class="evi-key">^1</span>
</div>
<div class="evi-item" data-evi="Ultraviolet" data-idx="1">
  <img src="../../imgs/fingerprints-icon.png" alt="UV">
  <span class="evi-key">^2</span>
</div>
<div class="evi-item" data-evi="Writing" data-idx="2">
  <img src="../../imgs/writing-icon.png" alt="Writing">
  <span class="evi-key">^3</span>
</div>
<div class="evi-item" data-evi="Ghost Orbs" data-idx="3">
  <img src="../../imgs/orbs-icon.png" alt="Orbs">
  <span class="evi-key">^4</span>
</div>
<div class="evi-item" data-evi="Spirit Box" data-idx="4">
  <img src="../../imgs/spirit-box-icon.png" alt="Spirit Box">
  <span class="evi-key">^5</span>
</div>
<div class="evi-item" data-evi="Freezing" data-idx="5">
  <img src="../../imgs/freezing-icon.png" alt="Freezing">
  <span class="evi-key">^6</span>
</div>
<div class="evi-item" data-evi="DOTs" data-idx="6">
  <img src="../../imgs/dots-icon.png" alt="DOTS">
  <span class="evi-key">^7</span>
</div>
```

- [ ] **Step 2: Add hover-affordance CSS scoped to the evidence panel**

In the CSS block, right after the existing `.evi-key` rule (`overlay.html:55`), add:

```css
  .evi-item { cursor: pointer; }
  .evi-item:hover { opacity: 0.75; }
  .evi-item.good:hover, .evi-item.bad:hover { opacity: 0.85; }
```

- [ ] **Step 3: Wire hover and click listeners**

In the script block, right before the existing `// ── Wire IPC ──` comment (`overlay.html:211`), add:

```javascript
  // ── Evidence panel: hover-driven interactivity + click-to-toggle ───────────
  if (window.overlayAPI) {
    const evidencePanel = document.querySelector('.evi-grid').closest('.panel');
    evidencePanel.addEventListener('mouseenter', () => window.overlayAPI.setInteractive(true));
    evidencePanel.addEventListener('mouseleave', () => window.overlayAPI.setInteractive(false));

    document.querySelectorAll('.evi-item').forEach(el => {
      el.addEventListener('click', () => {
        window.overlayAPI.toggleEvidence(parseInt(el.dataset.idx, 10));
      });
    });
  }
```

- [ ] **Step 4: Manual end-to-end verification**

Run: `cd electron && npm start` (server must already be running per `docs/PROGRESS.md` dev workflow — `cd server && node server.js` in a separate terminal).

Verify each of the following:
1. Move the mouse over the overlay's Evidence panel — hovering an icon dims it slightly (CSS `:hover` from Step 2), confirming the panel is receiving mouse events.
2. Click an evidence icon — it cycles neutral → good → bad → neutral (same as pressing the corresponding `Ctrl+<n>` hotkey), and the "Possible Ghosts" list updates to match.
3. Move the mouse off the Evidence panel onto another part of the transparent overlay (e.g. over the Timers panel or empty background) and try clicking — confirm the click passes through to whatever window/game is behind the overlay (the overlay does not intercept it).
4. Press `Ctrl+1` through `Ctrl+7` — confirm hotkeys still toggle evidence exactly as before (unaffected by this change).
5. Trigger Reset (`Ctrl+Shift+X` or the web UI Reset button) — confirm the evidence panel still resets to neutral and clicking/hovering still works afterward.

- [ ] **Step 5: Commit**

```bash
git add electron/overlays/overlay.html
git commit -m "feat: make evidence icons clickable on the overlay via hover-activated click-through"
```
