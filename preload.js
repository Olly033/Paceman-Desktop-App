const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pacemanAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  downloadVod: (opts) => ipcRenderer.invoke('download-vod', opts),
  fetchJSON: (url) => ipcRenderer.invoke('fetch-json', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getProtocolArgs: () => ipcRenderer.invoke('get-protocol-args')
});

ipcRenderer.on('protocol-args', (event, args) => {
  window.dispatchEvent(new CustomEvent('paceman-protocol-args', { detail: args }));
});
