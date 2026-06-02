const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
});
