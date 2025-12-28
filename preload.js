const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  onLogMessage: (callback) => ipcRenderer.on('log-message', (_, message) => callback(message)),
  onLogError: (callback) => ipcRenderer.on('log-error', (_, message) => callback(message)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', callback),
  selectFolder: () => ipcRenderer.invoke('select-folder')
});
