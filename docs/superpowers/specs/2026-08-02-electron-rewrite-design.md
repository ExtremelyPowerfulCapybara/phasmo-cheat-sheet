# Phasmo Cheatsheet — Self-Contained Electron Rewrite

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning

---

## 1. Goal

Rebuild the Electron wrapper as a self-contained app where the main process owns all runtime state (timers, evidence). Eliminate the fragile IPC relay that caused overlays to silently fail. Overlays receive updates directly from the main process.

---

## 2. Scope

**In scope:**
- 3 timers: Smudge, Cooldown, Hunt (toggled via configurable hotkeys)
- Evidence overlay: 7 evidence types with configurable hotkeys, shows selected evidence + remaining possible ghosts
- Maps: opens map panel in web UI (existing `open_maps` behavior)
- Web UI: `index.html` and `scripts-v10/` kept; evidence checkboxes synced with overlay
- Voice audio cues for timer states — played from overlay window
- Multiplayer room sync via WebSocket (evidence toggles, timer toggles, reset)
- Always-on cloud server via Docker + Caddy on user's self-hosted domain

**Out of scope:**
- Sanity tracker (removed entirely)
- Sound timer and Speed display (removed)
- BPM / footstep metronome (untouched, stays in web page only)
- Voice recognition (untouched)

---

## 3. Architecture

### 3.1 Overview

```
Shortcut / web page action
        |
        v
    main.js
        |
        +---> state.js (mutate state, recalculate ghost list)
        |         |
        |         +---> overlay.webContents.send(...)
        |         +---> mainWindow.webContents.send(...)
        |         +---> ws-client.js.send(...)
        |
        +---> ws-client.js (WebSocket room relay)
                  |
                  +--- on remote message ---> state.js (same path as local action)
```

**Three actors:**
- `state.js` — single source of truth: timer intervals, evidence booleans, ghost list
- `overlay.html` — pure display: renders timers, evidence icons, ghost list; plays audio
- Web page — sends evidence changes to main via IPC; receives evidence state for checkbox sync

### 3.2 State Module (`electron/state.js`)

Owns all runtime state:

```
timers: {
  smudge:   { running: bool, remaining: ms, interval: Timeout }
  cooldown: { running: bool, remaining: ms, interval: Timeout }
  hunt:     { running: bool, remaining: ms, interval: Timeout }
}
evidence: bool[7]   // [EMF5, UV, Writing, Orbs, SpiritBox, Freezing, DOTS]
ghostList: string[] // recalculated on every evidence change
```

Public API:
- `toggleTimer(id)` — starts/stops interval, broadcasts tick every 100ms
- `toggleEvidence(index)` — flips boolean, recalculates ghost list, broadcasts
- `resetAll()` — stops all timers, clears evidence, broadcasts
- Ghost data loaded once at startup from `server/data/ghosts.json`

### 3.3 IPC Channels

**Main window preload (`electron/preload.js`):**

| Direction | Channel | Payload |
|-----------|---------|---------|
| send | `toggle-evidence` | `index: number` |
| send | `reset-all` | — |
| receive | `evidence-update` | `{ evidence: bool[7], ghostList: string[] }` |

**Overlay preload (`electron/preload-overlay.js`):**

| Direction | Channel | Payload |
|-----------|---------|---------|
| receive | `timer-update` | `{ id, value, running }` |
| receive | `evidence-update` | `{ evidence: bool[7], ghostList: string[] }` |
| receive | `play-audio` | `filename: string` |
| receive | `reset-all` | — |

All communication is one-way push from main. No `invoke` / request-response needed.

---

## 4. Overlay (`electron/overlays/overlay.html`)

**Position:** Left side of screen, always-on-top, transparent background.

**Layout:**
```
+--------------------------------+
|  Smudge   Cooldown   Hunt      |  <- timers; dim when stopped, white when active
|   1:30      0:00      0:00     |
+--------------------------------+
|  [EMF] [UV] [Write] [Orbs]     |  <- evidence icons; highlighted when selected
|  [Box] [Freeze] [DOTS]         |
+--------------------------------+
|  Phantom                       |  <- remaining possible ghosts (live filter)
|  Revenant                      |     "No match" if none remain
|  Wraith                        |
+--------------------------------+
```

- Reuses existing icons from `imgs/` (`emf5-icon.png`, `fingerprints-icon.png`, etc.)
- Hidden `<audio>` element handles voice cues on `play-audio` IPC events
- Fixed height; ghost list does not scroll (truncates if needed)
- No sanity section, no sound/speed rows

---

## 5. Hotkeys

All hotkeys configurable via Hotkey Manager (Ctrl+Shift+K, fixed).
Defaults:

| Action | Default |
|--------|---------|
| Smudge timer | `1` |
| Cooldown timer | `2` |
| Hunt timer | `3` |
| EMF5 evidence | `Shift+1` |
| Ultraviolet evidence | `Shift+2` |
| Ghost Writing evidence | `Shift+3` |
| Ghost Orbs evidence | `Shift+4` |
| Spirit Box evidence | `Shift+5` |
| Freezing Temps evidence | `Shift+6` |
| DOTS evidence | `Shift+7` |
| Show Maps | `M` |
| Reset all | `Shift+R` |
| Hotkey Manager | `Ctrl+Shift+K` (fixed) |

Persisted to `electron/shortcuts.json`. Hotkey Manager (`shortcuts-window.html`) gains 7 new evidence rows.

---

## 6. Hosting Model

`phasmo.yourdomain.com` is permanently up — it serves the cheatsheet web page AND handles WebSocket rooms. Two types of users connect to it:

| User type | How they connect | Experience |
|-----------|-----------------|------------|
| Browser (friends) | Visit `phasmo.yourdomain.com` in any browser | Full cheatsheet + room sync, no install |
| Electron (you) | Electron loads `https://phasmo.yourdomain.com` as its main window | Same web page + global hotkeys + overlay |

Electron no longer spawns a local Node server. It loads the hosted URL directly. Redeploying the server updates all users (browser and Electron) automatically.

## 7. Multiplayer / WebSocket

### 7.1 Client (`electron/ws-client.js`)

- Connects to `wss://phasmo.yourdomain.com/room/{id}`
- On local state change (shortcut or checkbox): `ws.send({ type, payload })`
- On remote message: calls the same `state.js` mutators as local actions
- Electron overlay plays audio cues locally; browser users hear nothing (no overlay)

**Synced events:** `timer-toggle`, `evidence-toggle`, `reset-all`

### 7.2 Room flow

1. Any player (browser or Electron) clicks **"Create Room"** on the web page → gets a room ID (e.g. `phasmo-3f7a`) → auto-copied to clipboard
2. ID shared with friends via Discord/chat
3. Friends visit `phasmo.yourdomain.com`, enter the room ID → instantly synced
4. Rooms are ephemeral (in-memory on server) — new room each session, no database needed

### 7.3 Server URL (`electron/config.json`)

```json
{ "serverUrl": "https://phasmo.yourdomain.com" }
```

Electron reads this once at startup to know where to point the BrowserWindow and WS client. Required — no localhost fallback in the new architecture.

---

## 8. Server Deployment

`server.js` runs as a Docker container behind the user's existing Caddy reverse proxy.

### Dockerfile (`server/Dockerfile`)

```dockerfile
FROM node:20-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
EXPOSE 3000
CMD ["node", "server.js"]
```

### Compose entry (`server/docker-compose.yml`)

```yaml
services:
  phasmo-server:
    build: .
    restart: unless-stopped
    expose: ["3000"]
    volumes:
      - phasmo_data:/app/server/data
    networks: [edge]

networks:
  edge:
    external: true
    name: edge

volumes:
  phasmo_data:
```

### Caddyfile entry

```
phasmo.yourdomain.com {
  reverse_proxy phasmo-server:3000
}
```

Caddy handles `wss://` upgrade automatically. No extra config needed.

---

## 9. Future Considerations (out of scope)

- **Web page visual redesign** — `index.html` and `scripts-v10/` are standard HTML/CSS/JS static files. Layout, colors, typography, and component structure can be customized in a future pass without touching the Electron or server architecture.

## 10. Files

### New
| File | Purpose |
|------|---------|
| `electron/state.js` | Timer + evidence state, ghost filtering |
| `electron/ws-client.js` | WebSocket client, room management |
| `electron/config.json` | Server URL setting |
| `electron/preload-overlay.js` | Dedicated preload for overlay window |
| `server/Dockerfile` | Containerize server.js |
| `server/docker-compose.yml` | Compose entry for self-hosted deployment |

### Modified
| File | Changes |
|------|---------|
| `electron/main.js` | Remove old relay; load state.js + ws-client.js; register shortcuts to state; open overlay with new preload |
| `electron/preload.js` | Slim down: evidence toggle, reset, receive broadcasts |
| `electron/overlays/overlay.html` | Full redesign: timers + evidence + ghosts, left side, audio |
| `electron/shortcuts-window.html` | Add 7 evidence hotkey rows |
| `scripts-v10/filter-v15.js` | Remove timer display; add `ipcRenderer.send('toggle-evidence', i)` on checkbox change; listen for `evidence-update` to sync |
| `scripts-v10/wslink-v8.js` | Remove WS client logic (moves to main); keep `open_maps` / `open_wiki` stubs |
| `scripts-v10/timer-v4.js` | Remove all timer logic; keep empty file to avoid 404 on script tag in index.html |

### Modified (minor)
| File | Changes |
|------|---------|
| `index.html` | Remove timer display elements; wire up `evidence-update` IPC listener |

### Untouched
- `server/server.js` — no changes needed
- `server/fetch-data.js` — unchanged
- `electron/shortcuts.json` — gains new keys, same format
