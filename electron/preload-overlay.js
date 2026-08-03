'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onTimerUpdate:    (cb) => ipcRenderer.on('timer-update',    (_, d) => cb(d)),
  onEvidenceUpdate: (cb) => ipcRenderer.on('evidence-update', (_, d) => cb(d)),
  onPlayAudio:      (cb) => ipcRenderer.on('play-audio',      (_, d) => cb(d)),
  onResetAll:       (cb) => ipcRenderer.on('reset-all',       ()     => cb()),
});
