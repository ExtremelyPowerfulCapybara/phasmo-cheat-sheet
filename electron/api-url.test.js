'use strict';
const { buildApiUrl, buildWsUrl } = require('./api-url.js');

// buildApiUrl — no serverUrl (browser fallback / same-origin mode)
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', '') === '/phasmophobia/data/ghosts.json',
  'FAIL: falsy serverUrl should return path unchanged');
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', null) === '/phasmophobia/data/ghosts.json',
  'FAIL: null serverUrl should return path unchanged');
console.assert(buildApiUrl('/phasmophobia/data/ghosts.json', undefined) === '/phasmophobia/data/ghosts.json',
  'FAIL: undefined serverUrl should return path unchanged');

// buildApiUrl — serverUrl set (bundled app mode)
console.assert(
  buildApiUrl('/phasmophobia/data/ghosts.json', 'https://phasmo.mustardhq.dev') === 'https://phasmo.mustardhq.dev/phasmophobia/data/ghosts.json',
  'FAIL: should join serverUrl and path'
);
console.assert(
  buildApiUrl('/create-room', 'https://phasmo.mustardhq.dev/') === 'https://phasmo.mustardhq.dev/create-room',
  'FAIL: should strip a trailing slash from serverUrl before joining'
);
console.assert(
  buildApiUrl('/phasmophobia/data/maps', 'http://localhost:3000') === 'http://localhost:3000/phasmophobia/data/maps',
  'FAIL: should work with http (dev server) as well as https'
);

// buildWsUrl — serverUrl set, https -> wss
console.assert(
  buildWsUrl('/room/abc123', 'https://phasmo.mustardhq.dev', null) === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: https serverUrl should become wss'
);
// buildWsUrl — serverUrl set, http -> ws
console.assert(
  buildWsUrl('/room/abc123', 'http://localhost:3000', null) === 'ws://localhost:3000/room/abc123',
  'FAIL: http serverUrl should become ws'
);
// buildWsUrl — serverUrl set with trailing slash
console.assert(
  buildWsUrl('/room/abc123', 'https://phasmo.mustardhq.dev/', null) === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: should strip trailing slash before joining'
);
// buildWsUrl — no serverUrl, falls back to fallbackOrigin (browser fallback mode)
console.assert(
  buildWsUrl('/room/abc123', '', 'https://phasmo.mustardhq.dev') === 'wss://phasmo.mustardhq.dev/room/abc123',
  'FAIL: falsy serverUrl should fall back to fallbackOrigin'
);
console.assert(
  buildWsUrl('/room/abc123', null, 'http://localhost:3000') === 'ws://localhost:3000/room/abc123',
  'FAIL: falsy serverUrl should fall back to fallbackOrigin (http)'
);
// buildWsUrl — neither provided
let threw = false;
try { buildWsUrl('/room/abc123', '', ''); } catch (e) { threw = true; }
console.assert(threw, 'FAIL: should throw when neither serverUrl nor fallbackOrigin is provided');

console.log('All api-url.js tests passed');
