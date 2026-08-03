# Phasmo Cheat Sheet — Server

Node HTTP + WebSocket server. Serves the frontend as static files (from the repo root, one level up)
and handles WebSocket room-link connections. Runs on port 3000.

This is the one piece that needs to run continuously on whichever PC is "hosting" — everyone else's
Electron app just connects to it. Only one instance should run at a time.

## Setup on the server PC

```powershell
git clone https://github.com/ExtremelyPowerfulCapybara/phasmo-cheat-sheet.git
cd phasmo-cheat-sheet/server
npm install
npm run fetch-data
node server.js
```

- `npm install` — pulls in dependencies (`ws`). `node_modules/` is gitignored, don't copy it manually.
- `npm run fetch-data` — regenerates `data/` (gitignored game-data cache). Needs internet access.
- `node server.js` — starts the server on port 3000.

The `electron/` folder is not needed on this machine unless it's also running the client.

## Updating

```powershell
git pull
npm install
node server.js
```

## Exposing it externally

If friends aren't on the same LAN, put this behind a Cloudflare Tunnel (or similar) pointing
`http://localhost:3000` at your public domain, then set that domain as `serverUrl` in each
Electron client's `electron/config.json`.
