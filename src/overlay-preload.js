// Fenêtre overlay : reçoit seulement les données du panneau
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onUpdate: (cb) => ipcRenderer.on('overlay:update', (_e, d) => cb(d)),
  onMove: (cb) => ipcRenderer.on('overlay:move', (_e, on) => cb(on))
});
