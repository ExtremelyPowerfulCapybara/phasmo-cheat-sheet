const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH    = path.join(__dirname, 'config.json');
const SHORTCUTS_PATH = path.join(__dirname, 'shortcuts.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: 'http://localhost:3000' }; }
}

const config      = loadConfig();
const FRONTEND_URL = config.serverUrl;

const DEFAULTS = {
  toggle_timer:          'Control+Shift+T',
  toggle_cooldown_timer: 'Control+Shift+C',
  toggle_hunt_timer:     'Control+Shift+H',
  toggleFilterTools:     'Control+Shift+Q',
  bpm_clear:             'Control+Shift+X',
  open_maps:             'Control+Shift+M',
  open_wiki:             'Control+Shift+G',
  closeAll:              'Control+Shift+Left',
  force_reload:          'Control+Shift+F5',
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
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlay = new BrowserWindow({
    width:  300,
    height: height - 40,
    x:      width - 308,
    y:      20,
    transparent:   true,
    alwaysOnTop:   true,
    frame:         false,
    skipTaskbar:   true,
    resizable:     false,
    focusable:     false,
    hasShadow:     false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  overlay.setIgnoreMouseEvents(true);

  overlay.webContents.on('did-finish-load', () => {
    console.log('[overlay] loaded');
    // Confirm electronAPI available in overlay
    overlay.webContents.executeJavaScript(
      `window.electronAPI ? 'api_defined' : 'api_undefined'`
    ).then(r => console.log('[diag] electronAPI in overlay:', r))
     .catch(e => console.error('[diag] overlay check failed:', e.message));
  });

  overlay.loadFile(path.join(__dirname, 'overlays', 'overlay.html'));
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
function exec(fn) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      `(typeof ${fn}==='function') ? ${fn}() : 'not_defined'`
    ).then(r => { if (r === 'not_defined') console.warn('[shortcut] not found:', fn); })
     .catch(e => console.error('[shortcut] error in', fn, e.message));
  }
}

function applyShortcuts(bindings) {
  for (const accel of Object.values(currentBindings)) {
    try { globalShortcut.unregister(accel); } catch {}
  }
  currentBindings = {};
  for (const [fn, accel] of Object.entries(bindings)) {
    if (!accel) continue;
    if (globalShortcut.register(accel, () => exec(fn))) {
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
  try { ok = globalShortcut.register(accel, () => exec(fn)); } catch {}

  if (ok) {
    currentBindings[fn] = accel;
    saveShortcuts(Object.assign({}, currentBindings));
    console.log(`[shortcut] ${fn}: ${old} → ${accel}`);
    return { ok: true };
  }
  // Restore old
  if (old) {
    try { globalShortcut.register(old, () => exec(fn)); } catch {}
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

// ── IPC relay — main window → overlay ────────────────────────────────────────
function toOverlay(channel, data) {
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send(channel, data);
  }
}

ipcMain.on('timer-update',    (_, d) => { console.log('[ipc] timer-update',  d); toOverlay('timer-update',    d); });
ipcMain.on('sanity-update',   (_, d) => { console.log('[ipc] sanity-update', d); toOverlay('sanity-update',   d); });
ipcMain.on('ghost-update',    (_, d) => { toOverlay('ghost-update',    d); });
ipcMain.on('evidence-update', (_, d) => { toOverlay('evidence-update', d); });
ipcMain.on('ghosts-update',   (_, d) => { toOverlay('ghosts-update',   d); });

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createOverlay();

  applyShortcuts(loadShortcuts());

  // Fixed shortcut to open hotkey manager (not configurable)
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
