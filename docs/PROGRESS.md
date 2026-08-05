# Phasmo Cheatsheet — Development Progress

Running log of what's been done since the Electron rewrite landed, and what's left. See
`docs/superpowers/plans/2026-08-02-electron-rewrite.md` and
`docs/superpowers/specs/2026-08-02-electron-rewrite-design.md` for the original rewrite plan/design this builds on.

## 2026-08-05 session — Bundled frontend + thin relay server

Implemented `docs/superpowers/specs/2026-08-05-bundled-frontend-design.md` /
`docs/superpowers/plans/2026-08-05-bundled-frontend.md` via subagent-driven development (9 tasks + one
ad-hoc fix, each independently reviewed, plus a final whole-branch review — see the plan file's linked
SDD ledger for the full task-by-task record).

### What changed
The Electron app's main window now loads its frontend (`index.html`, `scripts-v10/`, `styles-v10/`, etc.)
from files bundled directly into the app package via `loadFile()`, instead of fetching it at runtime from
the shared relay server (`phasmo.mustardhq.dev`) via `loadURL()`. The app now depends on that server only
for game-data JSON (`ghosts.json`/`maps`/`weekly.json`) and the WebSocket room relay — both reached via
absolute URLs built from `electron/config.json`'s `serverUrl` (repurposed: same key, now means "API base
URL" instead of "page to load") through a new `buildApiUrl`/`buildWsUrl` helper
(`electron/api-url.js` + a synced copy at `scripts-v10/api-url.js` for the browser-loaded side).
`server/server.js` is unchanged — it still serves the static frontend too, as a browser-only fallback for
anyone who doesn't want to install the app.

Also added: a single-instance lock (`app.requestSingleInstanceLock()`) so a second launch just refocuses
the first instance, a `before-quit` handler that destroys the overlay/Hotkey Manager/Overlay Settings
windows as defense-in-depth alongside the existing `closed`-handler `app.quit()` fix, and `electron-updater`
wired to the project's GitHub Releases feed with a non-blocking on-launch check.

### Root-cause note: the "still broken" reports at the start of this session
This project was kicked off because a WebSocket-reconnect fix and an orphan-process fix both appeared to
"still be broken" after supposedly being fixed in an earlier session. Investigation found both were never
actually deployed/shipped — the reconnect fix was committed locally but never pushed to the server the
installed app talks to, and the orphan-process fix predated the last tagged release the user had installed.
**Lesson reinforced this session, twice more:** always verify a fix was actually shipped before concluding
it doesn't work.
- Mid-Task-9 verification, the user reported the exact same two symptoms again ("still leaves orphaned
  processes," "bad gateway with server offline"). Root cause: they'd tested the *old* Aug-3 `v1.0.0`
  installed build (confirmed by extracting its `app.asar` — it still had `loadURL`/no `app.quit()` in the
  `closed` handler), not the newly built installer sitting in the worktree's `dist/` folder. Once
  reinstalled from the correct `.exe`, both issues were gone — no code defect.

### Verified on real hardware (Task 9)
- Packaging smoke test: fresh install, relay server stopped, bundled UI loads correctly (shows the app's
  own in-app data-load error instead of a browser net-error page) — confirms the app no longer depends on
  the relay server for its own code.
- Orphan-process test: closed via the main window's X button, `Get-Process "Phasmo Cheat Sheet"` returned
  nothing — the fix that had never shipped in three prior attempts is now confirmed working.
- Reconnect-after-network-blip test: two browser tabs, one tab's connection dropped via DevTools "Offline"
  (server process left running), status correctly showed "Reconnecting..." and recovered automatically —
  the two-client sync test that had been owed since a prior session is now finally done.
- Auto-update smoke test: deferred (requires cutting a real GitHub release) — not yet performed.

### New bugs found (out of scope for this project, spawned as a follow-up)
While verifying live evidence sync between two freshly-connected clients (not a reconnect scenario — a
brand-new room), found two real, pre-existing bugs in `wslink-v8.js`'s sync logic, unrelated to anything
this session's plan touched:
1. **`map_loaded` deadlock** — `send_state()`'s guard requires `hasLink && state_received && map_loaded`,
   but `map_loaded` is only ever set `true` by *receiving* a peer's synced state — never by any local
   action. Two brand-new clients can never send a first update to each other; it's a mutual deadlock.
2. **Live updates don't render without a reload** — even after manually forcing `map_loaded = true` to get
   past bug 1, a change made in one already-open tab only appeared in the other tab after reloading it
   (the reload picks up the server's cached `room.state`; the already-open tab's live `ws.onmessage`
   handler isn't applying the update).

This is quite possibly the actual root cause of the very first "connected on both ends but doesn't update"
report that started this whole multi-session effort. Flagged as background task `task_dd8f5327` with full
investigation notes (root cause hypotheses, exact file:line references, repro steps) for a dedicated
follow-up session — not fixed here, to keep this project's diff scoped to bundling/packaging/lifecycle.

## 2026-08-05 session (continued) — Journal sync deadlock, fixed

Picked up `task_dd8f5327`. Live-reproduced the sync failure with two real browser tabs against the local
relay server (via the Claude-in-Chrome browser tools) instead of guessing from code alone, per
`superpowers:systematic-debugging`. Found the ACTUAL root cause was one level deeper than either bug listed
above, and that bug 2 above ("live updates don't render without reload") does not exist as an independent
defect — it doesn't reproduce once the real root cause is fixed.

**Real root cause**: `server/server.js`'s WS handshake sent the sentinel as `ws.send('"-"')` — a JSON-quoted
3-character string (`"`, `-`, `"`). The client's check in `wslink-v8.js` (`if(event.data == "-")`) compares
against the bare 1-character string and never matches (confirmed by instrumenting the raw WS frames in a live
tab: `{"data":"\"-\"","len":3,"codes":[34,45,34]}`). Execution fell through to `JSON.parse(event.data)`,
producing the JS string `-`, which then hit the final `else` branch and threw
`TypeError: Cannot read properties of undefined (reading 'num_evidences')` — caught by a try/catch, so
`state_received` was silently never set `true` for a room's first client (no `room.state` exists yet to take
the working object-parsing path instead). This is a bug in the *local* relay server this project wrote to
replace zero-network.net — the client-side `== "-"` check is original code, unchanged since the very first
commit (`9faa382`), so the server was the thing not honoring its own protocol.

Separately, `map_loaded` (bug 1 above) really was also a genuine bug, and both bugs independently deadlock a
brand-new room's first client — fixing only one still leaves it stuck. Fix: `map_loaded` now gets set `true`
once the client's own map data has finished loading (`zn-v5.js`, right after
`Promise.all([loadZN,loadData,loadMaps,loadWeekly,loadLanguages])` resolves), matching the flag's original
2024 intent ("prevent state send before maps have been loaded") instead of only firing on receipt of a peer's
map.

**Fix** (2 lines, `server/server.js:162` + `scripts-v10/zn-v5.js`): send the sentinel unquoted
(`ws.send('-')`), and set `map_loaded = true` on the client's own map-data-ready promise rather than only on
receiving a peer's map.

**Verified live**, no monkey-patching, real UI-equivalent calls: created a brand-new room in tab 1 —
`state_received`/`map_loaded` were both `true` immediately after connecting (previously stuck `false`
forever). Toggling evidence in tab 1 now actually sends over the wire (previously 0 messages sent). Tab 2
joined the same room and received the current state on connect. With both tabs left open (no reload),
toggling a *second* evidence item in tab 1 propagated live to tab 2's state and DOM immediately — confirming
"bug 2" from the investigation above was a downstream symptom of never getting past this deadlock, not a
separate live-render defect.

## 2026-08-02 session

### Fixed regressions from the zero-network.net delinking work
The fork had been progressively cut loose from zero-network.net's remote services (login, analytics, partners,
voice recognition, i18n, BPM-finder, 3D-models gallery). That work left several dangling references that threw
at runtime:
- A `SyntaxError` from duplicate `let`/`var` declarations (`polled`, `hasDLLink`) across `filter-v15.js` and
  `wslink-v8.js` silently broke all of `wslink-v8.js` on every page load.
- `closeAll()`, `draw_graph()`, and the `voice_prefix` checkbox no longer existed but were still called from
  `saveSettings()`/`loadSettings()`/`resetAll()`/the tools-tab toggle, aborting those functions partway through
  and breaking the maps/wiki hotkeys.
- Orphaned dead UI (voice enable/disable buttons, the 3D-models tab whose `load_models()` was silently shadowed
  by an unrelated stub) was removed outright.

### Evidence overlay — tristate visuals
`sendFilterResult()` now sends `1`/`-1`/`0` (good/bad/neutral) instead of a flattened boolean. The overlay
renders three distinct states: neutral (dim gray), good (full-opacity green), bad (dim red).

### Reset button now syncs the overlay instantly
The on-screen Reset button used to just do `location.reload()`, leaving the overlay's timers and evidence stale
until the page finished reloading. `reset()` now calls `window.electronAPI.resetAll()` first, which fires
`state.resetAll()` in the main process immediately — same path the Ctrl+Shift+X hotkey already used.

### Timer audio restored
Traced the original (pre-Electron-rewrite) timer sound design out of git history (commit `57b2dde`) and
restored it against the current single-duration timer model:
- **Start/stop sounds** (`start.mp3`/`stop.mp3`) play on every timer start, and on manual stop only (not on
  natural completion).
- **Cooldown**: `demon_cooldown.mp3` at 10s remaining (replaces the generic beep), then a 3-2-1 countdown +
  finish ding at 5s remaining (a real early boundary in the original design), `standard_cooldown.mp3` right
  after it, then another 3-2-1 + finish ding leading into the true end.
- **Smudge**: `standard_smudge.mp3` at 8s before the normal 90s end, then a 5-4-3-2-1 countdown + finish ding.
  If not stopped manually, smudge now enters a 90s **overtime** phase (overlay turns red, counts up from
  `0:00`) — `spirit_smudge.mp3` plays 8s before overtime ends, followed by another 5-4-3-2-1 + finish ding.
- **Hunt** deliberately left unchanged — the original had ghost-specific hunt voice lines
  (`standard_hunt`/`cursed_hunt`) that were not restored; hunt still just has the plain beep/end tone.

Implementation lives in `electron/state.js` (broadcasts `play-audio` events with an `event` name and, for
digits, an `n`) and `electron/overlays/overlay.html` (`handleAudio()` maps events to either a synthetic tone or
a real `lang-v10/en/assets/*.mp3` / top-level `assets/*.mp3` file).

### WebUI tab layout cleanup
- Removed the unused "Current Event" tab (left side) — including its `events-v3.js`/`events-v2.css` includes,
  which fetched from `zero-network.net` and would have thrown on the removed elements.
- Removed the Discord tab (right side).
- Closed the resulting gaps: left side is now Settings → Links → Guides (wiki) → Maps back-to-back; right side
  is Search → Theme → (hidden) Debug tab back-to-back.

### Version control
`electron/` and `server/` were never tracked in git at all — the repo couldn't be cloned and run from scratch.
Both are now tracked, with a root `.gitignore` (`node_modules/`, the machine-local `shortcuts.json`, fetched
`server/data/` cache, `electron-builder` output, crash dumps).

**Two remotes exist**: `fork` (this account's own copy) and `origin` (the original `tybayn/phasmo-cheat-sheet`
upstream). `main` tracks `fork/main` — always push there, never to `origin`.

## 2026-08-03 session — Clickable overlay

Evidence icons on the overlay (`electron/overlays/overlay.html`) are now clickable, not just
hotkey/web-UI-driven. Hover over the Evidence panel makes it briefly interactive; clicking an icon calls
the same `execEvidenceToggle(index)` function the `Ctrl+1..7` hotkeys use, so overlay clicks and hotkeys
are guaranteed to behave identically. Everywhere else on the overlay (timers, ghost list, background)
stays permanently click-through.

Implementation: two new `ipcMain` handlers in `electron/main.js` (`overlay-set-interactive`,
`overlay-toggle-evidence`), two new `preload-overlay.js` methods (`setInteractive`, `toggleEvidence`), and
`data-idx`/hover-CSS/click-listener wiring in `overlay.html`. Built via the full
brainstorm → spec → plan → subagent-driven-development workflow (see
`docs/superpowers/specs/2026-08-03-clickable-overlay-design.md` and
`docs/superpowers/plans/2026-08-03-clickable-overlay.md`).

**Real-hardware testing caught a bug the subagent review couldn't**: `overlay.setIgnoreMouseEvents(true)`
(the pre-existing baseline click-through call, untouched by the plan) was missing the `{ forward: true }`
option. Without it, mousemove never reached the overlay's renderer, so `mouseenter` never fired, so the
panel could never flip itself interactive — clicks silently did nothing. The subagent's review only ever
simulated DOM events (`dispatchEvent(new MouseEvent(...))`), which bypasses the OS-level click-through
mechanism entirely and can't catch this class of bug. Fixed by adding `{ forward: true }` to that call
(`electron/main.js` — one line). Verified end-to-end with real mouse input: hover dims the icon, click
cycles neutral → good → bad → neutral and updates the ghost list, `Ctrl+1..7` hotkeys still work
unaffected, and clicks outside the Evidence panel remain click-through.

**Takeaway for future subagent-driven work**: when a task reviewer flags "⚠️ cannot verify from diff" for
anything involving real OS/browser input (mouse hover, click-through, focus), don't accept simulated-event
verification as sufficient — treat it as a real open item and do a live manual pass before calling the
work done.

## 2026-08-03 session, part 2 — Packaged installer + shared server

Moved from "everyone runs their own local server" to a **shared server model**: one host PC runs
`node server.js` continuously, exposed via a Cloudflare Tunnel at `phasmo.mustardhq.dev`. Added
`server/README.md` with clone/install/fetch-data/run steps for whoever hosts it.
`electron/config.json`'s `serverUrl` now points at that domain instead of `localhost:3000`, so a built
installer works for friends with zero manual config editing.

Built the first real installer via `electron-builder` (`npm run dist`, NSIS target, already configured in
`electron/package.json`). Since the main window now loads the frontend from the tunnel URL instead of local
files, removed the old `extraResources` block that bundled the entire `frontend/`+`server/` folders into the
package — that was dead weight under the new model.

That removal broke the **overlay window**, which is a local file (`electron/overlays/overlay.html`) and
references icons/audio via paths like `../../imgs/emf5-icon.png` and `../../assets/start.mp3` — relative to
`electron/overlays/`, resolving to repo-root folders that only exist in dev because `electron/` sits inside
the full checkout there. Packaged, nothing copied those folders in, so evidence icons showed as broken
placeholders and timers had no sound. Fixed by re-adding `extraResources` for just `imgs/`, `assets/`, and
`lang-v10/`, placed so the overlay's existing `../../` relative paths resolve correctly inside the packaged
`resources/` folder (sibling to `app.asar`). Verified via a real install → uninstall-old-processes → rebuild →
reinstall → relaunch cycle: icons render and timer start sound plays correctly in the packaged `.exe`.

Installer currently unsigned (Windows SmartScreen will warn friends on first run — click "More info" → "Run
anyway") and uses Electron's default icon (no `icon.ico` in the repo yet).

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

**Packaged-build bug found and fixed by testing the actual installer (not just `npm start`)**: settings
appeared to save (UI updated instantly, overlay changed live) but silently reverted to defaults on the next
launch. Root cause: both `electron/shortcuts.json` and the new `electron/overlay-settings.json` were written
to `path.join(__dirname, ...)`, which in dev is a normal folder but in a packaged build resolves *inside* the
read-only `app.asar` archive — `fs.writeFileSync` there fails, caught silently by the existing try/catch.
Fixed by switching both files to `app.getPath('userData')` (`%APPDATA%\phasmo-cheat-sheet\` on Windows), the
standard Electron location for this kind of generated, per-install state. Verified against a rebuilt,
reinstalled copy of the actual `.exe`: corner/scale/theme/panel choices and a rebound hotkey both now survive
a full quit and relaunch. This bug predated this session (shortcuts.json had the same flaw) but had never
been caught because no prior session tested settings persistence against the *packaged* app specifically —
worth remembering that `npm start` and the installed `.exe` can behave differently for anything touching
`__dirname`-relative file writes.

Built via the full brainstorm → spec → plan → implementation workflow — see
`docs/superpowers/specs/2026-08-03-overlay-customization-design.md` and
`docs/superpowers/plans/2026-08-03-overlay-customization.md`.

Custom app icon (`electron/icon.ico`, multi-res 16-256px) was also added this same day, generated via PIL
from a user-provided source PNG (`electron/icon-source.png`, kept for future regeneration) and wired into
`electron-builder`'s `win.icon`.

## 2026-08-03 session, part 4 — First public release

Shipped the first public installer via a GitHub Release rather than an ad-hoc file share:
**https://github.com/ExtremelyPowerfulCapybara/phasmo-cheat-sheet/releases/tag/v1.0.0**. Tagged the commit
(`git tag -a v1.0.0`), pushed the tag to `fork`, then `gh release create v1.0.0 <installer.exe> --notes "..."`
with install steps for friends (download → run → click through the unsigned-installer SmartScreen warning →
app auto-connects to `phasmo.mustardhq.dev`). Repeatable workflow for future versions: bump version if
desired → `npm run dist` → tag → push tag → `gh release create`/`gh release upload --clobber`.

## 2026-08-03 session, part 5 — Hotkey rebind

Rebound the default hotkeys: evidence 1-7 moved from `Ctrl+1..7` to `Shift+1..7`; timers moved from
`Shift+F1/F2/F3` to `Ctrl+1/2/3`. The user's original ask was for evidence on `Shift+1-7` and timers as bare,
unmodified `1`/`2`/`3` — real-hardware testing showed bare-key global hotkeys don't work at all on Windows:
`globalShortcut.register('1', ...)` reports success but never actually hooks the key system-wide (a bare "1"
typed straight into Notepad instead of firing the hotkey), so timers landed on `Ctrl+1/2/3` instead. Kept the
Hotkey Manager's "must include a modifier" validation in the capture UI to stop future bindings from silently
looking saved while doing nothing.

Also corrected a stale assumption from an earlier session that "Shift+digit is blocked entirely" on Windows —
that turned out to be wrong; `Shift+1` through `Shift+7` register and intercept correctly. Debugging this hit
one red herring worth remembering: an old `shortcuts.json` in `%APPDATA%\phasmo-cheat-sheet\` silently
overrode the new code defaults on disk (`loadShortcuts()` does `Object.assign({}, DEFAULTS, saved)` — saved
always wins), making a working `Ctrl+1` binding look broken until "Reset to defaults" was clicked in the
Hotkey Manager to resync.

## 2026-08-03 session, part 6 — Fixed orphan process on window close

User asked how to close the overlay without Task Manager — turned out there was no way to, and it was a real
bug: the overlay window is `skipTaskbar: true` + `focusable: false` + frameless, so it has no UI a user can
close directly. Closing the main window only nulled the `mainWindow` reference; `window-all-closed` never
fired because the overlay was still alive, so the whole app (and every registered global hotkey) kept running
invisibly — the actual root cause behind the long-standing "kill zombie electron.exe processes" workaround
documented earlier in this log. Fixed by calling `app.quit()` explicitly in `mainWindow`'s `closed` handler.
Verified on real hardware: clicked the main window's X, confirmed via `Get-Process electron` that zero
processes remained afterward (previously several persisted — main, renderer, GPU, utility, and overlay).

## To Do
- [x] Custom app icon (`icon.ico`) for the installer
- [x] Overlay customization
- [x] GitHub Release distribution (v1.0.0)
- [x] Default hotkey rebind (evidence Shift+1-7, timers Ctrl+1-3)
- [x] Fix orphan process on main window close
- [ ] Web UI customization
