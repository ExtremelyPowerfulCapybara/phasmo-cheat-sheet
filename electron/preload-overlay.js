'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const fs   = require('fs');
const path = require('path');

let serverUrl = 'http://localhost:3000';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  serverUrl = cfg.serverUrl || serverUrl;
} catch {}

contextBridge.exposeInMainWorld('overlayAPI', {
  serverUrl,
  onTimerUpdate:    (cb) => ipcRenderer.on('timer-update',    (_, d) => cb(d)),
  onEvidenceUpdate: (cb) => ipcRenderer.on('evidence-update', (_, d) => cb(d)),
  onPlayAudio:      (cb) => ipcRenderer.on('play-audio',      (_, d) => cb(d)),
  onResetAll:       (cb) => ipcRenderer.on('reset-all',       ()     => cb()),
});
