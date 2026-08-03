# Clickable Overlay — Design

## Problem

The combined overlay window (`electron/overlays/overlay.html`) is fully click-through
(`overlay.setIgnoreMouseEvents(true)` in `electron/main.js`). Evidence state can currently only be
changed via hotkeys (`Ctrl+1`..`Ctrl+7`) or the web UI. This spec adds the ability to click evidence
icons directly on the overlay.

Scope is evidence icons only — timers and the ghost list stay display-only.

## Architecture

No changes to the existing read-side data flow (`evidence-update` IPC → overlay repaint). Two additions:

1. **Hover-driven click-through toggle.** The evidence `.panel` div gets `mouseenter`/`mouseleave`
   listeners that call a new preload method, `overlayAPI.setInteractive(bool)`. The main process
   handles this by calling `overlay.setIgnoreMouseEvents(!interactive, { forward: true })`. Everywhere
   else on the overlay (timers, ghost list, background) stays permanently click-through — only the
   evidence panel becomes clickable, and only while the cursor is over it.
2. **Click → toggle IPC.** Each `.evi-item` gets a click listener calling a new preload method,
   `overlayAPI.toggleEvidence(index)`. This triggers `execEvidenceToggle(index)` in `main.js` — the
   *same* function the `Ctrl+1..7` hotkeys already call — so overlay clicks and hotkeys are guaranteed
   to behave identically (one click/press = one step through the existing neutral → good → bad →
   neutral cycle).

## Components

- **`electron/preload-overlay.js`** — add `setInteractive(bool)` and `toggleEvidence(index)` to the
  exposed `overlayAPI`, both wrapping `ipcRenderer.send(...)`. No fs/path additions (sandbox blocks
  Node built-ins in preloads — see prior incident in project memory).
- **`electron/main.js`** — add two `ipcMain.on` handlers:
  - `overlay-set-interactive` → `overlay.setIgnoreMouseEvents(!interactive, { forward: true })`
    (guarded by `overlay && !overlay.isDestroyed()`).
  - `overlay-toggle-evidence` → `execEvidenceToggle(index)` (reuses existing function, same guard
    behavior as hotkeys).
- **`electron/overlays/overlay.html`** —
  - Add `data-idx="0"`..`"6"` to each `.evi-item` (matching the existing `Ctrl+1..7` order: EMF 5,
    Ultraviolet, Writing, Ghost Orbs, Spirit Box, Freezing, DOTs).
  - Wire `mouseenter`/`mouseleave` on the evidence `.panel` → `overlayAPI.setInteractive(true/false)`.
  - Wire `click` per `.evi-item` → `overlayAPI.toggleEvidence(parseInt(el.dataset.idx))`.
  - CSS: `cursor: pointer` and a subtle hover highlight on `.evi-item`, scoped to that panel only.

## Data Flow

Identical to the hotkey path once past the click:

```
click on .evi-item
  → overlayAPI.toggleEvidence(index)
  → ipcMain 'overlay-toggle-evidence'
  → execEvidenceToggle(index)
  → mainWindow.webContents.send('toggle-evidence', index)
  → web page's existing filter/toggle logic
  → sendFilterResult()
  → ipcMain 'evidence-result'
  → overlay.webContents.send('evidence-update')
  → overlay repaints (setEvidence + setGhostList)
```

No new state is introduced or duplicated; the web page remains the single source of truth for
evidence state, as it is today.

## Error Handling

No new error handling needed beyond existing guards:
- `execEvidenceToggle` already no-ops safely if `mainWindow` is gone (same guard used by hotkeys).
- Hover-interactive toggle is fire-and-forget; the existing `overlay && !overlay.isDestroyed()` guard
  (already used elsewhere in `main.js`) prevents a crash if it races with window close.

## Testing

Manual (no automated test harness exists for the Electron app):
1. Launch app, hover over the overlay's evidence panel — cursor should become clickable only inside
   that panel; the rest of the transparent overlay remains click-through into whatever is behind it.
2. Click each evidence icon — confirm it cycles neutral → good → bad → neutral, matching `Ctrl+<n>`
   behavior, and the ghost list updates accordingly.
3. Click outside the evidence panel (timers, ghost list, background) — confirm clicks still pass
   through to the game/window behind the overlay.
4. Confirm hotkeys (`Ctrl+1..7`) still work unchanged alongside the new click path.
