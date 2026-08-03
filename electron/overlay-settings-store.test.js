'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const store = require('./overlay-settings-store.js');

// normalize() — empty/missing input falls back to full defaults
const normalizedEmpty = store.normalize({});
console.assert(JSON.stringify(normalizedEmpty) === JSON.stringify(store.DEFAULTS),
  'FAIL: normalize({}) should equal DEFAULTS');

const normalizedNull = store.normalize(null);
console.assert(JSON.stringify(normalizedNull) === JSON.stringify(store.DEFAULTS),
  'FAIL: normalize(null) should equal DEFAULTS');

// normalize() — invalid fields fall back individually, valid fields preserved
const partiallyBad = store.normalize({ corner: 'sideways', scale: 1.2, theme: 'invisible', panels: { timers: false } });
console.assert(partiallyBad.corner === store.DEFAULTS.corner, 'FAIL: invalid corner should fall back to default');
console.assert(partiallyBad.scale === 1.2, 'FAIL: valid scale should be preserved');
console.assert(partiallyBad.theme === store.DEFAULTS.theme, 'FAIL: invalid theme should fall back to default');
console.assert(partiallyBad.panels.timers === false, 'FAIL: valid panel override should be preserved');
console.assert(partiallyBad.panels.evidence === true, 'FAIL: unspecified panel should default to true');

// normalize() — out-of-range scale gets clamped
const clamped = store.normalize({ scale: 50 });
console.assert(clamped.scale === 1.5, 'FAIL: out-of-range scale should clamp to MAX_SCALE (1.5)');

// load() — missing file returns defaults, does not throw
const missingPath = path.join(os.tmpdir(), 'overlay-settings-test-missing-' + Date.now() + '.json');
const loadedMissing = store.load(missingPath);
console.assert(JSON.stringify(loadedMissing) === JSON.stringify(store.DEFAULTS),
  'FAIL: load() of a missing file should return DEFAULTS');

// load() — corrupt file returns defaults, does not throw
const corruptPath = path.join(os.tmpdir(), 'overlay-settings-test-corrupt-' + Date.now() + '.json');
fs.writeFileSync(corruptPath, '{ not valid json');
const loadedCorrupt = store.load(corruptPath);
console.assert(JSON.stringify(loadedCorrupt) === JSON.stringify(store.DEFAULTS),
  'FAIL: load() of a corrupt file should return DEFAULTS');
fs.unlinkSync(corruptPath);

// save() then load() round-trips correctly
const roundTripPath = path.join(os.tmpdir(), 'overlay-settings-test-roundtrip-' + Date.now() + '.json');
const custom = { corner: 'bottom-right', scale: 1.25, theme: 'minimal', panels: { timers: true, evidence: false, ghosts: true } };
store.save(custom, roundTripPath);
const roundTripped = store.load(roundTripPath);
console.assert(JSON.stringify(roundTripped) === JSON.stringify(custom),
  'FAIL: save() then load() should round-trip the exact settings');
fs.unlinkSync(roundTripPath);

console.log('All overlay-settings-store.js tests passed');
