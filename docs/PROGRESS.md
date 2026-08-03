# Phasmo Cheatsheet — Development Progress

Running log of what's been done since the Electron rewrite landed, and what's left. See
`docs/superpowers/plans/2026-08-02-electron-rewrite.md` and
`docs/superpowers/specs/2026-08-02-electron-rewrite-design.md` for the original rewrite plan/design this builds on.

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

## To Do
- [ ] Custom app icon (`icon.ico`) for the installer
- [x] Overlay customization
- [ ] Web UI customization
