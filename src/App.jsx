import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import Sidebar from './components/Sidebar/Sidebar';
import PageList from './components/PageList/PageList';
import Editor from './components/Editor/Editor';
import LogPanel from './components/LogPanel/LogPanel';
import PromptsPanel from './components/PromptsPanel/PromptsPanel';
import TopBar from './components/TopBar';
import SettingsModal from './components/SettingsModal/SettingsModal';
import BatchControlPanel from './components/BatchControlPanel/BatchControlPanel';
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

    // Batch run state
    const [batchProgress, setBatchProgress] = useState(null); // null = hidden
    const [isPaused, setIsPaused] = useState(false);
    const [pageStatuses, setPageStatuses] = useState({});   // { [pageId]: contentStatus }
    const [promptCounts, setPromptCounts] = useState({});   // { [pageId]: number }
    const [cachingPageIds, setCachingPageIds] = useState(new Set()); // pages being bg-cached
    const [syncStats, setSyncStats] = useState({ total: 0, done: 0 }); // global sync counter

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

    // Initial Load & Event Listeners
    useEffect(() => {
        checkAuthAndLoad();

        const unsubs = [];
        if (electron.onOneNotePageUpdated) {
            unsubs.push(electron.onOneNotePageUpdated(({ pageId, content }) => {
                setPages(prev => prev.map(p =>
                    p.id === pageId ? { ...p, content } : p
                ));
            }));
        }

        // Batch progress event from automation-runner
        if (electron.onAutomationBatchProgress) {
            const unsub = electron.onAutomationBatchProgress((progressData) => {
                setBatchProgress(progressData);
                if (progressData.status === 'done' || progressData.status === 'stopped' || progressData.status === 'idle') {
                    setIsPaused(false);
                }
            });
            if (unsub) unsubs.push(unsub);
        }

        // Background cache — total pages incoming for this section
        if (electron.onBgCacheTotal) {
            const unsub = electron.onBgCacheTotal(({ total }) => {
                setSyncStats(prev => ({ total: prev.total + total, done: prev.done }));
            });
            if (unsub) unsubs.push(unsub);
        }

        // Background cache progress
        if (electron.onBgCacheProgress) {
            const unsub = electron.onBgCacheProgress(({ pageId, status }) => {
                setCachingPageIds(prev => {
                    const next = new Set(prev);
                    if (status === 'caching') next.add(pageId);
                    else next.delete(pageId);
                    return next;
                });
                if (status === 'done') {
                    // Increment global sync counter, reset when all done
                    setSyncStats(prev => {
                        const done = prev.done + 1;
                        return done >= prev.total ? { total: 0, done: 0 } : { ...prev, done };
                    });
                    // Mark as cached in status badges
                    setPageStatuses(prev => ({
                        ...prev,
                        [pageId]: { ...prev[pageId], hasCachedContent: true, exists: true }
                    }));
                    // Push fresh content into pages state so opening it is instant
                    electron.oneNoteGetPageContent(pageId).then(result => {
                        if (result.success && result.content) {
                            setPages(prev => prev.map(p =>
                                p.id === pageId ? { ...p, content: result.content } : p
                            ));
                        }
                    }).catch(() => {});
                }
            });
            if (unsub) unsubs.push(unsub);
        }

        return () => {
            unsubs.forEach(unsub => unsub && unsub());
        };
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
            if (localResult && localResult.notebooks && localResult.notebooks.length > 0) {
                console.log("Setting notebooks from local data:", localResult.notebooks.length);
                setNotebooks(localResult.notebooks);
                setIsLoading(false); // Stop main loading indicator so user can interact immediately
                // Startup background sync: check ALL sections for timestamp changes, download only what's new/changed
                electron.backgroundCacheAllSections().catch(() => {});
            } else {
                console.log("No local data found or empty notebooks list.");
            }

            // Fetch remote notebooks background check for new/deleted items
            console.log("Fetching remote notebooks async...");
            const result = await electron.oneNoteGetNotebooks();
            console.log("Remote fetch result:", result);

            if (result.success) {
                console.log("Successfully fetched remote notebooks:", result.notebooks?.length || 0);
                // Merge carefully to prevent overwriting existing nested sections/groups in local cache
                setNotebooks(prev => {
                    if (!prev || prev.length === 0) return result.notebooks || [];

                    const remoteNotebooks = result.notebooks || [];
                    const prevMap = new Map(prev.map(n => [n.id, n]));

                    return remoteNotebooks.map(remote => {
                        const existing = prevMap.get(remote.id);
                        if (existing) {
                            // Preserve local sections and childGroups while updating top-level notebook metadata
                            return {
                                ...remote,
                                sections: existing.sections || [],
                                childGroups: existing.childGroups || []
                            };
                        }
                        return remote;
                    });
                });

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
                    // Set pages initially so user sees the list immediately from local cache
                    setPages(result.pages);

                    // Stop blocking UI immediately for local rendering!
                    setIsPageLoading(false);

                    // Background cache: compare timestamps vs OneNote, download only changed pages
                    electron.backgroundCachePages({ sectionId: item.id }).catch(() => {});
                } else {
                    console.error("Failed to load pages:", result.error);
                }
            } catch (err) {
                console.error("Error loading pages:", err);
            } finally {
                // Ensure flag is reset even on error
                setIsPageLoading(false);
            }
        }
    };

    const handlePageSelect = async (page) => {
        setSelectedPageId(page.id);

        // Smart Sync: Always check integrity/updates when opening a page.
        // If local is good, it returns instantly. If bad/outdated, it fetches.
        // We set isPageLoading only if we don't have content to show immediately,
        // OR we can show loading indicator for the "checking" phase if preferred,
        // but for better UX, let's show existing content and update if needed.

        if (!page.content) setIsPageLoading(true);

        try {
            const result = await electron.oneNoteGetPageContent(page.id);
            if (result.success) {
                setPages(prev => prev.map(p =>
                    p.id === page.id ? { ...p, content: result.content } : p
                ));
            } else {
                console.warn("Server returned no success:", result.error);
                setError(`Failed to fetch content: ${result.error || "Unknown error"}`);
            }
        } catch (err) {
            console.error("Failed to fetch content exceptions", err);
            setError(`Failed to fetch content: ${err.message}`);
        } finally {
            setIsPageLoading(false);
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

    const handleRunAutomation = async (type, options = {}) => {
        if (!selectedPage) return;

        // Auto-open relevant panels
        setIsLogPanelOpen(true);
        if (type === 'chatgpt') {
            setIsPromptsPanelOpen(true);
        }

        let basePrompt = '';
        if (type === 'chatgpt') {
            try {
                const result = await electron.settingsGet('base_prompt');
                if (result.success && result.value) {
                    basePrompt = result.value;
                }
            } catch (e) { console.error('Failed to fetch base prompt', e); }
        }

        const extractedScript = extractScriptFromHTML(selectedPage.content);

        electron.runAutomation(type, {
            mode: type,
            pageId: selectedPage.id,
            page: selectedPage,
            basePrompt,
            extractedScript,
            ...options // Pass options like aspectRatio
        });
    };

    const handleRunBatch = async (type, options = {}) => {
        if (!pages || pages.length === 0) return;

        setIsLogPanelOpen(true);
        setBatchProgress({ status: 'starting', current: 0, total: pages.length });

        let basePrompt = '';
        if (type === 'chatgpt') {
            try {
                const result = await electron.settingsGet('base_prompt');
                if (result.success && result.value) basePrompt = result.value;
            } catch (e) { console.error('Failed to fetch base prompt', e); }
        }

        setIsPageLoading(true);
        let fullyLoadedPages = [...pages];

        try {
            if (selectedSectionId) {
                const syncResult = await electron.oneNoteSyncSection(selectedSectionId);
                if (syncResult && syncResult.success && Array.isArray(syncResult.pages)) {
                    fullyLoadedPages = syncResult.pages;
                }
            } else {
                for (let i = 0; i < fullyLoadedPages.length; i++) {
                    const p = fullyLoadedPages[i];
                    if (!p.content) {
                        try {
                            const result = await electron.oneNoteGetPageContent(p.id);
                            if (result.success) fullyLoadedPages[i] = { ...p, content: result.content };
                        } catch (e) { console.error('Failed to fetch content', e); }
                    }
                }
            }
        } catch (err) {
            console.error('Failed to sync section for batch:', err);
        }

        setPages(fullyLoadedPages);
        setIsPageLoading(false);

        const pagesWithOptions = fullyLoadedPages.map(p => ({
            ...p,
            content: extractScriptFromHTML(p.content || '')
        }));

        electron.runAutomation(type, {
            mode: type,
            pages: pagesWithOptions,
            basePrompt,
            ...options
        });
    };

    // -----------------------------------------------------------------------
    // Section Group Batch Run — one-click "Run All ChatGPT for this group"
    // -----------------------------------------------------------------------
    const handleRunSectionGroupBatch = async (type, groupItem) => {
        if (!groupItem) return;

        setIsLogPanelOpen(true);
        if (type === 'chatgpt') setIsPromptsPanelOpen(true);
        setBatchProgress({ status: 'starting', current: 0, total: 0 });

        try {
            // 1. Collect all pages across all sections in the group
            const result = await electron.oneNoteGetSectionGroupPages({
                groupId: groupItem.id,
                groupData: groupItem
            });

            if (!result.success) {
                console.error('Failed to get section group pages:', result.error);
                setBatchProgress(null);
                return;
            }

            const { pages: allPages, promptCounts: pCounts, contentStatuses, sectionCount } = result;

            // Merge content statuses and prompt counts into state for badge display
            setPageStatuses(prev => ({ ...prev, ...contentStatuses }));
            setPromptCounts(prev => ({ ...prev, ...pCounts }));

            setBatchProgress({ status: 'starting', current: 0, total: allPages.length });
            console.log(`[GroupBatch] ${allPages.length} pages across ${sectionCount} sections`);

            // 2. Fetch base prompt
            let basePrompt = '';
            if (type === 'chatgpt') {
                try {
                    const s = await electron.settingsGet('base_prompt');
                    if (s.success && s.value) basePrompt = s.value;
                } catch (e) { console.error('Failed to fetch base prompt', e); }
            }

            // 3. Resolve content for pages that don't have it cached
            const pagesNeedingContent = allPages.filter(p => !contentStatuses[p.id]?.hasCachedContent);
            if (pagesNeedingContent.length > 0) {
                console.log(`[GroupBatch] Fetching content for ${pagesNeedingContent.length} uncached pages...`);
            }

            // Build pages array — extract script from content (for chatgpt mode)
            const pagesWithScript = allPages.map(p => ({
                ...p,
                content: extractScriptFromHTML(p.content || ''),
            }));

            // 4. Run the automation — skip pages that already have prompts
            electron.runAutomation(type, {
                mode: type,
                pages: pagesWithScript,
                basePrompt,
                skipIfHasPrompts: true,
                ...{}
            });
        } catch (err) {
            console.error('[GroupBatch] Error:', err);
            setBatchProgress(null);
        }
    };

    // Pause / Stop / Retry Gemini handlers for BatchControlPanel
    const handleBatchPause = () => {
        setIsPaused(true);
        electron.setAutomationControl({ action: 'pause' });
    };
    const handleBatchResume = () => {
        setIsPaused(false);
        electron.setAutomationControl({ action: 'resume' });
    };
    const handleBatchStop = () => {
        setIsPaused(false);
        electron.setAutomationControl({ action: 'stop' });
    };
    const handleBatchDismiss = () => {
        setBatchProgress(null);
    };
    const handleRetryGemini = async () => {
        if (!batchProgress || !pages.length) return;
        setIsLogPanelOpen(true);
        setBatchProgress({ status: 'starting', current: 0, total: pages.length });
        electron.runAutomation('gemini-retry', {
            mode: 'gemini-retry',
            pages: pages.map(p => ({ ...p, content: '' })), // pageId is what matters
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
                            onRunSectionGroupBatch={handleRunSectionGroupBatch}
                            syncStats={syncStats}
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
                            onRunBatch={handleRunBatch}
                            pageStatuses={pageStatuses}
                            promptCounts={promptCounts}
                            cachingPageIds={cachingPageIds}
                            syncStats={syncStats}
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

            {/* Floating Batch Control Panel */}
            <BatchControlPanel
                progress={batchProgress}
                isPaused={isPaused}
                onPause={handleBatchPause}
                onResume={handleBatchResume}
                onStop={handleBatchStop}
                onRetryGemini={handleRetryGemini}
                onDismiss={handleBatchDismiss}
            />
        </div>
    );
}

export default App;
