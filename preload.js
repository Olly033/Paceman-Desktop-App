const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pacemanAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  installUpdate: () => ipcRenderer.invoke('install-update')
});
