'use strict';
const { computeOverlayBounds, clampScale, MIN_SCALE, MAX_SCALE, BASE_WIDTH } = require('./overlay-bounds.js');

const workArea = { width: 1920, height: 1080 };

// clampScale
console.assert(clampScale(1.0) === 1.0, 'FAIL: 1.0 should pass through unchanged');
console.assert(clampScale(0.5) === MIN_SCALE, 'FAIL: below-range scale should clamp to MIN_SCALE');
console.assert(clampScale(3) === MAX_SCALE, 'FAIL: above-range scale should clamp to MAX_SCALE');
console.assert(clampScale(undefined) === 1.0, 'FAIL: missing scale should default to 1.0');
console.assert(clampScale('bogus') === 1.0, 'FAIL: non-numeric scale should default to 1.0');
console.assert(clampScale(NaN) === 1.0, 'FAIL: NaN scale should default to 1.0');

// computeOverlayBounds — corners at scale 1.0
const tl = computeOverlayBounds('top-left', 1.0, workArea);
console.assert(tl.x === 8 && tl.y === 20, 'FAIL: top-left should be x=8,y=20');
console.assert(tl.width === BASE_WIDTH, 'FAIL: width should equal BASE_WIDTH at scale 1.0');
console.assert(tl.height === workArea.height - 40, 'FAIL: height should be workArea.height-40');

const tr = computeOverlayBounds('top-right', 1.0, workArea);
console.assert(tr.x === workArea.width - BASE_WIDTH - 8, 'FAIL: top-right x should hug the right edge');
console.assert(tr.y === 20, 'FAIL: top-right y should match top-left y');

const bl = computeOverlayBounds('bottom-left', 1.0, workArea);
console.assert(bl.x === 8 && bl.y === 20, 'FAIL: bottom-left should match top-left (full-height window)');

const br = computeOverlayBounds('bottom-right', 1.0, workArea);
console.assert(br.x === tr.x && br.y === 20, 'FAIL: bottom-right should match top-right x');

// computeOverlayBounds — scale affects width and (for right corners) x
const trScaled = computeOverlayBounds('top-right', 1.5, workArea);
console.assert(trScaled.width === Math.round(BASE_WIDTH * 1.5), 'FAIL: width should scale with scale factor');
console.assert(trScaled.x === workArea.width - trScaled.width - 8, 'FAIL: right-corner x must account for scaled width');

// computeOverlayBounds — out-of-range scale gets clamped internally
const clampedBounds = computeOverlayBounds('top-left', 99, workArea);
console.assert(clampedBounds.width === Math.round(BASE_WIDTH * MAX_SCALE), 'FAIL: bounds computation should clamp scale internally');

console.log('All overlay-bounds.js tests passed');
