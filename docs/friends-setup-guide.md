# Phasmo Cheatsheet — Friends Setup Guide

A Phasmophobia helper tool that syncs evidence, timers, and ghost info between players in real time.

---

## Option 1 — Browser Only (No Install)

The easiest way. Works on any PC, no setup required.

1. Open your browser and go to **phasmo.yourdomain.com**
2. The cheatsheet loads automatically
3. To join a session with friends, see [Joining a Room](#joining-a-room) below

You get the full cheatsheet and real-time sync. You won't have the hotkeys or the overlay (those require the app below).

---

## Option 2 — Desktop App (Hotkeys + Overlay)

Install this if you want:
- Global hotkeys to toggle evidence and timers while in-game (no alt-tabbing)
- An always-visible overlay on the left side of your screen showing timers and remaining ghosts

### Setup steps

1. **Download the app** — ask the host for the installer link
2. **Install and open it** — the app will open the cheatsheet automatically
3. **Configure the server** — the first time you open it, set the server URL to `https://phasmo.yourdomain.com` in the settings
4. You're ready to go

### Default hotkeys

| Key | Action |
|-----|--------|
| `1` | Start / stop Smudge timer |
| `2` | Start / stop Cooldown timer |
| `3` | Start / stop Hunt timer |
| `Shift+1` | Toggle EMF Level 5 evidence |
| `Shift+2` | Toggle Ultraviolet evidence |
| `Shift+3` | Toggle Ghost Writing evidence |
| `Shift+4` | Toggle Ghost Orbs evidence |
| `Shift+5` | Toggle Spirit Box evidence |
| `Shift+6` | Toggle Freezing Temperatures evidence |
| `Shift+7` | Toggle DOTS Projector evidence |
| `M` | Show / hide maps |
| `Shift+R` | Reset all (new investigation) |
| `Ctrl+Shift+K` | Open Hotkey Manager to rebind any key |

---

## Joining a Room

Rooms let everyone's evidence and timers stay in sync during a session.

1. **Someone creates a room** — one player clicks **"Create Room"** on the cheatsheet page. A short room ID appears (e.g. `phasmo-3f7a`) and is copied to clipboard automatically
2. **Share the ID** — paste it in Discord or chat
3. **Everyone joins** — each player enters the room ID in the **"Join Room"** field on the cheatsheet page and clicks Join
4. Done — evidence and timers now sync across everyone in real time

**Notes:**
- Rooms are created fresh each session — you get a new ID every time you play
- If someone disconnects and rejoins, they catch up to the current state automatically
- Anyone in the room can toggle evidence or reset (it affects everyone)

---

## During a Game

- **Click evidence checkboxes** on the web page, or use hotkeys (app only) — the ghost list filters in real time
- **Start timers** via the web page buttons or hotkeys — countdown shows in the overlay (app) or on the page
- **Reset** when moving to a new investigation — clears all evidence and stops timers for everyone in the room

---

## Troubleshooting

**Page won't load** — check your internet connection and try again. If the site is down, contact the host.

**Room not syncing** — make sure everyone entered the same room ID exactly. Room IDs are case-sensitive.

**Hotkeys not working (app)** — open the Hotkey Manager (`Ctrl+Shift+K`) and check for conflicts with your other apps. You can rebind any key.

**Overlay not showing (app)** — the overlay appears on the left side of your primary monitor. If you have multiple monitors, check that one.
