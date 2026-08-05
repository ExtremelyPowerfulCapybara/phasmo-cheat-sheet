const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');
const state = require('./state.js');
const overlayBounds  = require('./overlay-bounds.js');
const overlaySettingsStore = require('./overlay-settings-store.js');

const CONFIG_PATH    = path.join(__dirname, 'config.json');

// Writable, machine-local state must live in app.getPath('userData'), not __dirname.
// In a packaged build, __dirname resolves inside the read-only app.asar archive —
// fs.writeFileSync there fails silently (caught by try/catch, never surfacing to the
// user), so settings appear to save but are lost on the next launch. userData is the
// standard Electron location for exactly this kind of generated, per-install data.
const USER_DATA_DIR       = app.getPath('userData');
const SHORTCUTS_PATH      = path.join(USER_DATA_DIR, 'shortcuts.json');
const OVERLAY_SETTINGS_PATH = path.join(USER_DATA_DIR, 'overlay-settings.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: 'http://localhost:3000' }; }
}

const config      = loadConfig();

// In dev, the frontend (index.html, scripts-v10/, etc.) lives at the repo
// root, one level above electron/. In a packaged build it's copied into
// resources/ via electron-builder's extraResources (see Task 6) — the same
// mechanism already used for imgs/assets/lang-v10 since the 2026-08-03
// packaged-persistence fix. This keeps "where do bundled files live" in one
// place instead of scattering __dirname/resourcesPath checks around.
function resolveFrontendRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

const DEFAULTS = {
  toggle_timer:          'Control+1',
  toggle_cooldown_timer: 'Control+2',
  toggle_hunt_timer:     'Control+3',
  toggle_evidence_0:     'Shift+1',
  toggle_evidence_1:     'Shift+2',
  toggle_evidence_2:     'Shift+3',
  toggle_evidence_3:     'Shift+4',
  toggle_evidence_4:     'Shift+5',
  toggle_evidence_5:     'Shift+6',
  toggle_evidence_6:     'Shift+7',
  open_maps:             'Control+M',
  reset_all:             'Control+Shift+X',
};

let mainWindow      = null;
let overlay         = null;   // single combined overlay window
let shortcutsWindow = null;
let currentBindings = {};
let overlaySettings       = overlaySettingsStore.DEFAULTS;
let overlaySettingsWindow = null;

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
      preload:            path.join(__dirname, 'preload.js'),
      contextIsolation:   true,
      nodeIntegration:    false,
      additionalArguments: [`--server-url=${config.serverUrl}`],
    },
  });

  const indexPath = path.join(resolveFrontendRoot(), 'index.html');
  mainWindow.loadFile(indexPath).catch((err) => {
    // Bundled files missing/corrupted is a real failure mode for a packaged
    // install (see design doc "Error Handling") — show it instead of leaving
    // a blank window with no clue why, which was the old loadURL failure mode.
    dialog.showErrorBox(
      'Phasmo Cheat Sheet — failed to load',
      `Could not load the app UI from:\n${indexPath}\n\n${err.message}`
    );
  });

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

  mainWindow.on('closed', () => {
    mainWindow = null;
    // The overlay has no taskbar icon, no title bar, and is unfocusable —
    // a user has no way to close it directly. Without this, closing the
    // main window leaves the overlay (and all global hotkeys) running as
    // an orphan process, only killable via Task Manager. Quit explicitly
    // so closing the main window closes the whole app, as expected.
    app.quit();
  });
}

function createOverlay() {
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
  const bounds = overlayBounds.computeOverlayBounds(
    overlaySettings.corner,
    overlaySettings.scale,
    workAreaSize
  );

  overlay = new BrowserWindow({
    x:      bounds.x,
    y:      bounds.y,
    width:  bounds.width,
    height: bounds.height,
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

  overlay.setIgnoreMouseEvents(true, { forward: true });
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

function openOverlaySettingsWindow() {
  if (overlaySettingsWindow && !overlaySettingsWindow.isDestroyed()) {
    overlaySettingsWindow.focus();
    return;
  }
  overlaySettingsWindow = new BrowserWindow({
    width:       420,
    height:      520,
    title:       'Overlay Settings',
    resizable:   false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload-overlay-settings.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  overlaySettingsWindow.setMenuBarVisibility(false);
  overlaySettingsWindow.loadFile(path.join(__dirname, 'overlay-settings-window.html'));
  overlaySettingsWindow.on('closed', () => { overlaySettingsWindow = null; });
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

// Overlay settings window / overlay → main: read current overlay settings
ipcMain.handle('overlay-settings-get', () => Object.assign({}, overlaySettings));

// Overlay settings window → main: merge + persist + live-apply a partial settings update
ipcMain.handle('overlay-settings-update', (_, partial) => {
  const merged = Object.assign({}, overlaySettings, partial);
  if (partial && partial.panels) {
    merged.panels = Object.assign({}, overlaySettings.panels, partial.panels);
  }
  const next = overlaySettingsStore.normalize(merged);

  const boundsAffectingChange = next.corner !== overlaySettings.corner || next.scale !== overlaySettings.scale;
  overlaySettings = next;
  overlaySettingsStore.save(overlaySettings, OVERLAY_SETTINGS_PATH);

  if (overlay && !overlay.isDestroyed()) {
    if (boundsAffectingChange) {
      const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
      overlay.setBounds(overlayBounds.computeOverlayBounds(overlaySettings.corner, overlaySettings.scale, workAreaSize));
    }
    overlay.webContents.send('overlay-settings-update', overlaySettings);
  }

  return Object.assign({}, overlaySettings);
});

ipcMain.on('open-overlay-settings', () => openOverlaySettingsWindow());

// Web page → main: timer toggle from WS remote action
ipcMain.on('toggle-timer', (_, id) => state.toggleTimer(id));

// Web page → main: reset all from WS remote action or UI button
ipcMain.on('reset-all', () => state.resetAll());

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// A second launch (e.g. a friend double-clicking the installed .exe again
// while it's already running) would otherwise start a second full process
// tree — its own main window, overlay, and global hotkey registrations
// competing with the first instance's. requestSingleInstanceLock() makes the
// second launch quit itself immediately instead; 'second-instance' fires on
// the FIRST instance so it can refocus its own window for the user.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    overlaySettings = overlaySettingsStore.load(OVERLAY_SETTINGS_PATH);

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
    globalShortcut.register('Control+Shift+O', openOverlaySettingsWindow);

    // Checks the GitHub Releases feed independently of the relay server —
    // failures (no network, GitHub unreachable) are swallowed so a broken
    // update check never blocks the app from starting normally.
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[autoUpdater] check failed:', err.message);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  // Defense-in-depth alongside mainWindow's 'closed' handler (which already
  // calls app.quit()): if quit is ever triggered by a path that doesn't go
  // through that handler (e.g. a future Cmd+Q/Alt+F4 handler, or an OS
  // shutdown signal), explicitly destroy every remaining window so none of
  // them — especially the overlay, which has no taskbar icon or way for the
  // user to close it directly — can outlive the main process.
  app.on('before-quit', () => {
    for (const w of [overlay, shortcutsWindow, overlaySettingsWindow]) {
      if (w && !w.isDestroyed()) w.destroy();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
