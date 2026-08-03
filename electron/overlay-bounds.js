'use strict';

const BASE_WIDTH = 280;
const H_MARGIN   = 8;
const V_MARGIN   = 20;
const MIN_SCALE  = 0.75;
const MAX_SCALE  = 1.5;

function clampScale(scale) {
  const n = typeof scale === 'number' && !Number.isNaN(scale) ? scale : 1.0;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
}

// Mirrors the pre-customization hardcoded layout (x:8, y:20, width:280,
// height:workAreaHeight-40) per corner. Because the window spans the full
// work-area height minus symmetric top/bottom margins, "top" and "bottom"
// corners always produce the same y — only left/right corners change x.
function computeOverlayBounds(corner, scale, workAreaSize) {
  const s      = clampScale(scale);
  const width  = Math.round(BASE_WIDTH * s);
  const height = workAreaSize.height - (V_MARGIN * 2);

  const isRight = corner === 'top-right' || corner === 'bottom-right';
  const x = isRight ? workAreaSize.width - width - H_MARGIN : H_MARGIN;
  const y = V_MARGIN;

  return { x, y, width, height };
}

module.exports = { computeOverlayBounds, clampScale, MIN_SCALE, MAX_SCALE, BASE_WIDTH };
