const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pacemanAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchJSON: (url) => ipcRenderer.invoke('fetch-json', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates')
});
