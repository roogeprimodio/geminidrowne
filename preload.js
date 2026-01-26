const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startDownload: payload => ipcRenderer.invoke('start-download', payload),
  onLogMessage: callback => {
    const subscription = (_, message) => callback(message);
    ipcRenderer.on('log-message', subscription);
    return () => ipcRenderer.removeListener('log-message', subscription);
  },
  onLogError: callback => {
    const subscription = (_, message) => callback(message);
    ipcRenderer.on('log-error', subscription);
    return () => ipcRenderer.removeListener('log-error', subscription);
  },
  onDownloadComplete: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('download-complete', subscription);
    return () => ipcRenderer.removeListener('download-complete', subscription);
  },
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
  oneNoteGetPageContent: (pageId) => ipcRenderer.invoke('onenote-get-page-content', { pageId }),
  oneNoteGetLocalData: () => ipcRenderer.invoke('onenote-get-local-data'),
  oneNoteSyncAll: () => ipcRenderer.invoke('onenote-sync-all'),
  oneNoteSyncPage: (payload) => ipcRenderer.invoke('onenote-sync-page', payload),
  oneNoteSyncHierarchy: (data) => ipcRenderer.invoke('onenote-sync-hierarchy', data),
  oneNoteSyncCompleteNotebook: (data) => ipcRenderer.invoke('onenote-sync-complete-notebook', data),
  oneNoteFetchStructure: (data) => ipcRenderer.invoke('onenote-fetch-structure', data),
  oneNoteFetchSectionContent: (data) => ipcRenderer.invoke('onenote-fetch-section-content', data),
  oneNoteCreateStructure: (data) => ipcRenderer.invoke('onenote-create-structure', data),
  promptsGet: (pageId) => ipcRenderer.invoke('prompts-get', { pageId }),
  promptsAdd: (payload) => ipcRenderer.invoke('prompts-add', payload),
  promptsDelete: (id) => ipcRenderer.invoke('prompts-delete', { id }),
  promptsToggleSkip: (payload) => ipcRenderer.invoke('prompts-toggle-skip', payload),
  promptsToggleSkipAll: (payload) => ipcRenderer.invoke('prompts-toggle-skip-all', payload),
  settingsGet: (key) => ipcRenderer.invoke('settings-get', { key }),
  settingsSave: (payload) => ipcRenderer.invoke('settings-save', payload),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFolder: (path) => ipcRenderer.invoke('open-folder', { path }),
  scanPageImages: (pageId) => ipcRenderer.invoke('scan-page-images', { pageId }),
  onAutomationState: callback => {
    const subscription = (_, state) => callback(state);
    ipcRenderer.on('automation-state', subscription);
    return () => ipcRenderer.removeListener('automation-state', subscription);
  },
  onAutomationLog: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('automation-log', subscription);
    return () => ipcRenderer.removeListener('automation-log', subscription);
  },
  onAutomationRunStatus: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('automation-run-status', subscription);
    return () => ipcRenderer.removeListener('automation-run-status', subscription);
  },
  onEngineStatus: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('automation-engine-status', subscription);
    return () => ipcRenderer.removeListener('automation-engine-status', subscription);
  },
  onAutomationAssetCreated: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('automation-asset-created', subscription);
    return () => ipcRenderer.removeListener('automation-asset-created', subscription);
  },
  onPromptsUpdated: callback => {
    const subscription = (_, payload) => callback(payload);
    ipcRenderer.on('prompts-updated', subscription);
    return () => ipcRenderer.removeListener('prompts-updated', subscription);
  },
  onOneNoteSyncProgress: callback => {
    const subscription = (_, progress) => callback(progress);
    ipcRenderer.on('onenote-sync-progress', subscription);
    return () => ipcRenderer.removeListener('onenote-sync-progress', subscription);
  }
});
