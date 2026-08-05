# Bundled Frontend + Thin Relay Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle the frontend (`index.html` + its scripts/styles/images) directly into the Electron app package so the installed app no longer depends on the remote server (`phasmo.mustardhq.dev`) for its own code — only for game-data JSON and the WebSocket sync relay — while fixing the never-shipped orphan-process bug and adding auto-update.

**Architecture:** `electron/main.js` switches its main window from `loadURL(FRONTEND_URL)` to `loadFile(<frontend root>/index.html)`, where `<frontend root>` is the repo root in dev and `process.resourcesPath` in a packaged build (via `electron-builder`'s existing `extraResources` mechanism, extended to cover all directories `index.html` references). The three network calls that must still reach the relay server (`ghosts.json`/`maps`/`weekly.json` fetches in `zn-v5.js`, the `create-room` fetch and room WebSocket in `wslink-v8.js`) switch from relative/same-origin URLs to absolute URLs built from `config.json`'s `serverUrl`, delivered to the renderer via a `--server-url=` `additionalArguments` flag on the main window (read in `preload.js`, which cannot use `fs`/`path` under Electron's sandboxed-preload restriction — `process.argv` is fine). `main.js` also gains a single-instance lock and a `before-quit` handler (defense-in-depth alongside the existing `app.quit()` fix), and `electron-updater` wired to the existing GitHub Releases feed.

**Tech Stack:** Electron 33 (main/preload/contextBridge/ipcMain), plain HTML/CSS/JS frontend (no framework, non-strict-mode scripts relying on cross-file implicit globals — follow that pattern, don't introduce modules), `electron-builder` for packaging, `electron-updater` (new dependency) for auto-update, Node's built-in `console.assert` test style already used by `electron/state.test.js` / `electron/overlay-bounds.test.js` (no test framework — run with plain `node <file>.test.js`).

## Global Constraints

- Push only to the `fork` remote (`ExtremelyPowerfulCapybara/phasmo-cheat-sheet`). Never push to `origin`.
- Preload scripts (`electron/preload*.js`) must not `require('fs')` or `require('path')` — Electron 33's sandboxed preload blocks Node built-ins other than a polyfilled `process`. This is why `--server-url=` is delivered via `additionalArguments`/`process.argv`, not by having `preload.js` read `config.json` itself.
- Writable, machine-local state (shortcuts, overlay settings) stays in `app.getPath('userData')`, never `__dirname` — already correct, do not regress it.
- Every new pure-logic module gets a `console.assert`-based unit test file alongside it, following `electron/overlay-bounds.test.js`'s exact style (no `assert` module, no test runner — just `node file.test.js` printing `All X tests passed` on success).
- Do not rename `config.json`'s `serverUrl` key — only its meaning changes (page-to-load → API base URL). Renaming would silently break any already-deployed `config.json` a friend has edited.
- Commit after every task with a message describing the change; never bundle unrelated changes into one commit.

---

### Task 1: Add `buildApiUrl`/`buildWsUrl` pure helpers + unit tests

**Files:**
- Create: `electron/api-url.js`
- Test: `electron/api-url.test.js`

**Interfaces:**
- Produces: `buildApiUrl(path, serverUrl)` — `(string, string|falsy) => string`. `serverUrl` falsy → returns `path` unchanged (browser-fallback / same-origin mode). `serverUrl` set → returns `serverUrl` (trailing slashes stripped) + `path`.
- Produces: `buildWsUrl(path, serverUrl, fallbackOrigin)` — `(string, string|falsy, string|falsy) => string`. Prefers `serverUrl`; falls back to `fallbackOrigin` if `serverUrl` is falsy; throws if both are falsy. Converts the chosen base's `http`/`https` scheme to `ws`/`wss`, strips trailing slashes, and appends `path`.
- Later tasks (Task 4, Task 5) call these from renderer-side scripts (`zn-v5.js`, `wslink-v8.js`) after loading `electron/api-url.js` — see Task 4/5 for how it's exposed to those non-module scripts.

- [ ] **Step 1: Write the failing test**

Create `electron/api-url.test.js`:

```js
'use strict';
const { buildApiUrl, buildWsUrl } = require('./api-url.js');

// buildApiUrl — no serverUrl (browser fallback / same-origin mode)
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', '') === '/phasmophobia/data/ghosts.json',
  'FAIL: falsy serverUrl should return path unchanged');
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', null) === '/phasmophobia/data/ghosts.json',
  'FAIL: null serverUrl should return path unchanged');
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', undefined) === '/phasmophobia/data/ghosts.json',
  'FAIL: undefined serverUrl should return path unchanged');

// buildApiUrl — serverUrl set (bundled app mode)
console.assert(
  buildApiUrl('/phasmophobia/data/ghosts.json', 'https://phasmo.mustardhq.dev') === 'https://phasmo.mustardhq.dev/phasmophobia/data/ghosts.json',
  'FAIL: should join serverUrl and path'
);
console.assert(
  buildApiUrl('/create-room', 'https://phasmo.mustardhq.dev/') === 'https://phasmo.mustardhq.dev/create-room',
  'FAIL: should strip a trailing slash from serverUrl before joining'
);
console.assert(
  buildApiUrl('/phasmophobia/data/maps', 'http://localhost:3000') === 'http://localhost:3000/phasmophobia/data/maps',
  'FAIL: should work with http (dev server) as well as https'
);

// buildWsUrl — serverUrl set, https -> wss
console.assert(
  buildWsUrl('/room/abc123', 'https://phasmo.mustardhq.dev', null) === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: https serverUrl should become wss'
);
// buildWsUrl — serverUrl set, http -> ws
console.assert(
  buildWsUrl('/room/abc123', 'http://localhost:3000', null) === 'ws://localhost:3000/room/abc123',
  'FAIL: http serverUrl should become ws'
);
// buildWsUrl — serverUrl set with trailing slash
console.assert(
  buildWsUrl('/room/abc123', 'https://phasmo.mustardhq.dev/', null) === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: should strip trailing slash before joining'
);
// buildWsUrl — no serverUrl, falls back to fallbackOrigin (browser fallback mode)
console.assert(
  buildWsUrl('/room/abc123', '', 'https://phasmo.mustardhq.dev') === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: falsy serverUrl should fall back to fallbackOrigin'
);
console.assert(
  buildWsUrl('/room/abc123', null, 'http://localhost:3000') === 'ws://localhost:3000/room/abc123',
  'FAIL: falsy serverUrl should fall back to fallbackOrigin (http)'
);
// buildWsUrl — neither provided
let threw = false;
try { buildWsUrl('/room/abc123', '', ''); } catch (e) { threw = true; }
console.assert(threw, 'FAIL: should throw when neither serverUrl nor fallbackOrigin is provided');

console.log('All api-url.js tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node electron/api-url.test.js`
Expected: `Error: Cannot find module './api-url.js'`

- [ ] **Step 3: Write minimal implementation**

Create `electron/api-url.js`:

```js
'use strict';

function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, '');
}

// path stays same-origin-relative when no serverUrl is configured — this is
// the browser-fallback case, where the page is served by the same host it
// needs to call. When serverUrl is set (the bundled Electron app, loaded via
// file://, has no meaningful "same origin" for these calls), it's joined in.
function buildApiUrl(path, serverUrl) {
  if (!serverUrl) return path;
  return stripTrailingSlashes(serverUrl) + path;
}

// Same idea for WebSocket URLs, but there's no "relative ws:" concept, so the
// caller must supply a fallbackOrigin (window.location's protocol+host) for
// the no-serverUrl case instead of leaving the URL relative.
function buildWsUrl(path, serverUrl, fallbackOrigin) {
  const base = serverUrl || fallbackOrigin;
  if (!base) throw new Error('buildWsUrl: no serverUrl or fallbackOrigin available');
  const wsBase = base.replace(/^http/, 'ws');
  return stripTrailingSlashes(wsBase) + path;
}

module.exports = { buildApiUrl, buildWsUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node electron/api-url.test.js`
Expected: `All api-url.js tests passed` printed, no assertion failures in output.

- [ ] **Step 5: Commit**

```bash
git add electron/api-url.js electron/api-url.test.js
git commit -m "feat: add pure URL-building helpers for bundled-frontend API/WS calls"
```

---

### Task 2: Expose `serverUrl` to the renderer via `preload.js`

**Files:**
- Modify: `electron/preload.js` (full current content shown below, 21 lines)

**Interfaces:**
- Consumes: nothing new — reads `process.argv`, which is available in a sandboxed preload script (unlike `fs`/`path`).
- Produces: `window.electronAPI.serverUrl` — a `string` (empty string if the app was somehow launched without the flag), consumed by Task 4 (`zn-v5.js`) and Task 5 (`wslink-v8.js`).

- [ ] **Step 1: Modify `preload.js` to parse and expose `--server-url=`**

Current `electron/preload.js`:

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

Replace it with:

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// additionalArguments (set on the BrowserWindow in main.js) land in
// process.argv here. This — not requiring config.json directly — is how the
// preload learns the API/WS base URL, because sandboxed preloads can't
// require('fs')/require('path') (see electron/state.js comment history).
function getServerUrlFromArgv() {
  const arg = process.argv.find((a) => a.startsWith('--server-url='));
  return arg ? arg.slice('--server-url='.length) : '';
}

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

  // Bundled-frontend API/WS base URL (see electron/api-url.js consumers)
  serverUrl: getServerUrlFromArgv(),
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check electron/preload.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose serverUrl on window.electronAPI via preload additionalArguments"
```

(This task has no standalone runtime test — `window.electronAPI.serverUrl` can't be exercised outside a running BrowserWindow. It's verified end-to-end in Task 3's manual step and Task 9's packaging smoke test.)

---

### Task 3: Switch main window from `loadURL` to `loadFile`, pass `--server-url=`

**Files:**
- Modify: `electron/main.js:1-25` (imports, config loading), `electron/main.js:106-150` (`createMainWindow`)

**Interfaces:**
- Consumes: `config.serverUrl` (already loaded at `electron/main.js:24`, unchanged), `app.isPackaged` (Electron built-in).
- Produces: `resolveFrontendRoot()` — `() => string`, used only within `main.js`.

- [ ] **Step 1: Add `dialog` to the Electron import and add `resolveFrontendRoot()`**

In `electron/main.js`, change line 1:

```js
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
```

to:

```js
const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog } = require('electron');
```

Then, directly below the existing config-loading block (after line 25, `const FRONTEND_URL = config.serverUrl;`), add:

```js
// In dev, the frontend (index.html, scripts-v10/, etc.) lives at the repo
// root, one level above electron/. In a packaged build it's copied into
// resources/ via electron-builder's extraResources (see Task 6) — the same
// mechanism already used for imgs/assets/lang-v10 since the 2026-08-03
// packaged-persistence fix. This keeps "where do bundled files live" in one
// place instead of scattering __dirname/resourcesPath checks around.
function resolveFrontendRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}
```

- [ ] **Step 2: Replace the `loadURL` block in `createMainWindow()`**

Current (`electron/main.js:106-150`):

```js
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 900,
    title:  'Phasmo Cheat Sheet',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Give the Node server ~1.5 s to start
  setTimeout(() => {
    mainWindow.loadURL(FRONTEND_URL).catch(() => {
      setTimeout(() => mainWindow.loadURL(FRONTEND_URL).catch(console.error), 1000);
    });
  }, 1500);

  mainWindow.webContents.on('console-message', (_, level, msg, line, sourceId) => {
    console.log('[main-console]', msg, `(${sourceId}:${line})`);
  });
```

Replace the `BrowserWindow` construction and the `setTimeout`/`loadURL` block with:

```js
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 900,
    title:  'Phasmo Cheat Sheet',
    webPreferences: {
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,
      nodeIntegration:    false,
      additionalArguments: [`--server-url=${config.serverUrl}`],
    },
  });

  const indexPath = path.join(resolveFrontendRoot(), 'index.html');
  mainWindow.loadFile(indexPath).catch((err) => {
    // Bundled files missing/corrupted is a real failure mode for a packaged
    // install (see design doc "Error Handling") — show it instead of leaving
    // a blank window with no clue why, which was the old loadURL failure mode.
    dialog.showErrorBox(
      'Phasmo Cheat Sheet — failed to load',
      `Could not load the app UI from:\n${indexPath}\n\n${err.message}`
    );
  });

  mainWindow.webContents.on('console-message', (_, level, msg, line, sourceId) => {
    console.log('[main-console]', msg, `(${sourceId}:${line})`);
  });
```

Leave the rest of `createMainWindow()` (the `did-finish-load` handler and the `closed` handler) unchanged.

- [ ] **Step 3: Remove the now-unused `FRONTEND_URL` constant**

`FRONTEND_URL` (`electron/main.js:25`) was only used by the `loadURL` calls just removed. Delete the line:

```js
const FRONTEND_URL = config.serverUrl;
```

(`config.serverUrl` is still used directly in the new `additionalArguments` line from Step 2 — no other reference to `FRONTEND_URL` remains; confirm with `grep -n FRONTEND_URL electron/main.js` returning nothing.)

- [ ] **Step 4: Verify syntax**

Run: `node --check electron/main.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manual smoke test (dev mode)**

This can't be unit tested — it requires a running window. Run:
```
cd D:\GitHub\Cheatsheet\server && node server.js
```
in one terminal, and in another:
```
cd D:\GitHub\Cheatsheet\electron && npm start
```
Expected: main window opens showing the cheat sheet UI (same as before this change). Open DevTools (if enabled) or check the terminal's `[main-console]` logs for `electronAPI in main window: api_defined` (already logged by the existing `did-finish-load` handler at `electron/main.js:129-134`) — confirms the preload ran successfully under `loadFile`.

- [ ] **Step 6: Commit**

```bash
git add electron/main.js
git commit -m "feat: load main window from bundled index.html instead of remote server"
```

---

### Task 4: Point `zn-v5.js`'s game-data fetches at `buildApiUrl`

**Files:**
- Modify: `scripts-v10/zn-v5.js:66`, `scripts-v10/zn-v5.js:203`, `scripts-v10/zn-v5.js:238`
- Modify: `index.html` (add a `<script>` tag so `buildApiUrl` is available as a plain global before `zn-v5.js` runs)

**Interfaces:**
- Consumes: `buildApiUrl(path, serverUrl)` from Task 1 (`electron/api-url.js`), loaded in the browser as a plain script — `module.exports` is ignored by a `<script src>` load, but the function declarations still become globals, matching how every other script in this codebase works (no bundler, no modules).
- Consumes: `window.electronAPI.serverUrl` from Task 2 (undefined when running via the browser fallback, since `window.electronAPI` itself won't exist there).

- [ ] **Step 1: Add `electron/api-url.js` as a loaded script in `index.html`**

In `index.html`, find the script tag block ending at line 833 (`<script src="scripts-v10/utils-v2.js"></script>`), and add a new line immediately before it:

```html
<script src="scripts-v10/api-url.js"></script>
<script src="scripts-v10/utils-v2.js"></script>
```

Note: this references `scripts-v10/api-url.js`, not `electron/api-url.js` — the frontend's own script folder is `scripts-v10/`, and `electron/` is not on its bundled path. Copy the file there instead of referencing it in place:

```bash
cp electron/api-url.js scripts-v10/api-url.js
```

`electron/api-url.js`'s `module.exports = { buildApiUrl, buildWsUrl };` line is harmless when loaded as a plain `<script>` (no `module` global exists in that context, but the line only runs if reached — actually it always runs and `module` is undefined in a browser, which throws). Fix this by guarding the export:

In `scripts-v10/api-url.js` (the copy), change the last line from:

```js
module.exports = { buildApiUrl, buildWsUrl };
```

to:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildApiUrl, buildWsUrl };
}
```

This keeps `electron/api-url.js` (required by Node in `electron/api-url.test.js`) and `scripts-v10/api-url.js` (loaded as a browser `<script>`) as the same file content — apply this same guard to `electron/api-url.js` too, so there's exactly one implementation to keep in sync, copied verbatim between the two locations.

- [ ] **Step 2: Update `electron/api-url.js` with the same guard, re-run its test**

Apply the identical last-line change to `electron/api-url.js` from Step 1.

Run: `node electron/api-url.test.js`
Expected: `All api-url.js tests passed` (unchanged behavior under Node, since `module` is defined there and the guard's condition is true).

- [ ] **Step 3: Update the three fetch calls in `scripts-v10/zn-v5.js`**

Line 66, change:
```js
fetch(`/phasmophobia/data/ghosts.json`, {cache: 'default', signal: AbortSignal.timeout(10000)})
```
to:
```js
fetch(buildApiUrl(`/phasmophobia/data/ghosts.json`, window.electronAPI && window.electronAPI.serverUrl), {cache: 'default', signal: AbortSignal.timeout(10000)})
```

Line 203, change:
```js
fetch("/phasmophobia/data/maps", {cache: 'default', signal: AbortSignal.timeout(12000)})
```
to:
```js
fetch(buildApiUrl("/phasmophobia/data/maps", window.electronAPI && window.electronAPI.serverUrl), {cache: 'default', signal: AbortSignal.timeout(12000)})
```

Line 238, change:
```js
fetch("/phasmophobia/data/weekly.json", {cache: 'default', signal: AbortSignal.timeout(10000)})
```
to:
```js
fetch(buildApiUrl("/phasmophobia/data/weekly.json", window.electronAPI && window.electronAPI.serverUrl), {cache: 'default', signal: AbortSignal.timeout(10000)})
```

- [ ] **Step 4: Verify syntax**

Run: `node --check scripts-v10/zn-v5.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manual smoke test**

With the server running (`cd server && node server.js`) and the app launched (`cd electron && npm start`), confirm the ghost cards, maps list, and weekly challenge banner all load exactly as before (they call the relay server the same way — `window.electronAPI.serverUrl` is `https://phasmo.mustardhq.dev` per `electron/config.json`, or whatever `serverUrl` is set to; if pointed at the local dev server instead for this test, temporarily set `electron/config.json`'s `serverUrl` to `http://localhost:3000` and confirm data still loads). Check the terminal running `server.js` for `GET /phasmophobia/data/ghosts.json` style request logs (add one temporarily if the server doesn't already log requests) to confirm the request actually reached the server rather than silently failing.

- [ ] **Step 6: Commit**

```bash
git add index.html scripts-v10/api-url.js electron/api-url.js scripts-v10/zn-v5.js
git commit -m "feat: build game-data fetch URLs from configured serverUrl instead of relative paths"
```

---

### Task 5: Point `wslink-v8.js`'s WebSocket + `create-room` fetch at `buildWsUrl`/`buildApiUrl`

**Files:**
- Modify: `scripts-v10/wslink-v8.js:168` (`create_room`'s fetch), `scripts-v10/wslink-v8.js:195-196` (`link_room`'s WebSocket construction)

**Interfaces:**
- Consumes: `buildApiUrl`, `buildWsUrl` (globals from `scripts-v10/api-url.js`, loaded before `wslink-v8.js` per `index.html`'s existing script order — confirm `scripts-v10/api-url.js`'s `<script>` tag from Task 4 Step 1 appears before `scripts-v10/wslink-v8.js`'s at `index.html:843`; it does, since it was inserted before `utils-v2.js` at line 833, well ahead of 843).
- Consumes: `window.electronAPI.serverUrl` (Task 2).

- [ ] **Step 1: Update `create_room()`'s fetch call**

`scripts-v10/wslink-v8.js:168`, change:
```js
fetch(`/create-room`,{method:"POST",Accept:"application/json",body:JSON.stringify(outgoing_state),signal: AbortSignal.timeout(6000)})
```
to:
```js
fetch(buildApiUrl(`/create-room`, window.electronAPI && window.electronAPI.serverUrl),{method:"POST",Accept:"application/json",body:JSON.stringify(outgoing_state),signal: AbortSignal.timeout(6000)})
```

- [ ] **Step 2: Update `link_room()`'s WebSocket construction**

`scripts-v10/wslink-v8.js:193-196`, current:
```js
var room_id = document.getElementById("room_id").value
var load_pos = getCookie("link-position")
var proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
ws = new WebSocket(`${proto}://${window.location.host}/room/${room_id}${load_pos ? '?pos='+load_pos : ''}`);
```

Replace with:
```js
var room_id = document.getElementById("room_id").value
var load_pos = getCookie("link-position")
var roomPath = `/room/${room_id}${load_pos ? '?pos='+load_pos : ''}`
var fallbackOrigin = `${window.location.protocol}//${window.location.host}`
ws = new WebSocket(buildWsUrl(roomPath, window.electronAPI && window.electronAPI.serverUrl, fallbackOrigin));
```

This removes the now-unused `proto` variable naturally (it's no longer referenced) — confirm with `grep -n 'proto' scripts-v10/wslink-v8.js` that the only remaining match, if any, is unrelated (there is none; `proto` was local to this function).

- [ ] **Step 3: Verify syntax**

Run: `node --check scripts-v10/wslink-v8.js`
Expected: no output (exit code 0).

- [ ] **Step 4: Manual smoke test**

With the server and app running (same setup as Task 4 Step 5), click "Create Room" in the journal-link UI, confirm a room ID appears and the status shows Connected (same behavior as before — this is the fix from commit `c6a0b7c` still applying, just reached via a URL built by `buildWsUrl` instead of a relative one). Then in a second browser tab pointed at `http://localhost:3000` (or a second app instance if single-instance lock hasn't landed yet — it hasn't, this task precedes Task 7), join the same room ID and confirm evidence/timer state syncs between the two. This is a lighter version of Task 9's full two-client test — it only needs to prove the WS URL construction didn't break connectivity, not exercise reconnect/network-drop behavior.

- [ ] **Step 5: Commit**

```bash
git add scripts-v10/wslink-v8.js
git commit -m "feat: build WebSocket room URL and create-room fetch from configured serverUrl"
```

---

### Task 6: Bundle repo-root frontend files into packaged builds

**Files:**
- Modify: `electron/package.json:21-29` (`build.files` / `build.extraResources`)

**Interfaces:**
- Consumes: `resolveFrontendRoot()` from Task 3 (`electron/main.js`), which expects `process.resourcesPath` (packaged) or `path.join(__dirname, '..')` (dev) to contain `index.html` plus every directory it references.

- [ ] **Step 1: Identify the full set of repo-root paths `index.html` needs**

Already confirmed by reading `index.html`'s `<script src>`/`<link href>` tags (relative, non-`http`, ones only): `copyShare.js`, `jquery/`, `scripts-v10/`, `styles-v10/`, `themes-v10/`, `login-v10/`, `wiki-v10/`, `models-v10/`, `partners-v10/`, `feed-v10/`, plus `imgs/`, `assets/`, `lang-v10/` (already bundled since the 2026-08-03 packaging fix) and `index.html` itself (not yet bundled — the packaged app currently doesn't need it since it still loads the page remotely; this task is what starts requiring it).

- [ ] **Step 2: Extend `build.extraResources` in `electron/package.json`**

Current (`electron/package.json:21-29`):
```json
    "files": [
      "**/*",
      "!node_modules/.cache"
    ],
    "extraResources": [
      { "from": "../imgs", "to": "imgs" },
      { "from": "../assets", "to": "assets" },
      { "from": "../lang-v10", "to": "lang-v10" }
    ]
```

Replace with:
```json
    "files": [
      "**/*",
      "!node_modules/.cache"
    ],
    "extraResources": [
      { "from": "../index.html",   "to": "index.html" },
      { "from": "../copyShare.js", "to": "copyShare.js" },
      { "from": "../jquery",       "to": "jquery" },
      { "from": "../scripts-v10",  "to": "scripts-v10" },
      { "from": "../styles-v10",   "to": "styles-v10" },
      { "from": "../themes-v10",   "to": "themes-v10" },
      { "from": "../login-v10",    "to": "login-v10" },
      { "from": "../wiki-v10",     "to": "wiki-v10" },
      { "from": "../models-v10",   "to": "models-v10" },
      { "from": "../partners-v10", "to": "partners-v10" },
      { "from": "../feed-v10",     "to": "feed-v10" },
      { "from": "../imgs",         "to": "imgs" },
      { "from": "../assets",       "to": "assets" },
      { "from": "../lang-v10",     "to": "lang-v10" }
    ]
```

- [ ] **Step 2: Verify `package.json` is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('electron/package.json','utf8')); console.log('valid')"`
Expected: `valid` printed.

- [ ] **Step 3: Commit**

```bash
git add electron/package.json
git commit -m "build: bundle repo-root frontend directories as extraResources for packaged builds"
```

(Full verification that this is complete — i.e. that no directory was missed — happens in Task 9's packaging smoke test, which runs the packaged `.exe` with the relay server stopped and would surface any missing directory as a broken image/404 in the loaded page.)

---

### Task 7: Single-instance lock + `before-quit` teardown

**Files:**
- Modify: `electron/main.js:344-376` (the `app.whenReady()`/lifecycle block at the end of the file)

**Interfaces:**
- Consumes: `mainWindow`, `overlay`, `shortcutsWindow`, `overlaySettingsWindow` (all existing module-level `let` variables in `main.js`).

- [ ] **Step 1: Wrap the existing `app.whenReady()` lifecycle in a single-instance-lock guard**

Current (`electron/main.js:344-376`):
```js
// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  overlaySettings = overlaySettingsStore.load(OVERLAY_SETTINGS_PATH);

  createMainWindow();
  createOverlay();

  buildHandlers();

  state.setBroadcast((channel, data) => {
    console.log('[broadcast]', channel, JSON.stringify(data).slice(0, 80));
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, data);
    } else {
      console.warn('[broadcast] overlay not ready or destroyed');
    }
  });

  applyShortcuts(loadShortcuts());
  globalShortcut.register('Control+Shift+K', openHotkeyManager);
  globalShortcut.register('Control+Shift+O', openOverlaySettingsWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

Replace with:
```js
// ── Lifecycle ─────────────────────────────────────────────────────────────────

// A second launch (e.g. a friend double-clicking the installed .exe again
// while it's already running) would otherwise start a second full process
// tree — its own main window, overlay, and global hotkey registrations
// competing with the first instance's. requestSingleInstanceLock() makes the
// second launch quit itself immediately instead; 'second-instance' fires on
// the FIRST instance so it can refocus its own window for the user.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    overlaySettings = overlaySettingsStore.load(OVERLAY_SETTINGS_PATH);

    createMainWindow();
    createOverlay();

    buildHandlers();

    state.setBroadcast((channel, data) => {
      console.log('[broadcast]', channel, JSON.stringify(data).slice(0, 80));
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send(channel, data);
      } else {
        console.warn('[broadcast] overlay not ready or destroyed');
      }
    });

    applyShortcuts(loadShortcuts());
    globalShortcut.register('Control+Shift+K', openHotkeyManager);
    globalShortcut.register('Control+Shift+O', openOverlaySettingsWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  // Defense-in-depth alongside mainWindow's 'closed' handler (which already
  // calls app.quit()): if quit is ever triggered by a path that doesn't go
  // through that handler (e.g. a future Cmd+Q/Alt+F4 handler, or an OS
  // shutdown signal), explicitly destroy every remaining window so none of
  // them — especially the overlay, which has no taskbar icon or way for the
  // user to close it directly — can outlive the main process.
  app.on('before-quit', () => {
    for (const w of [overlay, shortcutsWindow, overlaySettingsWindow]) {
      if (w && !w.isDestroyed()) w.destroy();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check electron/main.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Manual single-instance test**

Run `cd electron && npm start`, wait for the main window to appear, then run `npm start` again in a second terminal from the same directory. Expected: the second `npm start` process exits quickly (check its terminal output/exit code) and the *first* instance's main window comes to focus. Confirm via PowerShell: `Get-Process electron | Measure-Object | Select-Object Count` — should show the same process count as a single launch (not doubled).

- [ ] **Step 4: Manual orphan-process test**

With the app running (overlay auto-created, and optionally open Hotkey Manager with `Ctrl+Shift+K` and Overlay Settings with `Ctrl+Shift+O` too), close the app via the main window's X button. Then run: `Get-Process electron -ErrorAction SilentlyContinue` (dev) or `Get-Process "Phasmo Cheat Sheet" -ErrorAction SilentlyContinue` (packaged). Expected: no output (zero matching processes) — confirms the fix that was previously found to have never shipped (see design doc "Problem" section) is now actually present and working.

- [ ] **Step 5: Commit**

```bash
git add electron/main.js
git commit -m "feat: add single-instance lock and before-quit window teardown"
```

---

### Task 8: Add `electron-updater`, wire an on-launch update check

**Files:**
- Modify: `electron/package.json` (add `electron-updater` dependency, add `build.publish`)
- Modify: `electron/main.js` (add update check call)

**Interfaces:**
- Consumes: `app.whenReady()` block from Task 7 (adds one call inside it).

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd D:\GitHub\Cheatsheet\electron && npm install electron-updater --save
```

Verify `electron/package.json`'s `dependencies` now includes `"electron-updater"` alongside the existing `"ws": "^8.18.0"`.

- [ ] **Step 2: Add a `publish` block to `electron/package.json`'s `build` config**

Add, as a sibling of `extraResources` inside `build`:
```json
    "publish": [
      { "provider": "github", "owner": "ExtremelyPowerfulCapybara", "repo": "phasmo-cheat-sheet" }
    ]
```

This matches the existing GitHub Releases distribution flow (`gh release create vX.Y.Z ...` under the `ExtremelyPowerfulCapybara/phasmo-cheat-sheet` repo, per the project's established release workflow) — `electron-updater` reads this to know which repo's Releases feed to poll.

- [ ] **Step 3: Wire the update check into `main.js`**

Add near the top of `electron/main.js`, alongside the other `require`s:
```js
const { autoUpdater } = require('electron-updater');
```

Inside the `app.whenReady().then(() => { ... })` block added/modified in Task 7, after the `globalShortcut.register('Control+Shift+O', ...)` line and before the `app.on('activate', ...)` line, add:
```js
    // Checks the GitHub Releases feed independently of the relay server —
    // failures (no network, GitHub unreachable) are swallowed so a broken
    // update check never blocks the app from starting normally.
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[autoUpdater] check failed:', err.message);
    });
```

- [ ] **Step 4: Verify syntax**

Run: `node --check electron/main.js`
Expected: no output (exit code 0).

- [ ] **Step 5: Manual auto-update smoke test**

This requires a real released build and can't be simulated locally without publishing — defer execution of this specific check to Task 9's manual verification pass, which covers it as item 5. For now, confirm the app still launches normally with the new `autoUpdater` call present: `cd electron && npm start`, expect the main window to load as before, and check the terminal for either silence (dev builds aren't code-signed/published, so `electron-updater` commonly logs `dev-app-update.yml` not found in dev — that's expected and non-fatal) or a `[autoUpdater] check failed:` warning, neither of which should stop the window from opening.

- [ ] **Step 6: Commit**

```bash
git add electron/package.json electron/package-lock.json electron/main.js
git commit -m "feat: add electron-updater and check GitHub Releases on launch"
```

---

### Task 9: Manual verification pass + docs update

No new code in this task — it executes the design doc's full Testing section end-to-end against a real packaged build, since several of these checks (packaging smoke test with the server stopped, two-client live sync, auto-update) can only be verified on real hardware, and records the results in `docs/PROGRESS.md` for future sessions (per this project's established pattern of tracking what's actually been verified vs. merely coded).

**Files:**
- Modify: `docs/PROGRESS.md` (append a new dated section)

- [ ] **Step 1: Build the installer**

```bash
cd D:\GitHub\Cheatsheet\electron && npm run dist
```
Expected: `dist\Phasmo Cheat Sheet Setup 1.0.0.exe` produced without errors.

- [ ] **Step 2: Packaging smoke test — install fresh, stop the relay server, launch**

```powershell
Start-Process -FilePath "dist\Phasmo Cheat Sheet Setup 1.0.0.exe" -ArgumentList "/S" -Wait
```
Then make sure `server/server.js` is NOT running (stop it if it is), launch the installed app from `%LOCALAPPDATA%\Programs\Phasmo Cheat Sheet\`, and confirm: the main window UI loads fully (proves bundled `index.html`+assets work without the server), the overlay/hotkeys/timers all work (Ctrl+1/2/3, Shift+1-7, Ctrl+M, Ctrl+Shift+X — see the default-hotkey table in project memory), and ghost/map data shows a load failure in the UI rather than a blank crash (the existing `zn-v5.js` error path, now reached because the relay server really is unreachable).

- [ ] **Step 3: Single-instance + orphan-process test against the packaged build**

Repeat Task 7 Steps 3-4 against the *installed* `.exe` (process name `Phasmo Cheat Sheet.exe`) instead of dev-mode `electron.exe`, since this is the build that matters for distribution.

- [ ] **Step 4: Two-client live sync test with a network interruption**

With the relay server running again (`cd server && node server.js`), open two instances of the app (or one app instance + a browser tab at `http://localhost:3000` as the second client), link them to the same room via "Create Room"/entering the room ID, then briefly stop `server.js` (Ctrl+C) for 5-10 seconds and restart it. Confirm: the client(s) show a "Reconnecting..." status during the outage (per the `{{reconnecting}}` string and reconnect logic already shipped in commit `c6a0b7c`), and state resyncs once the server comes back — toggle a piece of evidence on one client after reconnecting and confirm it appears on the other. This is the test explicitly flagged as owed since the prior session and still not completed as of this plan being written — this is where it finally gets done.

- [ ] **Step 5: Auto-update smoke test**

Bump `electron/package.json`'s `version` down temporarily is not viable (can't have a lower real release) — instead: with the current build installed, cut a new patch release following the project's existing release workflow (bump version, `npm run dist`, `git tag`, `gh release create`), then relaunch the already-installed (older) app and confirm the terminal/log shows `electron-updater` detecting and downloading the new version (electron-updater logs to `%APPDATA%\phasmo-cheat-sheet\logs\` by default, or console if run from a terminal).

- [ ] **Step 6: Record results in `docs/PROGRESS.md`**

Append a new section to `docs/PROGRESS.md` (following the existing dated-session format used throughout the file) summarizing: which of Steps 2-5 passed, any issues found and how they were fixed, and a pointer back to `docs/superpowers/specs/2026-08-05-bundled-frontend-design.md` and this plan file.

- [ ] **Step 7: Commit**

```bash
git add docs/PROGRESS.md
git commit -m "docs: record bundled-frontend verification results"
```

- [ ] **Step 8: Push everything to `fork`**

```bash
git push fork main
```

(All commits from Tasks 1-9 should be pushed together at this point, having been verified end-to-end by this task's manual pass — don't push earlier tasks individually mid-implementation, since an incompletely-wired intermediate state, e.g. Task 3 merged without Task 4/5, would leave the deployed app unable to reach the relay server at all.)
