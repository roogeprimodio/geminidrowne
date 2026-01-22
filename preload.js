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
  runAutomation: (stage, options = {}) => ipcRenderer.invoke('automation-run', { stage, options }),
  setAutomationControl: payload => ipcRenderer.invoke('automation-control:set', payload),
  repairBrowsers: () => ipcRenderer.invoke('repair-browsers'),
  extractPromptsFromChat: chatUrl => ipcRenderer.invoke('extract-prompts-from-chat', { chatUrl }),
  oneNoteCheckAuth: (credentials) => ipcRenderer.invoke('onenote-check-auth', credentials),
  oneNoteLogin: (credentials) => ipcRenderer.invoke('onenote-login', credentials),
  oneNoteGetRecentPages: () => ipcRenderer.invoke('onenote-get-pages'),
  oneNoteGetNotebooks: () => ipcRenderer.invoke('onenote-get-notebooks'),
  oneNoteGetChildren: (payload) => ipcRenderer.invoke('onenote-get-children', payload),
  oneNoteGetPages: (payload) => ipcRenderer.invoke('onenote-get-pages', payload),
  oneNoteSyncPage: (payload) => ipcRenderer.invoke('onenote-sync-page', payload),
  oneNoteSyncHierarchy: (payload) => ipcRenderer.invoke('onenote-sync-hierarchy', payload),
  onAutomationState: callback =>
    ipcRenderer.on('automation-state', (_, state) => callback(state)),
  onAutomationLog: callback =>
    ipcRenderer.on('automation-log', (_, payload) => callback(payload)),
  onAutomationRunStatus: callback =>
    ipcRenderer.on('automation-run-status', (_, payload) => callback(payload)),
  onEngineStatus: callback =>
    ipcRenderer.on('automation-engine-status', (_, payload) => callback(payload))
});
