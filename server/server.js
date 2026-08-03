const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SERVER_DIR = __dirname;
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(SERVER_DIR, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.svg':  'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// rooms: Map<roomId, { clients: Map<ws, {pos, ready}>, state: object|null }>
const rooms = new Map();

function genId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function broadcast(room, message, exclude = null) {
  for (const [client] of room.clients) {
    if (client !== exclude && client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  }
}

function serveDataFile(res, filename) {
  const filePath = path.join(DATA_DIR, filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Data not cached. Run: node fetch-data.js  (from the server/ directory)'
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  });
}

// ── HTTP ───────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const base = `http://localhost:${PORT}`;
  const url  = new URL(req.url, base);
  const p    = url.pathname;

  // Health check (index.html polls this)
  if (p === '/zn/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Session init — zn-v5.js calls this to get znid
  // We handle it here as a fallback; zn-v5.js is also patched to generate znid locally.
  if (p === '/zn/' || p === '/zn') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ znid: 'local_' + genId() }));
    return;
  }

  // Game data
  if (p === '/phasmophobia/data/ghosts.json') { serveDataFile(res, 'ghosts.json'); return; }
  if (p === '/phasmophobia/data/maps')         { serveDataFile(res, 'maps.json');   return; }
  if (p === '/phasmophobia/data/weekly.json')  { serveDataFile(res, 'weekly.json'); return; }

  // Languages (English only)
  if (p === '/phasmophobia/languages') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(['en']));
    return;
  }

  // Create room
  if (p === '/create-room' && req.method === 'POST') {
    const room_id = genId(8);
    rooms.set(room_id, { clients: new Map(), state: null });
    console.log(`[room] created ${room_id}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ room_id }));
    return;
  }

  // Static files
  let filePath = p === '/' ? '/index.html' : p;
  // Prevent directory traversal
  filePath = path.normalize(path.join(FRONTEND_DIR, filePath)).replace(/\.\./g, '');
  if (!filePath.startsWith(path.normalize(FRONTEND_DIR))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ── WebSocket ──────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url   = new URL(req.url, `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/room\/([a-z0-9]+)$/);
  if (!match) { ws.close(1008, 'invalid path'); return; }

  const roomId = match[1];
  const room   = rooms.get(roomId);
  if (!room) { ws.close(1008, 'room not found'); return; }

  // Assign lowest available position 1-4
  const used = new Set([...room.clients.values()].map(c => c.pos));
  let pos = 1;
  while (used.has(pos) && pos <= 4) pos++;
  if (pos > 4) { ws.close(1008, 'room full'); return; }

  room.clients.set(ws, { pos, ready: false });
  console.log(`[room] ${roomId} pos${pos} joined (${room.clients.size}/4)`);

  // Protocol handshake
  ws.send(JSON.stringify({ setpos: pos }));
  if (room.state) ws.send(JSON.stringify(room.state));
  ws.send('"-"');

  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.action === 'PING') return;

    if (msg.action === 'REQUEST_RESET') {
      broadcast(room, JSON.stringify({ action: 'POLL' }));
      return;
    }

    if (msg.action === 'READY') {
      const info = room.clients.get(ws);
      if (info) info.ready = true;
      const allReady = [...room.clients.values()].every(c => c.ready);
      if (allReady) {
        room.state = null;
        for (const [client, info] of room.clients) {
          info.ready = false;
          if (client.readyState === 1) client.send(JSON.stringify({ action: 'RESET' }));
        }
        console.log(`[room] ${roomId} reset`);
      }
      return;
    }

    // Cache latest game state so late-joiners get current snapshot
    if (msg.state !== undefined || msg.ghosts !== undefined || msg.evidence !== undefined) {
      room.state = msg;
    }

    broadcast(room, text, ws);
  });

  ws.on('close', () => {
    const info = room.clients.get(ws);
    room.clients.delete(ws);
    console.log(`[room] ${roomId} pos${info?.pos} left (${room.clients.size}/4)`);
    if (room.clients.size === 0) {
      rooms.delete(roomId);
      console.log(`[room] ${roomId} destroyed (empty)`);
    } else {
      broadcast(room, JSON.stringify({ leave: info?.pos }));
    }
  });

  ws.on('error', (err) => console.error(`[ws] ${roomId} pos${pos}:`, err.message));
});

server.listen(PORT, () => {
  console.log(`Phasmo server  http://localhost:${PORT}`);
  console.log(`Frontend dir   ${FRONTEND_DIR}`);
  console.log(`Data dir       ${DATA_DIR}`);
});
