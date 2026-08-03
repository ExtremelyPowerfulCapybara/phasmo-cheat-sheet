'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlaySettingsAPI', {
  get:      ()        => ipcRenderer.invoke('overlay-settings-get'),
  update:   (partial)  => ipcRenderer.invoke('overlay-settings-update', partial),
  onUpdate: (cb)       => ipcRenderer.on('overlay-settings-update', (_, d) => cb(d)),
});
