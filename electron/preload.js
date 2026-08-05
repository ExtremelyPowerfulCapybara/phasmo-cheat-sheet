'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// additionalArguments (set on the BrowserWindow in main.js) land in
// process.argv here. This — not requiring config.json directly — is how the
// preload learns the API/WS base URL, because sandboxed preloads can't
// require('fs')/require('path') (see electron/state.js comment history).
function getServerUrlFromArgv() {
  const arg = process.argv.find((a) => a.startsWith('--server-url='));
  return arg ? arg.slice('--server-url='.length) : '';
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Web page → main
  toggleTimer:        (id)   => ipcRenderer.send('toggle-timer',   id),
  sendEvidenceResult: (data) => ipcRenderer.send('evidence-result', data),
  resetAll:           ()     => ipcRenderer.send('reset-all'),

  // Main → web page
  onToggleEvidence:   (cb) => ipcRenderer.on('toggle-evidence',    (_, index) => cb(index)),
  onOpenMaps:         (cb) => ipcRenderer.on('open-maps',          ()         => cb()),
  onWsBroadcastTimer: (cb) => ipcRenderer.on('ws-broadcast-timer', (_, data)  => cb(data)),
  onResetAll:         (cb) => ipcRenderer.on('reset-all',          ()         => cb()),

  // Hotkey manager (unchanged)
  getShortcuts:      ()          => ipcRenderer.invoke('get-shortcuts'),
  setShortcut:       (fn, accel) => ipcRenderer.invoke('set-shortcut', { fn, accel }),
  resetShortcuts:    ()          => ipcRenderer.invoke('reset-shortcuts'),
  openHotkeyManager: ()          => ipcRenderer.send('open-hotkey-manager'),

  // Bundled-frontend API/WS base URL (see electron/api-url.js consumers)
  serverUrl: getServerUrlFromArgv(),
});
