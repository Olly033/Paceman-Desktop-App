const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pacemanAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadVod: (opts) => ipcRenderer.invoke('download-vod', opts),
  cancelDownloadVod: (downloadId) => ipcRenderer.invoke('cancel-download-vod', downloadId),
  fetchJSON: (url) => ipcRenderer.invoke('fetch-json', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getProtocolArgs: () => ipcRenderer.invoke('get-protocol-args'),
  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  showOpenDialog: (opts) => ipcRenderer.invoke('show-open-dialog', opts),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  startOverlayServer: () => ipcRenderer.invoke('start-overlay-server'),
  stopOverlayServer: () => ipcRenderer.invoke('stop-overlay-server'),
  updateOverlayPlayer: (name) => ipcRenderer.invoke('update-overlay-player', name),
  updateOverlayPngPath: (pngPath) => ipcRenderer.invoke('update-overlay-png-path', pngPath)
});

ipcRenderer.on('protocol-args', (event, args) => {
  window.dispatchEvent(new CustomEvent('paceman-protocol-args', { detail: args }));
});

ipcRenderer.on('download-vod-progress', (event, data) => {
  window.dispatchEvent(new CustomEvent('paceman-download-vod-progress', { detail: data }));
});
