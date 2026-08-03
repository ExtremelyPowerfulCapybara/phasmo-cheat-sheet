const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const state = require('./state.js');

const CONFIG_PATH    = path.join(__dirname, 'config.json');
const SHORTCUTS_PATH = path.join(__dirname, 'shortcuts.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: 'http://localhost:3000' }; }
}

const config      = loadConfig();
const FRONTEND_URL = config.serverUrl;

const DEFAULTS = {
  toggle_timer:          'Shift+F1',
  toggle_cooldown_timer: 'Shift+F2',
  toggle_hunt_timer:     'Shift+F3',
  toggle_evidence_0:     'Control+1',
  toggle_evidence_1:     'Control+2',
  toggle_evidence_2:     'Control+3',
  toggle_evidence_3:     'Control+4',
  toggle_evidence_4:     'Control+5',
  toggle_evidence_5:     'Control+6',
  toggle_evidence_6:     'Control+7',
  open_maps:             'Control+M',
  reset_all:             'Control+Shift+X',
};

let mainWindow      = null;
let overlay         = null;   // single combined overlay window
let shortcutsWindow = null;
let currentBindings = {};

// ── Shortcuts persistence ──────────────────────────────────────────────────────
function loadShortcuts() {
  try {
    const saved = JSON.parse(fs.readFileSync(SHORTCUTS_PATH, 'utf8'));
    return Object.assign({}, DEFAULTS, saved);
  } catch {
    return Object.assign({}, DEFAULTS);
  }
}

function saveShortcuts(bindings) {
  try { fs.writeFileSync(SHORTCUTS_PATH, JSON.stringify(bindings, null, 2)); }
  catch (e) { console.error('[shortcuts] save failed:', e.message); }
}

// ── Helper functions ───────────────────────────────────────────────────────────
function broadcastTimerToggle(id) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ws-broadcast-timer', { id });
  }
}

function execEvidenceToggle(index) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toggle-evidence', index);
  }
}

function execOpenMaps() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('open-maps');
  }
}

let shortcutHandlers = {};

function buildHandlers() {
  shortcutHandlers = {
    toggle_timer:          () => { state.toggleTimer('smudge');   broadcastTimerToggle('smudge'); },
    toggle_cooldown_timer: () => { state.toggleTimer('cooldown'); broadcastTimerToggle('cooldown'); },
    toggle_hunt_timer:     () => { state.toggleTimer('hunt');     broadcastTimerToggle('hunt'); },
    toggle_evidence_0:     () => execEvidenceToggle(0),
    toggle_evidence_1:     () => execEvidenceToggle(1),
    toggle_evidence_2:     () => execEvidenceToggle(2),
    toggle_evidence_3:     () => execEvidenceToggle(3),
    toggle_evidence_4:     () => execEvidenceToggle(4),
    toggle_evidence_5:     () => execEvidenceToggle(5),
    toggle_evidence_6:     () => execEvidenceToggle(6),
    open_maps:             () => execOpenMaps(),
    reset_all:             () => {
      state.resetAll();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reset-all');
    },
  };
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 900,
    title:  'Phasmo Cheat Sheet',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Give the Node server ~1.5 s to start
  setTimeout(() => {
    mainWindow.loadURL(FRONTEND_URL).catch(() => {
      setTimeout(() => mainWindow.loadURL(FRONTEND_URL).catch(console.error), 1000);
    });
  }, 1500);

  mainWindow.webContents.on('console-message', (_, level, msg, line, sourceId) => {
    console.log('[main-console]', msg, `(${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Verify preload injected correctly
    mainWindow.webContents.executeJavaScript(
      `window.electronAPI ? 'api_defined' : 'api_undefined'`
    ).then(r => console.log('[diag] electronAPI in main window:', r))
     .catch(e => console.error('[diag] check failed:', e.message));

    // Bring window to front
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createOverlay() {
  const { height } = screen.getPrimaryDisplay().workAreaSize;

  overlay = new BrowserWindow({
    width:  280,
    height: height - 40,
    x:      8,
    y:      20,
    transparent:   true,
    alwaysOnTop:   true,
    frame:         false,
    skipTaskbar:   true,
    resizable:     false,
    focusable:     false,
    hasShadow:     false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(__dirname, 'overlays', 'overlay.html'));
  overlay.webContents.on('did-finish-load', () => {
    console.log('[overlay] loaded');
    overlay.webContents.executeJavaScript(
      `window.overlayAPI ? 'overlayAPI_defined' : 'overlayAPI_undefined'`
    ).then(r => console.log('[overlay] overlayAPI:', r)).catch(e => console.error('[overlay] check failed:', e.message));
  });
  overlay.webContents.on('console-message', (_, level, msg) => console.log('[overlay-console]', msg));
}

function openHotkeyManager() {
  if (shortcutsWindow && !shortcutsWindow.isDestroyed()) {
    shortcutsWindow.focus();
    return;
  }
  shortcutsWindow = new BrowserWindow({
    width:       460,
    height:      480,
    title:       'Hotkey Manager',
    resizable:   false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  shortcutsWindow.setMenuBarVisibility(false);
  shortcutsWindow.loadFile(path.join(__dirname, 'shortcuts-window.html'));
  shortcutsWindow.on('closed', () => { shortcutsWindow = null; });
}

// ── Shortcuts ─────────────────────────────────────────────────────────────────
function applyShortcuts(bindings) {
  for (const accel of Object.values(currentBindings)) {
    try { globalShortcut.unregister(accel); } catch {}
  }
  currentBindings = {};
  for (const [fn, accel] of Object.entries(bindings)) {
    if (!accel || !shortcutHandlers[fn]) continue;
    if (globalShortcut.register(accel, shortcutHandlers[fn])) {
      currentBindings[fn] = accel;
    } else {
      console.warn('[shortcut] failed to register:', accel, 'for', fn);
    }
  }
}

// ── IPC — hotkey manager ───────────────────────────────────────────────────────
ipcMain.handle('get-shortcuts', () => Object.assign({}, currentBindings));

ipcMain.handle('set-shortcut', (_, { fn, accel }) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, fn))
    return { ok: false, error: 'Unknown action' };

  const old = currentBindings[fn];
  if (old) { try { globalShortcut.unregister(old); } catch {} }

  let ok = false;
  try { ok = globalShortcut.register(accel, shortcutHandlers[fn]); } catch {}

  if (ok) {
    currentBindings[fn] = accel;
    saveShortcuts(Object.assign({}, currentBindings));
    console.log(`[shortcut] ${fn}: ${old} → ${accel}`);
    return { ok: true };
  }
  if (old) {
    try { globalShortcut.register(old, shortcutHandlers[fn]); } catch {}
    currentBindings[fn] = old;
  }
  return { ok: false, error: `Could not register ${accel}` };
});

ipcMain.handle('reset-shortcuts', () => {
  applyShortcuts(DEFAULTS);
  saveShortcuts(DEFAULTS);
  return Object.assign({}, currentBindings);
});

ipcMain.on('open-hotkey-manager', () => openHotkeyManager());

// ── IPC — web page → main ─────────────────────────────────────────────────────
// Web page → main: relay evidence result to overlay
ipcMain.on('evidence-result', (_, data) => {
  console.log('[evidence-result] received, ghosts:', data && data.ghostList && data.ghostList.length);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('evidence-update', data);
  else console.warn('[evidence-result] overlay not ready');
});

// Overlay → main: toggle overlay's click-through state for hover-driven interactivity
ipcMain.on('overlay-set-interactive', (_, interactive) => {
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(!interactive, { forward: true });
  }
});

// Overlay → main: evidence icon clicked; reuse the same path as Ctrl+1..7 hotkeys
ipcMain.on('overlay-toggle-evidence', (_, index) => {
  console.log('[overlay-toggle-evidence] index:', index);
  execEvidenceToggle(index);
});

// Web page → main: timer toggle from WS remote action
ipcMain.on('toggle-timer', (_, id) => state.toggleTimer(id));

// Web page → main: reset all from WS remote action or UI button
ipcMain.on('reset-all', () => state.resetAll());

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createOverlay();

  buildHandlers();

  state.setBroadcast((channel, data) => {
    console.log('[broadcast]', channel, JSON.stringify(data).slice(0, 80));
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(channel, data);
    } else {
      console.warn('[broadcast] overlay not ready or destroyed');
    }
  });

  applyShortcuts(loadShortcuts());
  globalShortcut.register('Control+Shift+K', openHotkeyManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
