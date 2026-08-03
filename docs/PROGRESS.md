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

## To Do
- [ ] Overlay customization
- [ ] Clickable overlay
- [ ] Web UI customization
