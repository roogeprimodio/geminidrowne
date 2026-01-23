import React, { useState } from 'react';
import { Menu, User, LogIn, LogOut, ChevronUp, ChevronDown, PanelLeftClose, PanelLeftOpen, Sun, Moon, Terminal, MessageSquare, ScrollText, X, Save } from 'lucide-react';

const TopBar = ({
    isSidebarOpen,
    toggleSidebar,
    isPageListOpen,
    togglePageList,
    user,
    onLogin,
    onLogout,
    isOpen,
    toggleTopBar,
    isDarkMode,
    toggleTheme,
    isLogPanelOpen,
    toggleLogPanel,
    isPromptsPanelOpen,
    togglePromptsPanel
}) => {
    const [isBasePromptOpen, setIsBasePromptOpen] = useState(false);
    const [basePrompt, setBasePrompt] = useState('');

    const openBasePrompt = async () => {
        setIsBasePromptOpen(true);
        try {
            const result = await window.electronAPI.settingsGet('base_prompt');
            if (result.success && result.value) {
                setBasePrompt(result.value);
            }
        } catch (e) { console.error(e); }
    };

    const saveBasePrompt = async () => {
        try {
            await window.electronAPI.settingsSave({ key: 'base_prompt', value: basePrompt });
            setIsBasePromptOpen(false);
        } catch (e) { console.error(e); }
    };

    if (!isOpen) {
        return (
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-50">
                <button
                    onClick={toggleTopBar}
                    className="bg-surface text-text-muted hover:text-text-main px-3 py-1 rounded-b-md shadow-md flex items-center gap-1 text-xs transition-colors border border-t-0 border-border"
                    title="Show Toolbar"
                >
                    <ChevronDown size={14} />
                </button>
            </div>
        );
    }

    return (
        <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 select-none relative z-40 transition-colors duration-300">
            {/* Left: Sidebar Toggle & App Title */}
            <div className="flex items-center gap-4">
                <div className="flex bg-surface-light rounded-lg p-0.5 border border-border">
                    <button
                        onClick={toggleSidebar}
                        className={`p-1.5 rounded-md transition-all duration-200 ${isSidebarOpen ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'}`}
                        title={isSidebarOpen ? "Close Notebooks" : "Open Notebooks"}
                    >
                        <PanelLeftClose size={18} />
                    </button>
                    <div className="w-px bg-border mx-0.5 my-1"></div>
                    <button
                        onClick={togglePageList}
                        className={`p-1.5 rounded-md transition-all duration-200 flex items-center ${isPageListOpen ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'}`}
                        title={isPageListOpen ? "Close Page List" : "Open Page List"}
                    >
                        <PanelLeftOpen size={18} className={isPageListOpen ? "" : "transform rotate-180"} />
                    </button>
                </div>
                <div className="font-semibold text-text-main flex items-center gap-2">
                    <span className="text-accent">Gemini</span>Downloader
                </div>
            </div>

            {/* Center: Toggle TopBar Visibility */}
            <div className="absolute left-1/2 transform -translate-x-1/2">
                <button
                    onClick={toggleTopBar}
                    className="text-text-muted hover:text-text-main transition-colors p-1"
                    title="Hide Toolbar"
                >
                    <ChevronUp size={16} />
                </button>
            </div>

            {/* Right: User Auth */}
            <div className="flex items-center gap-3">
                {/* Log Panel Toggle */}
                <button
                    onClick={toggleLogPanel}
                    className={`p-1.5 rounded-full hover:bg-surface-hover transition-colors ${isLogPanelOpen ? 'text-primary bg-primary/10' : 'text-text-muted hover:text-text-main'}`}
                    title={isLogPanelOpen ? "Hide Automation Output" : "Show Automation Output"}
                >
                    <Terminal size={18} />
                </button>

                {/* Prompts Panel Toggle */}
                <button
                    onClick={togglePromptsPanel}
                    className={`p-1.5 rounded-full hover:bg-surface-hover transition-colors ${isPromptsPanelOpen ? 'text-primary bg-primary/10' : 'text-text-muted hover:text-text-main'}`}
                    title={isPromptsPanelOpen ? "Hide Prompts" : "Show Prompts"}
                >
                    <MessageSquare size={18} />
                </button>

                {/* Base Prompt */}
                <button
                    onClick={openBasePrompt}
                    className="p-1.5 rounded-full hover:bg-surface-hover text-text-muted hover:text-text-main transition-colors"
                    title="Edit Base Prompt"
                >
                    <ScrollText size={18} />
                </button>

                {/* Theme Toggle */}
                <button
                    onClick={toggleTheme}
                    className="p-1.5 rounded-full hover:bg-surface-hover text-text-muted hover:text-text-main transition-colors"
                    title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                    {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                </button>

                {user ? (
                    <div className="flex items-center gap-3 bg-surface-light rounded-full pl-3 pr-1 py-1 border border-border">
                        <div className="flex items-center gap-2">
                            <User size={14} className="text-accent" />
                            <span className="text-sm text-text-muted max-w-[150px] truncate">
                                {user.username || user.name || user.email || 'User'}
                            </span>
                        </div>
                        <button
                            onClick={onLogout}
                            className="bg-surface hover:bg-surface-hover text-text-muted rounded-full p-1.5 transition-colors"
                            title="Logout"
                        >
                            <LogOut size={14} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={onLogin}
                        className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors shadow-lg shadow-purple-900/20"
                    >
                        <LogIn size={16} />
                        <span>OneNote Login</span>
                    </button>
                )}
            </div>

            {/* Base Prompt Modal */}
            {isBasePromptOpen && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-border flex items-center justify-between bg-surface-hover/30 rounded-t-xl">
                            <h2 className="font-semibold text-text-main flex items-center gap-2">
                                <ScrollText size={20} className="text-primary" />
                                Base Prompt Configuration
                            </h2>
                            <button onClick={() => setIsBasePromptOpen(false)} className="text-text-muted hover:text-red-400 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-4 flex-1 flex flex-col overflow-hidden">
                            <p className="text-sm text-text-muted mb-3">
                                Define the base instructions for the AI prompt generator. This info will be prepended to all page processing tasks.
                            </p>
                            <textarea
                                value={basePrompt}
                                onChange={(e) => setBasePrompt(e.target.value)}
                                className="flex-1 w-full bg-background text-text-main p-4 rounded-lg border border-border focus:border-primary outline-none font-mono text-sm resize-none leading-relaxed"
                                placeholder="Enter base prompt structure here..."
                                spellCheck={false}
                            />
                        </div>

                        <div className="p-4 border-t border-border bg-surface-hover/30 rounded-b-xl flex justify-end gap-3">
                            <button
                                onClick={() => setIsBasePromptOpen(false)}
                                className="px-4 py-2 text-sm text-text-muted hover:text-text-main hover:bg-surface/50 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveBasePrompt}
                                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium flex items-center gap-2 shadow-lg shadow-primary/20 transition-all hover:scale-105"
                            >
                                <Save size={16} />
                                Save Configuration
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>

    );
};

export default TopBar;
