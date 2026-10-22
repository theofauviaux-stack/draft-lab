const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftlab', {
  load: (opts) => ipcRenderer.invoke('data:load', opts),
  refresh: (opts) => ipcRenderer.invoke('data:refresh', opts),
  onUpdated: (cb) => ipcRenderer.on('data:updated', (_e, data) => cb(data)),
  open: (url) => ipcRenderer.invoke('open:external', url),
  loadTeam: (opts) => ipcRenderer.invoke('opgg:team', opts),
  version: () => ipcRenderer.invoke('app:version'),
  lastUpdate: () => ipcRenderer.invoke('update:last'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  restart: () => ipcRenderer.invoke('update:restart'),
  quit: () => ipcRenderer.invoke('app:quit'),
  windowSizes: () => ipcRenderer.invoke('window:sizes'),
  setWindowSize: (id) => ipcRenderer.invoke('window:set', id),
  onWindowChanged: (cb) => ipcRenderer.on('window:changed', (_e, id) => cb(id)),
  liveStart: () => ipcRenderer.invoke('live:start'),
  liveStop: () => ipcRenderer.invoke('live:stop'),
  onLive: (cb) => ipcRenderer.on('live:update', (_e, d) => cb(d)),
  detail: (cid, lane) => ipcRenderer.invoke('lola:detail', { cid, lane }),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, st) => cb(st))
});
