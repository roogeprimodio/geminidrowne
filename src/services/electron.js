// Wrapper for Electron IPC exposed via preload.js
// Falls back to mock data if running in browser (non-Electron) environment

const isElectron = typeof window !== 'undefined' && window.electronAPI;

export const electron = {
    // Automation
    runAutomation: (stage, options) => isElectron ? window.electronAPI.runAutomation(stage, options) : console.log('Run automation', stage, options),
    getAutomationState: () => isElectron ? window.electronAPI.getAutomationState() : Promise.resolve({}),
    updateAutomationState: (state) => isElectron ? window.electronAPI.updateAutomationState(state) : console.log('Update state'),

    // OneNote
    oneNoteGetNotebooks: () => isElectron ? window.electronAPI.oneNoteGetNotebooks() : Promise.resolve({ success: true, notebooks: [] }),
    oneNoteGetChildren: (parentId, parentType) => isElectron ? window.electronAPI.oneNoteGetChildren({ parentId, parentType }) : Promise.resolve({ success: true, sectionGroups: [], sections: [] }),
    oneNoteGetSections: (parentId) => isElectron ? window.electronAPI.oneNoteGetChildren({ parentId, parentType: 'notebook' }) : Promise.resolve({ success: true, sections: [] }),
    oneNoteGetPages: (payload) => isElectron ? window.electronAPI.oneNoteGetPages(payload) : Promise.resolve({ success: true, pages: [] }),
    oneNoteGetPageContent: (pageId) => isElectron ? window.electronAPI.oneNoteGetPageContent(pageId) : Promise.resolve({ success: true, content: 'Mock Content' }),
    oneNoteSyncSection: (sectionId) => isElectron ? window.electronAPI.oneNoteSyncSection({ sectionId }) : Promise.resolve({ success: true, pages: [] }),
    oneNoteGetLocalData: () => isElectron ? window.electronAPI.oneNoteGetLocalData() : Promise.resolve({ notebooks: [], lastSync: null }),
    oneNoteSyncAll: () => isElectron ? window.electronAPI.oneNoteSyncAll() : Promise.resolve({ success: true, data: [] }),
    oneNoteCheckAuth: (creds) => isElectron ? window.electronAPI.oneNoteCheckAuth(creds) : Promise.resolve({ success: true }),
    oneNoteLogin: (creds) => isElectron ? window.electronAPI.oneNoteLogin(creds) : Promise.resolve({ success: true, account: { username: 'Mock User' } }),

    // Platform
    selectFolder: () => isElectron ? window.electronAPI.selectFolder() : Promise.resolve(null),
    onLogMessage: (callback) => {
        if (isElectron) {
            window.electronAPI.onLogMessage(callback);
            // Return cleanup function if needed in future
            return () => { };
        }
    },
    onLogError: (callback) => isElectron && window.electronAPI.onLogError(callback),
};
