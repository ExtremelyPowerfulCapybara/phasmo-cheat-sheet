'use strict';
const fs   = require('fs');
const path = require('path');
const { clampScale } = require('./overlay-bounds.js');

const SETTINGS_PATH = path.join(__dirname, 'overlay-settings.json');

const DEFAULTS = {
  corner: 'top-left',
  scale:  1.0,
  theme:  'default',
  panels: { timers: true, evidence: true, ghosts: true },
};

const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const VALID_THEMES  = ['default', 'high-contrast', 'colorblind-friendly', 'minimal'];

function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    corner: VALID_CORNERS.includes(src.corner) ? src.corner : DEFAULTS.corner,
    scale:  clampScale(src.scale),
    theme:  VALID_THEMES.includes(src.theme) ? src.theme : DEFAULTS.theme,
    panels: Object.assign(
      {},
      DEFAULTS.panels,
      src.panels && typeof src.panels === 'object' ? src.panels : {}
    ),
  };
}

function load(settingsPath = SETTINGS_PATH) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { raw = {}; }
  return normalize(raw);
}

function save(settings, settingsPath = SETTINGS_PATH) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('[overlay-settings] save failed:', e.message); }
}

module.exports = { load, save, normalize, DEFAULTS, VALID_CORNERS, VALID_THEMES, SETTINGS_PATH };
