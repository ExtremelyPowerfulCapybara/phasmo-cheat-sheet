# Phasmo Cheatsheet — Electron Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Electron app so `main.js` owns timer/evidence state, overlays receive updates directly from main, and the web page is served from a permanent hosted server.

**Architecture:** `state.js` in the main process owns all timer state with setInterval ticking. Web page (loaded from hosted URL) sends evidence changes to main via IPC; main broadcasts to overlay and relays to WS room. Overlay is a transparent always-on-top left-side window receiving push updates only. WebSocket room sync for timers is relayed through the web page.

**Tech Stack:** Electron, Node.js 20, WebSocket (existing ws library in server), HTML/CSS/JS (overlay), Docker, Caddy.

## Global Constraints

- No new npm dependencies in `electron/` — use only what is already installed
- All IPC is one-way push from main (no invoke/reply except hotkey manager)
- Overlay positioned at left side of primary display (x=8)
- All hotkeys configurable via Hotkey Manager (Ctrl+Shift+K fixed)
- Evidence IDs in order: index 0=EMF 5, 1=Ultraviolet, 2=Writing, 3=Ghost Orbs, 4=Spirit Box, 5=Freezing, 6=DOTs
- Timer IDs: `'smudge'` | `'cooldown'` | `'hunt'`
- Evidence/ghost data format: `{ evidence: { "EMF 5": bool, ... }, ghostList: string[] }`
- Timer data format: `{ id: string, value: string, running: bool }` where value is `'M:SS'`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/config.json` | **Create** | Server URL setting |
| `electron/state.js` | **Create** | Timer state, tick logic, broadcast hook |
| `electron/preload-overlay.js` | **Create** | IPC preload for overlay window only |
| `electron/main.js` | **Modify** | Remove server spawn, load config, wire state.js, update shortcuts DEFAULTS, new IPC handlers |
| `electron/preload.js` | **Modify** | New IPC channels for evidence, timer, maps |
| `electron/overlays/overlay.html` | **Rewrite** | Left-side overlay: timers + evidence icons + ghost list + audio |
| `electron/shortcuts-window.html` | **Modify** | Update LABELS map for new hotkey names |
| `scripts-v10/filter-v15.js` | **Modify** | Add `sendFilterResult()` at end of `filter()`, wire evidence hotkey IPC |
| `scripts-v10/wslink-v8.js` | **Modify** | TIMER WS actions → IPC, relay main timer toggle to WS, remove old `send_*_link` functions |
| `scripts-v10/timer-v4.js` | **Modify** | Stub `toggle_timer/cooldown/hunt` to IPC, remove Web Worker logic and bare-key handlers |
| `server/Dockerfile` | **Create** | Containerize server.js |
| `server/docker-compose.yml` | **Create** | Compose entry for self-hosted deployment |

---

## Task 1: Create config.json and remove local server spawn from main.js

**Files:**
- Create: `electron/config.json`
- Modify: `electron/main.js`

**Interfaces:**
- Produces: `FRONTEND_URL` constant read from config, used by all tasks that modify main.js

- [ ] **Step 1: Create `electron/config.json`**

```json
{
  "serverUrl": "http://localhost:3000"
}
```

- [ ] **Step 2: Replace the FRONTEND_URL constant and add config loading at top of main.js**

Replace lines 1–7 of `electron/main.js`:

```js
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH    = path.join(__dirname, 'config.json');
const SHORTCUTS_PATH = path.join(__dirname, 'shortcuts.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: 'http://localhost:3000' }; }
}

const config      = loadConfig();
const FRONTEND_URL = config.serverUrl;
```

- [ ] **Step 3: Delete `startServer()` and all references**

Remove from `electron/main.js`:
- Line 4: `const { spawn } = require('child_process');`
- Line 24: `let serverProcess = null;`
- Lines 42–57: the entire `startServer()` function
- In `app.whenReady()`: the `startServer();` call
- In `app.on('will-quit')`: the `if (serverProcess) serverProcess.kill();` line

- [ ] **Step 4: Verify app starts without local server**

Start the server separately: `cd D:/GitHub/Cheatsheet/server && node server.js`

Then: `cd D:/GitHub/Cheatsheet/electron && npm start`

Expected: Electron opens. Main window loads the cheatsheet. No crash on startup. Terminal shows no `[server]` spawn messages.

- [ ] **Step 5: Commit**

```bash
git add electron/config.json electron/main.js
git commit -m "feat: load server URL from config.json, remove local server spawn"
```

---

## Task 2: Create electron/state.js — timer state module

**Files:**
- Create: `electron/state.js`
- Create: `electron/state.test.js`

**Interfaces:**
- Produces: `module.exports = { toggleTimer(id), resetAll(), setDuration(id, ms), setBroadcast(fn) }`
- `setBroadcast(fn)` — registers `fn(channel, data)` called on every state change; main.js calls this once
- Broadcasts emitted: `'timer-update'` with `{ id, value, running }` every 100ms tick; `'play-audio'` with `{ id, event }` at milestones; `'reset-all'` with `{}` on reset

- [ ] **Step 1: Write the test**

Create `electron/state.test.js`:

```js
'use strict';
const state = require('./state.js');

const broadcasts = [];
state.setBroadcast((channel, data) => broadcasts.push({ channel, data }));

// Test: toggleTimer starts a timer
state.toggleTimer('smudge');
setTimeout(() => {
  const start = broadcasts.find(b => b.channel === 'timer-update' && b.data.id === 'smudge' && b.data.running);
  console.assert(start !== undefined, 'FAIL: no running timer-update broadcast on start');
  console.assert(typeof start.data.value === 'string', 'FAIL: value should be a string');

  // Test: second toggle stops the timer
  state.toggleTimer('smudge');
  const stop = broadcasts.filter(b => b.channel === 'timer-update' && b.data.id === 'smudge').pop();
  console.assert(stop.data.running === false, 'FAIL: running should be false after second toggle');

  // Test: resetAll stops all timers
  state.toggleTimer('hunt');
  state.resetAll();
  const resetBroadcast = broadcasts.find(b => b.channel === 'reset-all');
  console.assert(resetBroadcast !== undefined, 'FAIL: reset-all not broadcast');

  // Test: setDuration changes timer length
  state.setDuration('cooldown', 5000);
  state.toggleTimer('cooldown');
  const cooldownStart = broadcasts.filter(b => b.channel === 'timer-update' && b.data.id === 'cooldown' && b.data.running).pop();
  console.assert(cooldownStart !== undefined, 'FAIL: cooldown did not start');

  console.log('All state.js tests passed');
  process.exit(0);
}, 200);
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd D:/GitHub/Cheatsheet/electron && node state.test.js
```

Expected: `Error: Cannot find module './state.js'`

- [ ] **Step 3: Create `electron/state.js`**

```js
'use strict';

const TICK_MS = 100;

const DURATIONS = {
  smudge:   90000,
  cooldown: 25000,
  hunt:     60000,
};

const timers = {
  smudge:   { running: false, remaining: DURATIONS.smudge,   duration: DURATIONS.smudge,   interval: null },
  cooldown: { running: false, remaining: DURATIONS.cooldown, duration: DURATIONS.cooldown, interval: null },
  hunt:     { running: false, remaining: DURATIONS.hunt,     duration: DURATIONS.hunt,     interval: null },
};

let broadcastFn = null;

function broadcast(channel, data) {
  if (broadcastFn) broadcastFn(channel, data);
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function stopTimer(id) {
  const t = timers[id];
  if (t.interval) { clearInterval(t.interval); t.interval = null; }
  t.running = false;
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: false });
}

function startTimer(id) {
  const t = timers[id];
  t.running = true;
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: true });
  t.interval = setInterval(() => {
    t.remaining -= TICK_MS;
    if (t.remaining <= 0) {
      t.remaining = 0;
      stopTimer(id);
      broadcast('play-audio', { id, event: 'ended' });
      return;
    }
    if (t.remaining <= 10000 && (t.remaining + TICK_MS) > 10000) {
      broadcast('play-audio', { id, event: 'warning' });
    }
    broadcast('timer-update', { id, value: formatMs(t.remaining), running: true });
  }, TICK_MS);
}

function toggleTimer(id) {
  if (!timers[id]) return;
  const t = timers[id];
  if (t.running) {
    stopTimer(id);
  } else {
    t.remaining = t.duration;
    startTimer(id);
  }
}

function resetAll() {
  for (const id of Object.keys(timers)) {
    if (timers[id].interval) { clearInterval(timers[id].interval); timers[id].interval = null; }
    timers[id].running   = false;
    timers[id].remaining = timers[id].duration;
    broadcast('timer-update', { id, value: formatMs(timers[id].duration), running: false });
  }
  broadcast('reset-all', {});
}

function setDuration(id, ms) {
  if (!timers[id]) return;
  timers[id].duration = ms;
  if (!timers[id].running) timers[id].remaining = ms;
}

function setBroadcast(fn) {
  broadcastFn = fn;
}

module.exports = { toggleTimer, resetAll, setDuration, setBroadcast };
```

- [ ] **Step 4: Run test — verify it passes**

```bash
node D:/GitHub/Cheatsheet/electron/state.test.js
```

Expected: `All state.js tests passed`

- [ ] **Step 5: Commit**

```bash
git add electron/state.js electron/state.test.js
git commit -m "feat: add state.js timer module with tick, broadcast, reset"
```

---

## Task 3: Create electron/preload-overlay.js

**Files:**
- Create: `electron/preload-overlay.js`

**Interfaces:**
- Produces: `window.overlayAPI` with `serverUrl: string`, `onTimerUpdate(cb)`, `onEvidenceUpdate(cb)`, `onPlayAudio(cb)`, `onResetAll(cb)`
- Consumed by: `electron/overlays/overlay.html` (Task 4)

- [ ] **Step 1: Create `electron/preload-overlay.js`**

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const fs   = require('fs');
const path = require('path');

let serverUrl = 'http://localhost:3000';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  serverUrl = cfg.serverUrl || serverUrl;
} catch {}

contextBridge.exposeInMainWorld('overlayAPI', {
  serverUrl,
  onTimerUpdate:    (cb) => ipcRenderer.on('timer-update',    (_, d) => cb(d)),
  onEvidenceUpdate: (cb) => ipcRenderer.on('evidence-update', (_, d) => cb(d)),
  onPlayAudio:      (cb) => ipcRenderer.on('play-audio',      (_, d) => cb(d)),
  onResetAll:       (cb) => ipcRenderer.on('reset-all',       ()     => cb()),
});
```

- [ ] **Step 2: Verify syntax (no Electron module errors)**

```bash
node -e "require('./electron/preload-overlay.js')" 2>&1 | grep -v "Cannot find module 'electron'"
```

Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add electron/preload-overlay.js
git commit -m "feat: add preload-overlay.js for overlay IPC channels"
```

---

## Task 4: Redesign electron/overlays/overlay.html

**Files:**
- Modify: `electron/overlays/overlay.html` (full rewrite)

**Interfaces:**
- Consumes: `window.overlayAPI` (Task 3)
- Timer format in: `{ id: 'smudge'|'cooldown'|'hunt', value: '1:30', running: bool }`
- Evidence format in: `{ evidence: { "EMF 5": bool, "Ultraviolet": bool, "Writing": bool, "Ghost Orbs": bool, "Spirit Box": bool, "Freezing": bool, "DOTs": bool }, ghostList: string[] }`
- Audio format in: `{ id: string, event: 'warning'|'ended' }` — plays synthetic tone via Web Audio API

- [ ] **Step 1: Verify all icon paths exist**

```bash
ls D:/GitHub/Cheatsheet/imgs/emf5-icon.png \
   D:/GitHub/Cheatsheet/imgs/fingerprints-icon.png \
   D:/GitHub/Cheatsheet/imgs/writing-icon.png \
   D:/GitHub/Cheatsheet/imgs/orbs-icon.png \
   D:/GitHub/Cheatsheet/imgs/spirit-box-icon.png \
   D:/GitHub/Cheatsheet/imgs/freezing-icon.png \
   D:/GitHub/Cheatsheet/imgs/dots-icon.png
```

Expected: All 7 files listed. If any are missing, note the actual filename from `ls D:/GitHub/Cheatsheet/imgs/` and update the `src` paths below.

- [ ] **Step 2: Rewrite `electron/overlays/overlay.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; overflow: hidden; user-select: none; height: 100vh; }
  body { font-family: 'Segoe UI', sans-serif; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .panel {
    background: rgba(10,10,20,0.85);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 8px;
    padding: 8px 12px;
    backdrop-filter: blur(4px);
  }

  .sec-label {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.7px;
    color: rgba(255,255,255,0.30); margin-bottom: 6px;
  }

  /* Timers */
  .timer-grid { display: flex; gap: 4px; justify-content: space-between; }
  .timer-cell { text-align: center; flex: 1; }
  .t-label { display: block; font-size: 9px; color: rgba(255,255,255,0.35);
             text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
  .t-value { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums;
             color: rgba(255,255,255,0.20); }
  .t-value.running { color: #4fc; }
  .t-value.ended   { color: #f64; }

  /* Evidence icons */
  .evi-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .evi-item {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    opacity: 0.22; transition: opacity 0.15s;
  }
  .evi-item.active { opacity: 1.0; }
  .evi-item img { width: 26px; height: 26px; filter: brightness(0) invert(1); }
  .evi-item.active img {
    filter: brightness(0) saturate(100%) invert(80%) sepia(80%)
            saturate(400%) hue-rotate(100deg) brightness(1.1);
  }
  .evi-key { font-size: 8px; color: rgba(255,255,255,0.30); }

  /* Ghost list */
  .ghost-list { display: flex; flex-direction: column; gap: 2px; }
  .ghost { font-size: 12px; color: rgba(255,255,255,0.80); padding: 1px 0; }
  .ghost.empty { color: rgba(255,255,255,0.25); font-size: 11px; font-style: italic; }
  .ghost.no-match { color: rgba(255,80,80,0.7); font-style: italic; font-size: 11px; }
</style>
</head>
<body>

<!-- Timers -->
<div class="panel">
  <div class="sec-label">Timers</div>
  <div class="timer-grid">
    <div class="timer-cell">
      <span class="t-label">Smudge</span>
      <div class="t-value" id="t-smudge">—</div>
    </div>
    <div class="timer-cell">
      <span class="t-label">Cooldown</span>
      <div class="t-value" id="t-cooldown">—</div>
    </div>
    <div class="timer-cell">
      <span class="t-label">Hunt</span>
      <div class="t-value" id="t-hunt">—</div>
    </div>
  </div>
</div>

<!-- Evidence -->
<div class="panel">
  <div class="sec-label">Evidence</div>
  <div class="evi-grid">
    <div class="evi-item" data-evi="EMF 5">
      <img src="../../imgs/emf5-icon.png" alt="EMF 5">
      <span class="evi-key">S+1</span>
    </div>
    <div class="evi-item" data-evi="Ultraviolet">
      <img src="../../imgs/fingerprints-icon.png" alt="UV">
      <span class="evi-key">S+2</span>
    </div>
    <div class="evi-item" data-evi="Writing">
      <img src="../../imgs/writing-icon.png" alt="Writing">
      <span class="evi-key">S+3</span>
    </div>
    <div class="evi-item" data-evi="Ghost Orbs">
      <img src="../../imgs/orbs-icon.png" alt="Orbs">
      <span class="evi-key">S+4</span>
    </div>
    <div class="evi-item" data-evi="Spirit Box">
      <img src="../../imgs/spirit-box-icon.png" alt="Spirit Box">
      <span class="evi-key">S+5</span>
    </div>
    <div class="evi-item" data-evi="Freezing">
      <img src="../../imgs/freezing-icon.png" alt="Freezing">
      <span class="evi-key">S+6</span>
    </div>
    <div class="evi-item" data-evi="DOTs">
      <img src="../../imgs/dots-icon.png" alt="DOTS">
      <span class="evi-key">S+7</span>
    </div>
  </div>
</div>

<!-- Ghost list -->
<div class="panel">
  <div class="sec-label">Possible Ghosts</div>
  <div class="ghost-list" id="ghost-list">
    <div class="ghost empty">No evidence selected</div>
  </div>
</div>

<script>
  // ── Timer display ──────────────────────────────────────────────────────────
  function setTimer(id, value, running) {
    const el = document.getElementById('t-' + id);
    if (!el) return;
    el.textContent = value || '—';
    el.className = 't-value' + (running ? ' running' : (value === '0:00' ? ' ended' : ''));
  }

  // ── Evidence display ───────────────────────────────────────────────────────
  function setEvidence(evidence) {
    document.querySelectorAll('.evi-item').forEach(el => {
      el.classList.toggle('active', !!(evidence && evidence[el.dataset.evi]));
    });
  }

  // ── Ghost list display ─────────────────────────────────────────────────────
  function setGhostList(ghostList) {
    const list = document.getElementById('ghost-list');
    if (!ghostList || ghostList.length === 0) {
      list.innerHTML = '<div class="ghost no-match">No match</div>';
      return;
    }
    list.innerHTML = ghostList.slice(0, 12).map(g =>
      `<div class="ghost">${g}</div>`
    ).join('');
  }

  // ── Audio cues (synthetic tones via Web Audio API) ─────────────────────────
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  }
  function playTone(freq, duration, type = 'sine') {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }
  function handleAudio({ id, event }) {
    if (event === 'warning') playTone(880, 0.3);   // high beep at 10s
    if (event === 'ended')  playTone(220, 0.6, 'sawtooth'); // low buzz at 0s
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function resetDisplay() {
    ['smudge','cooldown','hunt'].forEach(id => setTimer(id, '—', false));
    setEvidence({});
    document.getElementById('ghost-list').innerHTML =
      '<div class="ghost empty">No evidence selected</div>';
  }

  // ── Wire IPC ──────────────────────────────────────────────────────────────
  if (window.overlayAPI) {
    window.overlayAPI.onTimerUpdate(({ id, value, running }) => setTimer(id, value, running));
    window.overlayAPI.onEvidenceUpdate(({ evidence, ghostList }) => {
      setEvidence(evidence);
      setGhostList(ghostList);
    });
    window.overlayAPI.onPlayAudio(handleAudio);
    window.overlayAPI.onResetAll(resetDisplay);
  }
</script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add electron/overlays/overlay.html
git commit -m "feat: redesign overlay — left side, 3 timers + evidence icons + ghost list + audio"
```

---

## Task 5: Refactor electron/main.js — wire state.js, update shortcuts, open overlay with preload-overlay.js

**Files:**
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: `electron/state.js` — `toggleTimer`, `resetAll`, `setDuration`, `setBroadcast`
- Consumes: `electron/preload-overlay.js` — used as preload for overlay window
- Produces: IPC handlers `toggle-timer` (web page → main), `evidence-result` (web page → main → overlay), `reset-all` (web page → main)
- Produces: main → web page channels `toggle-evidence` (index: number), `open-maps` (), `ws-broadcast-timer` ({ id: string })

- [ ] **Step 1: Require state.js in main.js**

Add after the existing `require` statements at the top:

```js
const state = require('./state.js');
```

- [ ] **Step 2: Replace DEFAULTS with new hotkey set**

Replace the existing `DEFAULTS` block:

```js
const DEFAULTS = {
  toggle_timer:          '1',
  toggle_cooldown_timer: '2',
  toggle_hunt_timer:     '3',
  toggle_evidence_0:     'Shift+1',
  toggle_evidence_1:     'Shift+2',
  toggle_evidence_2:     'Shift+3',
  toggle_evidence_3:     'Shift+4',
  toggle_evidence_4:     'Shift+5',
  toggle_evidence_5:     'Shift+6',
  toggle_evidence_6:     'Shift+7',
  open_maps:             'M',
  reset_all:             'Shift+R',
};
```

- [ ] **Step 3: Add helper functions and module-level shortcutHandlers**

Add after the `saveShortcuts` function:

```js
function broadcastTimerToggle(id) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ws-broadcast-timer', { id });
  }
}

function execEvidenceToggle(index) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toggle-evidence', index);
  }
}

function execOpenMaps() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-maps');
  }
}

let shortcutHandlers = {};

function buildHandlers() {
  shortcutHandlers = {
    toggle_timer:          () => { state.toggleTimer('smudge');   broadcastTimerToggle('smudge'); },
    toggle_cooldown_timer: () => { state.toggleTimer('cooldown'); broadcastTimerToggle('cooldown'); },
    toggle_hunt_timer:     () => { state.toggleTimer('hunt');     broadcastTimerToggle('hunt'); },
    toggle_evidence_0:     () => execEvidenceToggle(0),
    toggle_evidence_1:     () => execEvidenceToggle(1),
    toggle_evidence_2:     () => execEvidenceToggle(2),
    toggle_evidence_3:     () => execEvidenceToggle(3),
    toggle_evidence_4:     () => execEvidenceToggle(4),
    toggle_evidence_5:     () => execEvidenceToggle(5),
    toggle_evidence_6:     () => execEvidenceToggle(6),
    open_maps:             () => execOpenMaps(),
    reset_all:             () => state.resetAll(),
  };
}
```

- [ ] **Step 4: Replace applyShortcuts() to use shortcutHandlers**

Replace the entire `applyShortcuts()` function:

```js
function applyShortcuts(bindings) {
  for (const accel of Object.values(currentBindings)) {
    try { globalShortcut.unregister(accel); } catch {}
  }
  currentBindings = {};
  for (const [fn, accel] of Object.entries(bindings)) {
    if (!accel || !shortcutHandlers[fn]) continue;
    if (globalShortcut.register(accel, shortcutHandlers[fn])) {
      currentBindings[fn] = accel;
    } else {
      console.warn('[shortcut] failed to register:', accel, 'for', fn);
    }
  }
}
```

- [ ] **Step 5: Update ipcMain.handle('set-shortcut') to use shortcutHandlers**

In the `ipcMain.handle('set-shortcut')` handler, replace `() => exec(fn)` with `shortcutHandlers[fn]`:

```js
ipcMain.handle('set-shortcut', (_, { fn, accel }) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, fn))
    return { ok: false, error: 'Unknown action' };

  const old = currentBindings[fn];
  if (old) { try { globalShortcut.unregister(old); } catch {} }

  let ok = false;
  try { ok = globalShortcut.register(accel, shortcutHandlers[fn]); } catch {}

  if (ok) {
    currentBindings[fn] = accel;
    saveShortcuts(Object.assign({}, currentBindings));
    console.log(`[shortcut] ${fn}: ${old} → ${accel}`);
    return { ok: true };
  }
  if (old) {
    try { globalShortcut.register(old, shortcutHandlers[fn]); } catch {}
    currentBindings[fn] = old;
  }
  return { ok: false, error: `Could not register ${accel}` };
});
```

- [ ] **Step 6: Update createOverlay() — use preload-overlay.js and position left**

Replace the entire `createOverlay()` function:

```js
function createOverlay() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;

  overlay = new BrowserWindow({
    width:  280,
    height: height - 40,
    x:      8,
    y:      20,
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

  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(__dirname, 'overlays', 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => console.log('[overlay] loaded'));
}
```

- [ ] **Step 7: Wire state.js broadcast in app.whenReady()**

In `app.whenReady()`, after `createOverlay()` and before `applyShortcuts()`, add:

```js
  buildHandlers();

  state.setBroadcast((channel, data) => {
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, data);
    }
  });
```

- [ ] **Step 8: Replace old IPC relay with new handlers**

Delete the old IPC relay block (the `toOverlay` function and all `ipcMain.on('timer-update'...)` etc. handlers). Replace with:

```js
// Web page → main: relay evidence result to overlay
ipcMain.on('evidence-result', (_, data) => {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('evidence-update', data);
});

// Web page → main: timer toggle from WS remote action
ipcMain.on('toggle-timer', (_, id) => state.toggleTimer(id));

// Web page → main: reset all from WS remote action or UI button
ipcMain.on('reset-all', () => state.resetAll());
```

- [ ] **Step 9: Call buildHandlers() before applyShortcuts() in app.whenReady()**

Ensure `buildHandlers()` is called before `applyShortcuts(loadShortcuts())`. The `app.whenReady()` block should now look like:

```js
app.whenReady().then(() => {
  createMainWindow();
  createOverlay();

  buildHandlers();

  state.setBroadcast((channel, data) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, data);
  });

  applyShortcuts(loadShortcuts());
  globalShortcut.register('Control+Shift+K', openHotkeyManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
```

- [ ] **Step 10: Verify app starts, overlay appears on left, pressing `1` starts smudge timer**

```bash
cd D:/GitHub/Cheatsheet/electron && npm start
```

Expected:
- Overlay appears on LEFT side of screen
- Pressing `1` starts smudge timer countdown visible in overlay (green `1:30` → `1:29`...)
- Pressing `1` again stops timer
- No console errors about missing handlers

- [ ] **Step 11: Commit**

```bash
git add electron/main.js
git commit -m "feat: wire state.js to main, update shortcuts, overlay left side, new IPC handlers"
```

---

## Task 6: Update electron/preload.js

**Files:**
- Modify: `electron/preload.js`

**Interfaces:**
- Produces: `window.electronAPI.toggleTimer(id)` — web page → main
- Produces: `window.electronAPI.sendEvidenceResult(data)` — web page → main
- Produces: `window.electronAPI.onToggleEvidence(cb)` — main → web page
- Produces: `window.electronAPI.onOpenMaps(cb)` — main → web page
- Produces: `window.electronAPI.onWsBroadcastTimer(cb)` — main → web page
- Produces: `window.electronAPI.onResetAll(cb)` — main → web page
- Keeps: `getShortcuts`, `setShortcut`, `resetShortcuts`, `openHotkeyManager`

- [ ] **Step 1: Replace entire preload.js**

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Web page → main
  toggleTimer:        (id)   => ipcRenderer.send('toggle-timer',   id),
  sendEvidenceResult: (data) => ipcRenderer.send('evidence-result', data),
  resetAll:           ()     => ipcRenderer.send('reset-all'),

  // Main → web page
  onToggleEvidence:   (cb) => ipcRenderer.on('toggle-evidence',    (_, index) => cb(index)),
  onOpenMaps:         (cb) => ipcRenderer.on('open-maps',          ()         => cb()),
  onWsBroadcastTimer: (cb) => ipcRenderer.on('ws-broadcast-timer', (_, data)  => cb(data)),
  onResetAll:         (cb) => ipcRenderer.on('reset-all',          ()         => cb()),

  // Hotkey manager (unchanged)
  getShortcuts:      ()          => ipcRenderer.invoke('get-shortcuts'),
  setShortcut:       (fn, accel) => ipcRenderer.invoke('set-shortcut', { fn, accel }),
  resetShortcuts:    ()          => ipcRenderer.invoke('reset-shortcuts'),
  openHotkeyManager: ()          => ipcRenderer.send('open-hotkey-manager'),
});
```

- [ ] **Step 2: Verify no syntax error**

```bash
node -e "require('./electron/preload.js')" 2>&1 | grep -v "Cannot find module 'electron'"
```

Expected: No output.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat: update preload.js with evidence, timer, maps IPC channels"
```

---

## Task 7: Update scripts-v10/filter-v15.js — sendFilterResult and evidence hotkey wiring

**Files:**
- Modify: `scripts-v10/filter-v15.js`

**Interfaces:**
- Produces: `sendFilterResult()` — called at end of `filter()`, sends evidence state + visible ghost names to main
- Produces: IPC listener for `onToggleEvidence(index)` — triggers `tristate()` on the evidence element
- Consumes: `window.electronAPI.sendEvidenceResult({ evidence, ghostList })` from preload.js (Task 6)

- [ ] **Step 1: Find the end of filter() function**

```bash
grep -n "^}" D:/GitHub/Cheatsheet/scripts-v10/filter-v15.js | awk -F: '$1 > 558' | head -5
```

Note the first closing brace line number — that is the end of `filter()`. You will add `sendFilterResult()` just before it.

- [ ] **Step 2: Add sendFilterResult() function after line 26 in filter-v15.js**

Add after `let wakeLock = null;` (line 26):

```js
function sendFilterResult() {
  if (!window.electronAPI) return;
  const EVI_KEYS = ['EMF 5', 'Ultraviolet', 'Writing', 'Ghost Orbs', 'Spirit Box', 'Freezing', 'DOTs'];
  const evidence = {};
  for (const key of EVI_KEYS) {
    evidence[key] = (state['evidence'][key] === 1);
  }
  const ghostList = [];
  document.querySelectorAll('[name="ghost"]').forEach(el => {
    if (!el.classList.contains('hidden')) ghostList.push(el.id);
  });
  window.electronAPI.sendEvidenceResult({ evidence, ghostList });
}
```

- [ ] **Step 3: Add sendFilterResult() call at end of filter() function**

Find the closing `}` of `filter()` (the line number noted in Step 1). Insert before it:

```js
  sendFilterResult();
```

- [ ] **Step 4: Add IPC listener block at the bottom of filter-v15.js (before or after `auto_link()`)**

```js
// ── Electron IPC: evidence hotkeys and maps from main process ──────────────
if (window.electronAPI) {
  const EVIDENCE_HOTKEY_MAP = [
    'EMF 5', 'Ultraviolet', 'Writing', 'Ghost Orbs', 'Spirit Box', 'Freezing', 'DOTs'
  ];

  window.electronAPI.onToggleEvidence((index) => {
    const eviName = EVIDENCE_HOTKEY_MAP[index];
    if (!eviName) return;
    const el = document.querySelector(`[name="evidence"][value="${eviName}"]`);
    if (el) tristate(el);
  });

  window.electronAPI.onOpenMaps(() => {
    if (typeof closeAll === 'function') closeAll(true, false);
    if (typeof showSideMenu === 'function') showSideMenu('maps');
  });

  window.electronAPI.onResetAll(() => {
    if (typeof reset === 'function') reset();
  });
}
```

- [ ] **Step 5: Manual test — evidence hotkey reaches overlay**

Start app (`npm start`). Press `Shift+1` (EMF hotkey).

Expected:
- EMF 5 checkbox in web page toggles
- Overlay evidence section shows EMF 5 icon highlighted
- Ghost list in overlay filters accordingly

- [ ] **Step 6: Commit**

```bash
git add scripts-v10/filter-v15.js
git commit -m "feat: add sendFilterResult() to filter(), wire evidence hotkey IPC"
```

---

## Task 8: Update scripts-v10/wslink-v8.js — timer WS integration

**Files:**
- Modify: `scripts-v10/wslink-v8.js`

**Interfaces:**
- Consumes: `window.electronAPI.toggleTimer(id)` — forward WS timer actions to main
- Consumes: `window.electronAPI.onWsBroadcastTimer(cb)` — relay main timer hotkey to WS room

- [ ] **Step 1: Update TIMER action handler**

Find `if (action == "TIMER")` (around line 246). Replace the entire block:

```js
if (action == "TIMER") {
  if (window.electronAPI) window.electronAPI.toggleTimer('smudge');
}
```

- [ ] **Step 2: Update COOLDOWNTIMER handler**

Find `if (action == "COOLDOWNTIMER")`. Replace:

```js
if (action == "COOLDOWNTIMER") {
  if (window.electronAPI) window.electronAPI.toggleTimer('cooldown');
}
```

- [ ] **Step 3: Update HUNTTIMER handler**

Find `if (action == "HUNTTIMER")`. Replace:

```js
if (action == "HUNTTIMER") {
  if (window.electronAPI) window.electronAPI.toggleTimer('hunt');
}
```

- [ ] **Step 4: Delete the SOUNDTIMER handler entirely**

Delete the `if (action == "SOUNDTIMER") { ... }` block.

- [ ] **Step 5: Register onWsBroadcastTimer at the bottom of wslink-v8.js**

Add after the existing no-op function stubs (after line 706):

```js
// ── Relay timer toggle from main process hotkey to WS room ─────────────────
if (window.electronAPI) {
  const TIMER_WS_ACTIONS = { smudge: 'TIMER', cooldown: 'COOLDOWNTIMER', hunt: 'HUNTTIMER' };
  window.electronAPI.onWsBroadcastTimer(({ id }) => {
    if (hasLink && ws && TIMER_WS_ACTIONS[id]) {
      ws.send(JSON.stringify({ action: TIMER_WS_ACTIONS[id] }));
    }
  });
}
```

- [ ] **Step 6: Delete obsolete send_*_link functions**

Delete these functions (the overlay now gets state directly from main.js, not via web page IPC):

- `send_timer_link()` — lines 649–658
- `send_sanity_link()` — lines 661–665
- `send_ghost_link()` — lines 667–671
- `send_evidence_link()` — lines 673–677
- `send_ghosts_link()` — lines 679–691

- [ ] **Step 7: Commit**

```bash
git add scripts-v10/wslink-v8.js
git commit -m "feat: update wslink timer WS handlers to IPC, remove obsolete send_*_link functions"
```

---

## Task 9: Stub out scripts-v10/timer-v4.js

**Files:**
- Modify: `scripts-v10/timer-v4.js`

The functions `toggle_timer`, `toggle_cooldown_timer`, `toggle_hunt_timer` must remain as globals (called by UI buttons in index.html) but delegate to IPC. All Web Worker timer logic and bare-key DOM handlers are removed.

- [ ] **Step 1: Delete document.body.onkeyup and document.body.onkeydown handlers**

Delete the entire `document.body.onkeyup = function(e) { ... }` block (lines 3–72).
Delete the entire `document.body.onkeydown = function(e) { ... }` block (lines 74–86).

These bare-letter hotkeys (t, c, h, q, r, m, g) are now handled by Electron global shortcuts.

- [ ] **Step 2: Delete Web Worker variable declarations**

Delete:
```js
var smudge_worker;
var cooldown_worker;
var hunt_worker;
var sound_worker;
var obambo_worker;
```

- [ ] **Step 3: Replace toggle_timer() body**

Find `function toggle_timer(force_start = false, force_stop = false)` at line 142. Replace the entire function body (keep the signature):

```js
function toggle_timer(force_start = false, force_stop = false) {
  // Timer state is now owned by Electron main process.
  // WS force_start/force_stop are handled in wslink-v8.js before calling here.
  // Direct UI button press: send IPC to main.
  if (!force_start && !force_stop && window.electronAPI) {
    window.electronAPI.toggleTimer('smudge');
  }
}
```

- [ ] **Step 4: Replace toggle_cooldown_timer() body**

```js
function toggle_cooldown_timer(force_start = false, force_stop = false) {
  if (!force_start && !force_stop && window.electronAPI) {
    window.electronAPI.toggleTimer('cooldown');
  }
}
```

- [ ] **Step 5: Replace toggle_hunt_timer() body**

```js
function toggle_hunt_timer(force_start = false, force_stop = false) {
  if (!force_start && !force_stop && window.electronAPI) {
    window.electronAPI.toggleTimer('hunt');
  }
}
```

- [ ] **Step 6: Manual test — timer button in web page triggers overlay**

Start app. Click the Smudge timer button directly in the web page UI.

Expected: Overlay shows countdown starting in the timer panel. No JS errors in DevTools.

- [ ] **Step 7: Commit**

```bash
git add scripts-v10/timer-v4.js
git commit -m "feat: stub timer-v4.js toggle functions to IPC, remove Web Worker and bare-key handlers"
```

---

## Task 10: Update electron/shortcuts-window.html — LABELS map and eventToAccel fix

**Files:**
- Modify: `electron/shortcuts-window.html`

The current `LABELS` map (line 171–181) has old keys. The `eventToAccel` function (line 209–210) rejects bare Shift+ keys, which blocks registering `Shift+1` through `Shift+7`.

**Interfaces:**
- Consumes: `window.electronAPI.getShortcuts()` — must receive all new DEFAULTS keys
- Consumes: `window.electronAPI.setShortcut(fn, accel)`

- [ ] **Step 1: Replace the LABELS object (lines 171–181)**

```js
const LABELS = {
  toggle_timer:          'Smudge Timer',
  toggle_cooldown_timer: 'Cooldown Timer',
  toggle_hunt_timer:     'Hunt Timer',
  toggle_evidence_0:     'Evidence: EMF 5',
  toggle_evidence_1:     'Evidence: Ultraviolet',
  toggle_evidence_2:     'Evidence: Writing',
  toggle_evidence_3:     'Evidence: Ghost Orbs',
  toggle_evidence_4:     'Evidence: Spirit Box',
  toggle_evidence_5:     'Evidence: Freezing',
  toggle_evidence_6:     'Evidence: DOTS',
  open_maps:             'Show Maps',
  reset_all:             'Reset All',
};
```

- [ ] **Step 2: Fix eventToAccel to allow Shift-only combos**

Find line 209–210:
```js
  // Must have at least Ctrl or Alt (to avoid capturing bare letters)
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
```

Replace with:
```js
  // Must have at least one modifier; bare letters (no modifiers) are not allowed
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return null;
  // Shift-only is allowed for Shift+Number evidence hotkeys
```

- [ ] **Step 3: Manual test — open Hotkey Manager and verify**

Press `Ctrl+Shift+K`.

Expected:
- 12 rows visible: 3 timers + 7 evidence + Maps + Reset All
- All show their current bound key
- Click Edit on "Evidence: EMF 5", press `Shift+2` → accepted and saved (not rejected)
- Click Edit on "Smudge Timer", press `1` → still rejected (bare letter without any modifier is still blocked)

- [ ] **Step 4: Commit**

```bash
git add electron/shortcuts-window.html
git commit -m "feat: update Hotkey Manager labels for new shortcuts, allow Shift-only bindings"
```

---

## Task 11: Server deployment — Dockerfile and docker-compose.yml

**Files:**
- Create: `server/Dockerfile`
- Create: `server/docker-compose.yml`

**Interfaces:**
- Produces: Docker image running `server.js` on port 3000
- Produces: Compose service attached to external `edge` network, with `phasmo_data` volume for `server/data/`

- [ ] **Step 1: Check server/package.json**

```bash
cat D:/GitHub/Cheatsheet/server/package.json
```

Note the Node version requirement and confirm there is no `build` step needed (it's plain JS).

- [ ] **Step 2: Create server/Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Create server/docker-compose.yml**

```yaml
services:
  phasmo-server:
    build:
      context: ..
      dockerfile: server/Dockerfile
    restart: unless-stopped
    expose:
      - "3000"
    volumes:
      - phasmo_data:/app/data
    networks:
      - edge

networks:
  edge:
    external: true
    name: edge

volumes:
  phasmo_data:
```

- [ ] **Step 4: Add Caddyfile entry (documentation only — edit on server host)**

Add a comment block at the top of `server/docker-compose.yml`:

```yaml
# Caddyfile entry (add to your existing Caddyfile):
#
# phasmo.yourdomain.com {
#   reverse_proxy phasmo-server:3000
# }
#
# Caddy handles wss:// WebSocket upgrade automatically.
```

- [ ] **Step 5: Build image locally**

```bash
cd D:/GitHub/Cheatsheet
docker build -f server/Dockerfile -t phasmo-server-test .
```

Expected: Image builds successfully. Final line: `Successfully tagged phasmo-server-test:latest`

- [ ] **Step 6: Smoke test container locally**

```bash
docker run --rm -p 3001:3000 phasmo-server-test
```

Open `http://localhost:3001` in browser. Expected: cheatsheet page loads. Press Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add server/Dockerfile server/docker-compose.yml
git commit -m "feat: add Dockerfile and docker-compose.yml for phasmo server deployment"
```

---

## End-to-End Verification

After all tasks complete, run this full scenario:

- [ ] Start server: `cd D:/GitHub/Cheatsheet/server && node server.js`
- [ ] Start Electron: `cd D:/GitHub/Cheatsheet/electron && npm start`
- [ ] Press `1` → smudge timer starts in overlay (green countdown)
- [ ] Press `1` again → timer stops
- [ ] Press `Shift+1` → EMF 5 highlighted in overlay, ghost list filters
- [ ] Press `Shift+1` again → EMF 5 un-highlighted, ghost list resets
- [ ] Click evidence checkbox in web page → overlay syncs
- [ ] Press `M` → maps panel opens in web page
- [ ] Press `Shift+R` → all timers and evidence reset
- [ ] Open Hotkey Manager (`Ctrl+Shift+K`) → 12 rows shown, rebind a key, verify it works
- [ ] Create a WS room → share ID → second browser tab joins → toggle evidence in one tab → other tab syncs
- [ ] Build Docker image → confirm build succeeds
