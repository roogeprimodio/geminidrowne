import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import Sidebar from './components/Sidebar/Sidebar';
import PageList from './components/PageList/PageList';
import Editor from './components/Editor/Editor';
import LogPanel from './components/LogPanel/LogPanel';
import PromptsPanel from './components/PromptsPanel/PromptsPanel';
import TopBar from './components/TopBar';
import SettingsModal from './components/SettingsModal/SettingsModal';
import { extractScriptFromHTML } from './utils/scriptExtractor';
import { electron } from './services/electron';

function App() {
    const [notebooks, setNotebooks] = useState([]);
    const [pages, setPages] = useState([]);
    const [selectedSectionId, setSelectedSectionId] = useState(null);
    const [selectedPageId, setSelectedPageId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isSyncing, setIsSyncing] = useState(false);

    // Theme State
    const [theme, setTheme] = useState(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            return localStorage.getItem('theme') || 'dark';
        }
        return 'dark';
    });

    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    };

    // Apply theme class to document
    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }, [theme]);

    // UI State
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isPageListOpen, setIsPageListOpen] = useState(true);
    const [isTopBarOpen, setIsTopBarOpen] = useState(true);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
    const [isPromptsPanelOpen, setIsPromptsPanelOpen] = useState(false);
    const [promptsPanelWidth, setPromptsPanelWidth] = useState(320);
    const [oneNoteUser, setOneNoteUser] = useState(null);

    // Initial Load: Fetch Notebooks & Check Auth
    useEffect(() => {
        checkAuthAndLoad();
    }, []);

    const getClientId = () => {
        return localStorage.getItem('onenote_client_id');
    };

    const checkAuthAndLoad = async () => {
        const clientId = getClientId();
        if (!clientId) {
            console.log("No Client ID found. Opening settings.");
            setIsSettingsOpen(true);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            const authResult = await electron.oneNoteCheckAuth({ clientId });
            if (authResult.success && authResult.account) {
                setOneNoteUser(authResult.account);
                loadNotebooks();
            } else {
                console.log('Not logged in or no cached token');
            }
        } catch (err) {
            console.error("Auth check failed:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadNotebooks = async () => {
        try {
            setIsLoading(true);
            console.log("Loading notebooks...");

            // Try loading local data first
            console.log("Fetching local data...");
            const localResult = await electron.oneNoteGetLocalData();
            console.log("Local data result:", localResult);

            if (localResult && localResult.notebooks) {
                console.log("Setting notebooks from local data:", localResult.notebooks.length);
                setNotebooks(localResult.notebooks);
            } else {
                console.log("No local data found or empty notebooks list.");
            }

            // Fetch remote notebooks if authenticated
            console.log("Fetching remote notebooks...");
            const result = await electron.oneNoteGetNotebooks();
            console.log("Remote fetch result:", result);

            if (result.success) {
                console.log("Successfully fetched notebooks:", result.notebooks?.length || 0);
                setNotebooks(result.notebooks || []);
                if (!result.notebooks || result.notebooks.length === 0) {
                    setError("No notebooks found. Try clicking 'Sync Notebooks' or create a notebook in OneNote first.");
                }
            } else {
                console.error("Failed to load notebooks", result.error);
                setError(result.error || "Failed to load notebooks. Please try logging in again.");
            }
        } catch (err) {
            console.error("Exception in loadNotebooks:", err);
            setError(err.message || "An error occurred while loading notebooks");
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async () => {
        const clientId = getClientId();
        if (!clientId) {
            setIsSettingsOpen(true);
            return;
        }

        try {
            const result = await electron.oneNoteLogin({ clientId });
            if (result.success) {
                setOneNoteUser(result.account);
                loadNotebooks();
            } else {
                console.error("Login failed:", result.error);
                setError("Login failed: " + result.error);
            }
        } catch (err) {
            console.error("Login exception:", err);
            setError("Login error: " + err.message);
        }
    };

    const handleLogout = () => {
        setOneNoteUser(null);
        setNotebooks([]);
        setPages([]);
        setSelectedSectionId(null);
        setSelectedPageId(null);
    };

    const handleSettingsSaved = () => {
        checkAuthAndLoad();
    };

    const handleSync = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        try {
            const result = await electron.oneNoteSyncAll();
            if (result.success && result.data) {
                setNotebooks(result.data);
            }
        } catch (err) {
            console.error("Sync failed:", err);
            setError("Sync failed: " + err.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleExpand = async (item) => {
        if ((item.type === 'notebook' || item.type === 'sectionGroup') &&
            (!item.sections || item.sections.length === 0) &&
            (!item.childGroups || item.childGroups.length === 0)) {

            try {
                // Fetch children using generic method to support deep nesting
                const result = await electron.oneNoteGetChildren(item.id, item.type);

                if (result.success) {
                    setNotebooks(prev => {
                        const updateNode = (nodes) => {
                            if (!nodes) return [];
                            return nodes.map(node => {
                                if (node.id === item.id) {
                                    // Merge new children
                                    // Note: API returns 'sectionGroups', state uses 'childGroups'
                                    return {
                                        ...node,
                                        sections: result.sections || [],
                                        childGroups: result.sectionGroups || []
                                    };
                                }
                                // Recursively check children
                                if (node.childGroups) {
                                    return { ...node, childGroups: updateNode(node.childGroups) };
                                }
                                return node;
                            });
                        };
                        return updateNode(prev);
                    });
                }
            } catch (err) {
                console.error("Failed to expand:", err);
            }
        }
    };

    const handleSectionSelect = async (item) => {
        if (item.type === 'section') {
            setSelectedSectionId(item.id);
            setPages([]); // Clear pages while loading

            // OPTIMIZATION: Use sync-section to fetch all pages with content in one go (or batches)
            // instead of just getting the list and then fetching content one by one.
            try {
                setIsPageLoading(true);
                // First get the list of pages (lightweight)
                const result = await electron.oneNoteGetPages({ sectionId: item.id });
                if (result.success) {
                    // Set pages initially so user sees the list immediately
                    setPages(result.pages);

                    // Then trigger the sync to get content
                    const syncResult = await electron.oneNoteSyncSection(item.id);
                    if (syncResult.success && syncResult.pages) {
                        // Merge content into existing pages
                        setPages(prev => {
                            const contentMap = new Map(syncResult.pages.map(p => [p.id, p]));
                            return prev.map(p => {
                                const synced = contentMap.get(p.id);
                                return synced ? { ...p, ...synced } : p;
                            });
                        });
                    }
                } else {
                    console.error("Failed to load pages:", result.error);
                }
            } catch (err) {
                console.error("Error loading pages:", err);
            } finally {
                setIsPageLoading(false);
            }
        }
    };

    const handlePageSelect = async (page) => {
        setSelectedPageId(page.id);
        // Content should ideally be loaded by the sync above, but if not (or failed), fallback to on-demand
        if (!page.content) {
            try {
                setIsPageLoading(true);
                const result = await electron.oneNoteGetPageContent(page.id);
                if (result.success) {
                    setPages(prev => prev.map(p =>
                        p.id === page.id ? { ...p, content: result.content } : p
                    ));
                }
            } catch (err) {
                console.error("Failed to fetch content", err);
            } finally {
                setIsPageLoading(false);
            }
        }
    };

    const selectedPage = pages.find(p => p.id === selectedPageId);

    // Build breadcrumb path for selected page
    const getBreadcrumbPath = () => {
        if (!selectedPage || !notebooks.length) return [];

        const path = [];

        // Find the notebook, section group (if any), and section containing this page
        for (const notebook of notebooks) {
            // Check sections directly under notebook
            for (const section of notebook.sections || []) {
                if (section.pages?.some(p => p.id === selectedPageId)) {
                    path.push({ type: 'notebook', name: notebook.displayName });
                    path.push({ type: 'section', name: section.displayName });
                    path.push({ type: 'page', name: selectedPage.title || 'Untitled' });
                    return path;
                }
            }

            // Check section groups
            const checkSectionGroups = (groups, parentPath = []) => {
                for (const group of groups || []) {
                    for (const section of group.sections || []) {
                        if (section.pages?.some(p => p.id === selectedPageId)) {
                            path.push({ type: 'notebook', name: notebook.displayName });
                            parentPath.forEach(g => path.push({ type: 'group', name: g }));
                            path.push({ type: 'group', name: group.displayName });
                            path.push({ type: 'section', name: section.displayName });
                            path.push({ type: 'page', name: selectedPage.title || 'Untitled' });
                            return true;
                        }
                    }

                    // Check nested section groups
                    if (group.sectionGroups?.length) {
                        if (checkSectionGroups(group.sectionGroups, [...parentPath, group.displayName])) {
                            return true;
                        }
                    }
                }
                return false;
            };

            if (checkSectionGroups(notebook.sectionGroups || [])) {
                return path;
            }
        }

        return path;
    };

    const handleRunAutomation = async (type) => {
        if (!selectedPage) return;

        let basePrompt = '';
        if (type === 'chatgpt') {
            try {
                const result = await electron.settingsGet('base_prompt');
                if (result.success && result.value) {
                    basePrompt = result.value;
                } else {
                    // warning logger?
                }
            } catch (e) { console.error('Failed to fetch base prompt', e); }
        }

        const extractedScript = extractScriptFromHTML(selectedPage.content);

        electron.runAutomation(type, {
            mode: type,
            pageId: selectedPage.id,
            page: selectedPage,
            basePrompt,
            extractedScript
        });
    };

    return (
        <div className="h-screen w-screen bg-background text-text-main flex flex-col overflow-hidden">
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onSave={handleSettingsSaved}
            />

            {/* Top Progress Bar */}
            {(isLoading || isPageLoading) && (
                <div className="fixed top-0 left-0 w-full h-1 z-50">
                    <div className="h-full bg-purple-500 animate-[progress_1s_ease-in-out_infinite] origin-left"></div>
                </div>
            )}

            {/* Top Bar */}
            <TopBar
                isOpen={isTopBarOpen}
                toggleTopBar={() => setIsTopBarOpen(!isTopBarOpen)}
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                isPageListOpen={isPageListOpen}
                togglePageList={() => setIsPageListOpen(!isPageListOpen)}
                user={oneNoteUser}
                onLogin={handleLogin}
                onLogout={handleLogout}
                isDarkMode={theme === 'dark'}
                toggleTheme={toggleTheme}
                isLogPanelOpen={isLogPanelOpen}
                toggleLogPanel={() => setIsLogPanelOpen(!isLogPanelOpen)}
                isPromptsPanelOpen={isPromptsPanelOpen}
                togglePromptsPanel={() => setIsPromptsPanelOpen(!isPromptsPanelOpen)}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Sidebar */}
                <div
                    className={`flex-shrink-0 flex flex-col border-r border-border bg-background transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 overflow-hidden border-none'
                        }`}
                >
                    <div className="w-[280px] h-full relative flex-col">
                        <Sidebar
                            data={notebooks}
                            onSelect={handleSectionSelect}
                            onExpand={handleExpand}
                            selectedId={selectedSectionId}
                            onSync={handleSync}
                            isSyncing={isSyncing}
                            onSettings={() => setIsSettingsOpen(true)}
                        />
                    </div>
                </div>

                {/* Page List */}
                <div
                    className={`flex-shrink-0 border-r border-border bg-background transition-all duration-300 ease-in-out ${isPageListOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 overflow-hidden border-none'
                        }`}
                >
                    <div className="w-[280px] h-full relative flex flex-col">
                        <PageList
                            pages={pages}
                            selectedPageId={selectedPageId}
                            onSelectPage={handlePageSelect}
                        />
                    </div>
                </div>

                {/* Editor, Prompts & Logs */}
                <div className="flex-1 flex min-w-0">
                    {/* Main Editor Area */}
                    <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex-1 overflow-hidden relative">
                            <Editor
                                page={selectedPage}
                                isLoading={isPageLoading}
                                onRunAutomation={handleRunAutomation}
                            />
                        </div>
                        {isLogPanelOpen && (
                            <LogPanel className="h-48 flex-shrink-0" />
                        )}
                    </div>

                    {/* Prompts Panel (Right Side) */}
                    {isPromptsPanelOpen && selectedPage && (
                        <PromptsPanel
                            page={selectedPage}
                            breadcrumb={getBreadcrumbPath()}
                            width={promptsPanelWidth}
                            setWidth={setPromptsPanelWidth}
                            onClose={() => setIsPromptsPanelOpen(false)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

export default App;
