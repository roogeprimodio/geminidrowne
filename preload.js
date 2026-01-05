const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDownload: payload => ipcRenderer.invoke('start-download', payload),
  onLogMessage: callback => ipcRenderer.on('log-message', (_, message) => callback(message)),
  onLogError: callback => ipcRenderer.on('log-error', (_, message) => callback(message)),
  onDownloadComplete: callback => ipcRenderer.on('download-complete', callback),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getAutomationState: () => ipcRenderer.invoke('automation-state:get'),
  updateAutomationState: state => ipcRenderer.invoke('automation-state:update', state),
  resetAutomationState: () => ipcRenderer.invoke('automation-state:reset'),
  resetAutomationStateAll: () => ipcRenderer.invoke('automation-state:reset-all'),
  runAutomation: stage => ipcRenderer.invoke('automation-run', { stage }),
  setAutomationControl: payload => ipcRenderer.invoke('automation-control:set', payload),
  extractPromptsFromChat: chatUrl => ipcRenderer.invoke('extract-prompts-from-chat', { chatUrl }),
  onAutomationState: callback =>
    ipcRenderer.on('automation-state', (_, state) => callback(state)),
  onAutomationLog: callback =>
    ipcRenderer.on('automation-log', (_, payload) => callback(payload)),
  onAutomationRunStatus: callback =>
    ipcRenderer.on('automation-run-status', (_, payload) => callback(payload))
});
