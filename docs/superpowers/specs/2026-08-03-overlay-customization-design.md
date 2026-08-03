# Overlay Customization — Design

## Problem

The combined overlay window (`electron/overlays/overlay.html`) is entirely hardcoded: fixed position
(top-left, `x: 8, y: 20`), fixed size (`width: 280`, full workarea height), a single hardcoded color
scheme, and all three panels (Timers, Evidence, Possible Ghosts) always visible. This spec adds a
settings window letting the user control position (corner), scale, color theme, and per-panel
visibility, with changes persisted across restarts.

Scope: overlay appearance/layout only. Overlay *behavior* (click-to-toggle evidence, hover-driven
interactivity) is unchanged and out of scope, as is any change to the main web-app window.

## Approach

New `electron/overlay-settings.json`, persisted and owned by the main process — mirrors the existing
`electron/shortcuts.json` pattern (same persistence style, same "dedicated editor window" UX as the
Hotkey Manager). Rejected alternative: folding these settings into `electron/config.json`. That file
now ships pre-baked with a specific `serverUrl` per deployment (e.g. a friend's installer pointing at a
host's Cloudflare Tunnel) — mixing per-user UI preferences into the same file that needs a stable
shared value risks the two concerns colliding. Keeping them separate matches the codebase's existing
convention of one persisted JSON file per concern.

## Settings Schema

`electron/overlay-settings.json`:

```json
{
  "corner": "top-left",
  "scale": 1.0,
  "theme": "default",
  "panels": {
    "timers": true,
    "evidence": true,
    "ghosts": true
  }
}
```

- **`corner`**: `"top-left" | "top-right" | "bottom-left" | "bottom-right"`. Determines the overlay
  `BrowserWindow`'s `x`/`y`, computed from `screen.getPrimaryDisplay().workAreaSize` the same way the
  current fixed `x: 8, y: 20` is computed today, just mirrored per corner.
- **`scale`**: number, clamped to `[0.75, 1.5]`. Applied as `document.body.style.zoom` in the overlay
  renderer — scales all text/icons/spacing proportionally without touching individual CSS rules.
- **`theme`**: one of `"default" | "high-contrast" | "colorblind-friendly" | "minimal"`. Maps to a CSS
  class on `<body>` (`theme-<name>`) that overrides a fixed set of CSS custom properties.
- **`panels.timers` / `.evidence` / `.ghosts`**: booleans. A hidden panel is `display: none`. The
  overlay window itself does **not** dynamically resize to fit visible panels (stays full workarea
  height regardless) — auto-shrink-to-content is out of scope for v1 (YAGNI).

Defaults exactly reproduce current hardcoded behavior, so existing installs are unaffected until the
user opens the new settings window.

## Components

- **`electron/overlay-settings.json`** (new, gitignored like `shortcuts.json`) — persisted state, loaded
  with the same `try/catch`-returns-defaults pattern already used for `config.json`
  ([main.js:9-11](../../../electron/main.js)) and `shortcuts.json`. On load, `scale` is clamped to
  `[0.75, 1.5]` in case of hand-edited corruption; any other missing/invalid field falls back to its
  default individually (not an all-or-nothing reset).

- **`electron/main.js`** —
  - New hotkey `Ctrl+Shift+O` added to the `DEFAULTS` object (alongside the existing
    `Ctrl+Shift+K` Hotkey Manager binding), opens/focuses a new `overlaySettingsWindow`
    (`alwaysOnTop: true`, same size class as the existing `shortcutsWindow`).
  - New IPC handlers:
    - `overlay-settings-get` → returns the in-memory settings object (already loaded synchronously at
      startup before any window is created, so no race is possible).
    - `overlay-settings-update` (partial object) → merges into the in-memory settings, persists to
      `overlay-settings.json`, and:
      - if `corner` or `scale` changed: recompute bounds and call `overlay.setBounds(...)` on the live
        overlay window (no restart needed).
      - always: `overlay.webContents.send('overlay-settings-update', settings)` so the overlay
        re-applies theme/panel-visibility/scale live.
  - Both new handlers guarded the same way existing overlay IPC handlers are
    (`overlay && !overlay.isDestroyed()`).

- **`electron/preload-overlay-settings.js`** (new) — `contextBridge`-exposed
  `window.overlaySettingsAPI` with `.get()`, `.update(partial)`, `.onUpdate(cb)`. No `fs`/`path`
  (Electron 33 sandbox blocks Node built-ins in preloads — see prior incident in project memory).

- **`electron/overlay-settings-window.html`** (new, modeled on `shortcuts-window.html`'s structure and
  styling for visual consistency) —
  - Corner picker: 2×2 button grid representing the four screen corners.
  - Scale: labeled slider, `0.75`–`1.5`, live percentage readout.
  - Theme: 4 clickable preset swatches (not a plain dropdown, so colors are visible before picking).
  - Panels: 3 checkboxes (Timers / Evidence / Possible Ghosts).
  - No "Save" button — every control change calls `overlaySettingsAPI.update(...)` immediately,
    consistent with the Hotkey Manager's existing live-rebinding UX, and lets the user watch the
    overlay update in real time while this window is open.

- **`electron/preload-overlay.js`** — add `onSettingsUpdate(cb)` wrapping
  `ipcRenderer.on('overlay-settings-update', ...)`, alongside the existing `onTimerUpdate` /
  `onEvidenceUpdate` / etc.

- **`electron/overlays/overlay.html`** —
  - On load, calls `overlayAPI.getSettings()` once (via a corresponding `overlay-settings-get` relay in
    main.js) so a fresh launch immediately reflects the last-saved settings rather than hardcoded
    defaults, then subscribes to `onSettingsUpdate` for live changes thereafter.
  - Settings handler applies: `document.body.className = 'theme-' + theme`,
    `document.body.style.zoom = scale`, and toggles each panel's `display` per `panels`.
  - CSS refactor: current hardcoded colors move under a `.theme-default` block referencing new CSS
    custom properties (`--bg`, `--text`, `--accent`, `--good`, `--bad`), proving default behavior is
    unchanged; the other 3 themes are additional blocks overriding the same properties.

## Data Flow

```
user changes a control in overlay-settings-window.html
  → overlaySettingsAPI.update(partial)
  → ipcMain 'overlay-settings-update'
  → merge into in-memory settings, persist to overlay-settings.json
  → overlay.setBounds(...) if corner/scale changed
  → overlay.webContents.send('overlay-settings-update', settings)
  → overlay.html applies theme class / zoom / panel display
```

```
app startup
  → main.js loads overlay-settings.json (defaults on missing/corrupt)
  → overlay BrowserWindow created with bounds computed from corner+scale
  → overlay.html requests current settings on did-finish-load, applies immediately
```

## Error Handling

- Missing/corrupt `overlay-settings.json` → `try/catch` returns hardcoded defaults, same pattern as
  `config.json`. No crash.
- Invalid `scale` value (e.g. hand-edited to `99`) → clamped to `[0.75, 1.5]` at load time.
- Invalid `corner` or `theme` string → falls back to that field's individual default
  (`"top-left"` / `"default"`) rather than resetting the whole file.
- Settings-window IPC calls when the overlay window has been closed → guarded by the existing
  `overlay && !overlay.isDestroyed()` check used elsewhere in `main.js`.

## Testing

No meaningful unit-test surface for the Electron/IPC/UI plumbing itself, consistent with how the
clickable-overlay feature was tested. One exception: the corner→`{x,y}` bounds computation is a pure
function and gets a unit test following the existing `electron/state.test.js` pattern.

Manual verification pass (real hardware, not simulated DOM events — see the clickable-overlay session's
takeaway that simulated events can't catch real click-through/window-bounds issues):
1. Each of the 4 corners positions the overlay correctly and keeps it fully on-screen.
2. Scale slider visibly resizes text/icons/panels live while dragging.
3. Each of the 4 themes visibly changes overlay colors.
4. Unchecking a panel hides it immediately; re-checking restores it.
5. Settings persist across a full app restart (close and relaunch, not just window reload).
6. A corrupt or missing `overlay-settings.json` doesn't crash startup (falls back to defaults).
7. Existing overlay behavior (evidence click-to-toggle, hotkeys, timers, audio) is unaffected.
