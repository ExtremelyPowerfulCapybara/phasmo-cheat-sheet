# Bundled Frontend + Thin Relay Server — Design

## Problem

Two production bugs this week traced back to the same root cause: the Electron app's main window
loads its entire frontend (`index.html`, `scripts-v10/*.js`, etc.) at runtime from the remote shared
server (`https://phasmo.mustardhq.dev`, via `electron/config.json`'s `serverUrl`). This couples the
installed app's behavior to whatever happens to be deployed on that server at the moment it's
launched:

1. **Stale-cache bug** (2026-08-03, part 7) — Chromium's HTTP disk cache served an old cached
   `metronome-v7.js` after a server-side deploy, with no error surfaced.
2. **Journal-sync fix silently unshipped** (2026-08-05) — a WebSocket reconnect fix was committed
   locally but never deployed to the shared server; the installed app kept running the old,
   already-broken `wslink-v8.js` with no way to tell the difference between "fix doesn't work" and
   "fix was never delivered."

Separately, the app has a history of leftover `electron.exe`/`Phasmo Cheat Sheet.exe` processes after
closing the main window. The `app.quit()` fix for this (commit `c4b39c4`) predates the last shipped
release (tag `v1.0.0`, commit `64f36ab`) — the currently-installed app has never actually run the fix.

Distribution today is also fully manual: friends redownload and reinstall a `.exe` from GitHub
Releases by hand for every fix.

## Goals

- Reliability of peer (journal) sync — a shipped fix should always be running, not silently stuck on
  an old deployed copy.
- Simpler distribution/updates — friends shouldn't need to manually reinstall for every fix.
- Fewer moving parts — remove the "is the client in sync with whatever's on the server" failure class
  entirely for anything that isn't peer sync itself.
- Confirm (with real hardware verification, not just code review) that the app is single-process and
  leaves no orphaned processes after quitting.

## Non-goals

- Peer-to-peer (WebRTC) sync with no relay server dependency at all — considered and explicitly
  rejected (see "Alternatives considered"). Sync continues to require the shared relay server to be
  running.
- Switching the app shell away from Electron (e.g. to Tauri or a Python-based webview) — considered
  and rejected for this project; overlay transparency/click-through and global hotkeys are mature and
  already debugged on Electron. Framework choice doesn't move the needle on any of this project's
  goals. May be revisited later as its own project if installer size becomes a priority.
- Offline caching of game data (ghosts/maps/weekly JSON) — out of scope, flagged as a possible future
  item.

## Architecture

Two independently-deployable pieces, split by what each owns:

- **The Electron app** (installed per-player) — owns the entire UI: frontend HTML/CSS/JS is bundled
  *inside* the app package and loaded via `loadFile`, the same way `overlays/overlay.html` already
  works today. It depends on the relay server for exactly two things: game data JSON and the
  WebSocket room relay for co-op sync. It no longer depends on the server for its own code or assets.
- **The relay server** (`server/server.js`, unchanged shared host + Cloudflare Tunnel infra) — keeps
  its current scope. It continues to serve the static frontend too, as a **browser-only fallback**
  (no overlay/hotkeys) for anyone who wants to use the tool without installing the app — but the
  installed app no longer depends on this path.

This removes the coupling behind both bugs above: the installed app's behavior depends only on what
version of the app is installed, not on what's currently deployed server-side. The server's only
remaining "must stay in sync with the app" surface is the WS message protocol shape and the JSON data
files — much smaller and slower-changing than the whole frontend.

## Components

- **`electron/main.js`** — `createMainWindow()` changes from `mainWindow.loadURL(FRONTEND_URL)` to
  `mainWindow.loadFile(path.join(__dirname, '..', 'index.html'))`, with a `.catch()` that shows a
  visible error dialog instead of a blank window if the bundled file fails to load.
- **`electron/config.json`** — `serverUrl` is repurposed: no longer "page to load," now "API base URL
  for game data + WebSocket room relay."
- **`scripts-v10/zn-v5.js`** — game-data fetch calls (`/phasmophobia/data/ghosts.json`, etc.) change
  from relative paths (which assumed same-origin loading) to absolute URLs built from a `SERVER_URL`
  constant read out of `config.json` at startup.
- **`scripts-v10/wslink-v8.js`** — WebSocket connection URL changes the same way:
  `wss://<SERVER_URL host>/room/<id>` instead of a same-origin relative `ws(s)://` derived from
  `window.location`.
- **`electron/package.json` (electron-builder config)** — `extraResources`/`files` updated so
  `index.html`, `scripts-v10/`, `lang-v10/`, `styles-v10/`, `imgs/`, `assets/` (repo root, one level up
  from `electron/`) are bundled as regular app files rather than expecting them to be fetched
  remotely.
- **`electron-updater`** (new dependency) — checks the GitHub Releases feed
  (`ExtremelyPowerfulCapybara/phasmo-cheat-sheet`) on launch, silently downloads an available update,
  prompts the user to restart to apply it. Runs independently of the relay server's availability.
- **Process lifecycle in `electron/main.js`**:
  - `app.requestSingleInstanceLock()` added near the top — a second launch attempt quits itself
    immediately and focuses/restores the existing window instead of starting a second process tree.
  - A `before-quit` handler is added that explicitly destroys the overlay, Hotkey Manager, and Overlay
    Settings windows if still alive, as a defense-in-depth backstop alongside the existing
    `mainWindow.on('closed') → app.quit()` path.

## Data Flow

- **Game data**: unchanged shape — `zn-v5.js` fetches `ghosts.json`/`maps.json`/`weekly.json` from the
  relay server, just via an absolute URL instead of a relative one.
- **Journal sync**: unchanged protocol — client connects to `wss://<server>/room/<id>`, server relays
  state between room positions 1-4 and caches the latest state for late-joiners, exactly as it does
  today (see `server/server.js`, unchanged by this project). Only the *origin of the client code
  implementing this* changes (bundled with the app, not fetched at runtime).
- **Auto-update check**: on launch, `electron-updater` talks to GitHub's Releases API — not the relay
  server — so it works independently of `phasmo.mustardhq.dev` being reachable.

## Error Handling

- **Relay server unreachable at launch**: game-data fetch fails and surfaces the existing error UI in
  `zn-v5.js` (unchanged behavior); overlay, hotkeys, and timers remain fully functional since they no
  longer depend on the server for anything except sync.
- **WS drop mid-session**: already covered by the reconnect fix shipped in commit `c6a0b7c`
  (capped exponential backoff; distinguishes an intentional `disconnect_room()` call, a server-rejected
  room via close code 1008, and a link that never successfully opened, from a genuine mid-session
  drop worth retrying).
- **Auto-update check/download failure** (no network, GitHub unreachable): fails silently; the app
  continues running its current version and never blocks startup on this check.
- **Bundled frontend fails to load** (corrupted install): `loadFile`'s `.catch()` shows a visible error
  dialog instead of the current behavior of a blank window on remote-load failure.

## Testing

No existing automated test harness covers the Electron app end-to-end (existing unit tests are
limited to pure-function modules: `overlay-bounds.js`, `overlay-settings-store.js`). This project
follows that same pattern — pure logic gets a unit test, everything else is verified manually on real
hardware, consistent with prior sessions' lesson that code review alone is insufficient (see the
stale-cache and unshipped-fix incidents this design exists to fix).

1. **Unit test**: the new relative-path → absolute-`SERVER_URL` URL-building helper, as an isolated
   pure function.
2. **Packaging smoke test**: build the installer, install fresh, stop the relay server entirely,
   launch the app, confirm the UI loads, overlay/hotkeys/timers work. Proves the bundling actually
   removed the runtime dependency on the server for the app's own code.
3. **Single-instance test**: launch the app twice; confirm the second launch quits itself and the
   first instance's window is focused, with only one process tree in `Get-Process`.
4. **Orphan-process test**: open the main window, overlay (automatic), Hotkey Manager, and Overlay
   Settings windows simultaneously; close via the main window's X button; confirm
   `Get-Process electron` / `Get-Process "Phasmo Cheat Sheet"` shows zero processes.
5. **Two-client live sync test**: two installs (or one install + the existing dev/browser client),
   link a room, briefly kill one client's network connection, confirm the "Reconnecting..." status
   appears and state resyncs once the connection returns. This test was owed from the prior session
   and not yet completed — this project's verification step is where it finally happens.
6. **Auto-update smoke test**: with a lower version number installed, cut a new GitHub Release and
   confirm the running app detects, downloads, and prompts to apply it.

## Alternatives Considered

- **Peer-to-peer (WebRTC) sync, no relay server** — removes server dependency for sync entirely, but
  trades the project's actual priorities (reliability, distribution, fewer moving parts) for one that
  wasn't chosen ("less infra to maintain"), and introduces NAT-traversal/STUN-TURN complexity that
  risks new reliability problems for a 2-4 person hobby co-op tool. Rejected.
- **Switch shell to Tauri** — meaningfully smaller installer (OS-provided WebView2 vs. bundled
  Chromium), but requires re-solving already-debugged overlay transparency/click-through and global
  hotkey behavior in a less mature ecosystem, and rewriting `main.js`/`preload.js`/`state.js` in Rust.
  Doesn't address any of this project's three chosen priorities. Rejected for this project; may be
  worth revisiting later as its own scoped project if installer size becomes a stated priority.
- **Switch shell to a Python-based webview (pywebview) or native GUI (PyQt/Kivy)** — pywebview's
  transparent/layered/click-through window support on Windows isn't first-class the way Electron's
  `setIgnoreMouseEvents` is, likely requiring raw `pywin32` window-style hacks to reproduce current
  behavior; global hotkeys need a separate library with its own admin-rights/reliability quirks. A
  native GUI rewrite (PyQt/Kivy) would discard the entire existing HTML/CSS/JS frontend. Rejected.
