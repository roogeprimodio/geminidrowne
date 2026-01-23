import React, { useState, useEffect, useRef } from 'react';
import { Play, Clipboard, Save, MoreVertical, BookOpen, Edit, FileText, Code, Image, Pause, Square } from 'lucide-react';
import { extractScriptFromHTML } from '../../utils/scriptExtractor';
import RunConfiguration from '../RunConfiguration/RunConfiguration';
import GalleryView from '../GalleryView/GalleryView';

const Editor = ({ page, isLoading, onRunAutomation }) => {
    // viewMode: 'formatted' | 'script' | 'source' | 'gallery'
    const [viewMode, setViewMode] = useState('formatted');
    const [content, setContent] = useState('');
    const [extractedScript, setExtractedScript] = useState('');
    const [zoom, setZoom] = useState(100);

    // Automation State
    const [isRunConfigOpen, setIsRunConfigOpen] = useState(false);
    const [runButtonRef, setRunButtonRef] = useState(null);
    const [automationStatus, setAutomationStatus] = useState('idle'); // idle, running, paused
    const [generatedAssets, setGeneratedAssets] = useState([]);

    // Listen for Automation State (Idle/Running/Error)
    useEffect(() => {
        const unlisten = window.electronAPI.onAutomationState((state) => {
            if (state === 'idle' || state === 'error') {
                setAutomationStatus('idle');
            } else if (state === 'running') {
                setAutomationStatus('running');
            }
        });
        return () => unlisten && unlisten();
    }, []);

    useEffect(() => {
        if (page) {
            setContent(page.content || '');
            if (viewMode === 'script') {
                setExtractedScript(extractScriptFromHTML(page.content));
            }
            // Load existing assets from disk
            window.electronAPI.scanPageImages(page.id).then(result => {
                if (result.success) {
                    setGeneratedAssets(result.assets || []);
                } else {
                    setGeneratedAssets([]);
                }
            });
        }
    }, [page, viewMode]);

    // Listen for Asset Updates
    useEffect(() => {
        const unlisten = window.electronAPI.onAutomationAssetCreated((payload) => {
            if (payload.pageId === page?.id) {
                setGeneratedAssets(prev => [...prev, payload]);
            }
        });
        return () => unlisten && unlisten();
    }, [page?.id]);

    const handleRunChatGPT = () => {
        setAutomationStatus('running');
        onRunAutomation('chatgpt');
    };

    const handleRunGemini = (config) => {
        setIsRunConfigOpen(false);
        setAutomationStatus('running');
        setViewMode('gallery'); // Switch to Gallery to see progress
        onRunAutomation('gemini', { ...config });
    };

    const handleControlAction = async (action) => {
        if (action === 'pause') setAutomationStatus('paused');
        if (action === 'resume') setAutomationStatus('running');
        if (action === 'stop') setAutomationStatus('idle');

        await window.electronAPI.setAutomationControl({ action });
    };

    // Basic sanitization/cleanup of OneNote HTML to make it look decent
    const getFormattedContent = () => {
        if (!content) return { __html: '<p class="text-text-muted italic">No content available.</p>' };
        return { __html: content };
    };

    if (!page) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background text-text-muted">
                <div className="text-center flex flex-col items-center gap-3">
                    <BookOpen size={48} className="opacity-20" />
                    <p>Select a page to view content</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col h-full bg-background animate-pulse">
                <div className="h-14 border-b border-border flex items-center px-6 bg-surface/20">
                    <div className="h-6 bg-surface-hover rounded w-1/3"></div>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4 text-purple-400">
                        <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm font-medium text-text-muted">Loading content...</span>
                    </div>
                </div>
            </div>
        );
    }

    const handleZoomIn = () => setZoom(prev => Math.min(prev + 10, 200));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 10, 50));
    const handleResetZoom = () => setZoom(100);

    return (
        <div className="flex-1 flex flex-col h-full bg-background transition-colors duration-300">
            {/* Run Configuration Modal */}
            <RunConfiguration
                isOpen={isRunConfigOpen}
                onClose={() => setIsRunConfigOpen(false)}
                onRun={handleRunGemini}
                position={runButtonRef ? runButtonRef.getBoundingClientRect() : null}
            />

            {/* Header */}
            <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-surface/20">
                <div className="flex items-center gap-4">
                    <h1 className="font-semibold text-lg truncate max-w-lg text-text-main" title={page.title}>
                        {page.title}
                    </h1>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-surface-light rounded mx-2 border border-border">
                        <button onClick={handleResetZoom} className="text-xs text-text-muted hover:text-text-main px-2 py-1.5 border-r border-border">{zoom}%</button>
                        <button onClick={handleZoomOut} className="p-1.5 text-text-muted hover:text-text-main border-r border-border">-</button>
                        <button onClick={handleZoomIn} className="p-1.5 text-text-muted hover:text-text-main">+</button>
                    </div>

                    <button
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600/10 text-green-500 hover:bg-green-600/20 border border-green-600/20 rounded text-sm transition-colors"
                        onClick={handleRunChatGPT}
                        title="Run ChatGPT Automation"
                    >
                        <Play size={14} />
                        <span className="hidden xl:inline">ChatGPT</span>
                    </button>

                    {/* Dynamic Gemini Controls */}
                    {automationStatus === 'idle' ? (
                        <div ref={setRunButtonRef}>
                            <button
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 text-blue-500 hover:bg-blue-600/20 border border-blue-600/20 rounded text-sm transition-colors"
                                onClick={() => setIsRunConfigOpen(true)}
                                title="Run Gemini Automation"
                            >
                                <Play size={14} />
                                <span className="hidden xl:inline">Gemini</span>
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 bg-surface-light border border-border rounded-lg p-1 animate-in fade-in slide-in-from-right-4 duration-300">
                            {automationStatus === 'running' ? (
                                <button
                                    onClick={() => handleControlAction('pause')}
                                    className="p-1.5 text-yellow-500 hover:bg-surface-hover rounded"
                                    title="Pause Automation"
                                >
                                    <Pause size={16} />
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleControlAction('resume')}
                                    className="p-1.5 text-green-500 hover:bg-surface-hover rounded"
                                    title="Resume Automation"
                                >
                                    <Play size={16} />
                                </button>
                            )}
                            <button
                                onClick={() => handleControlAction('stop')}
                                className="p-1.5 text-red-500 hover:bg-surface-hover rounded"
                                title="Stop Automation"
                            >
                                <Square size={16} />
                            </button>
                            <span className="text-xs text-text-muted px-2 border-l border-border/50">
                                {automationStatus === 'running' ? 'Running...' : 'Paused'}
                            </span>
                        </div>
                    )}

                    <div className="w-px h-6 bg-border mx-1" />
                    <button className="p-1.5 text-text-muted hover:text-text-main hover:bg-surface-hover rounded">
                        <MoreVertical size={18} />
                    </button>
                </div>
            </div>

            {/* Toolbar (Tabs) */}
            <div className="border-b border-border px-6 flex items-center gap-1 text-sm bg-surface/10">
                <button
                    onClick={() => setViewMode('formatted')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${viewMode === 'formatted'
                        ? 'border-primary text-primary font-medium bg-surface/30'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-surface/10'
                        }`}
                >
                    <BookOpen size={16} /> Original Page
                </button>
                <button
                    onClick={() => setViewMode('script')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${viewMode === 'script'
                        ? 'border-primary text-primary font-medium bg-surface/30'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-surface/10'
                        }`}
                >
                    <FileText size={16} /> Extracted Script
                </button>
                <button
                    onClick={() => setViewMode('gallery')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${viewMode === 'gallery'
                        ? 'border-primary text-primary font-medium bg-surface/30'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-surface/10'
                        }`}
                >
                    <Image size={16} /> Gallery
                    {generatedAssets.length > 0 && <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1.5 rounded-full">{generatedAssets.length}</span>}
                </button>
                <button
                    onClick={() => setViewMode('source')}
                    className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${viewMode === 'source'
                        ? 'border-primary text-primary font-medium bg-surface/30'
                        : 'border-transparent text-text-muted hover:text-text-main hover:bg-surface/10'
                        }`}
                >
                    <Code size={16} /> HTML Source
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative bg-background/50">
                {viewMode === 'gallery' ? (
                    <GalleryView
                        assets={generatedAssets}
                        onOpenFolder={() => {
                            if (generatedAssets.length > 0) {
                                const firstFile = generatedAssets[0].filePath;
                                // Handle both Windows and Unix separators for robustness
                                const lastSep = Math.max(firstFile.lastIndexOf('/'), firstFile.lastIndexOf('\\'));
                                if (lastSep > -1) {
                                    const dir = firstFile.substring(0, lastSep);
                                    window.electronAPI.openFolder(dir);
                                }
                            }
                        }}
                    />
                ) : viewMode === 'source' ? (
                    <textarea
                        className="w-full h-full bg-transparent p-8 resize-none focus:outline-none font-mono text-xs leading-relaxed text-text-muted overflow-auto"
                        value={content}
                        readOnly
                    />
                ) : viewMode === 'script' ? (
                    <div className="w-full h-full overflow-auto p-8">
                        {extractedScript ? (
                            <div className="max-w-3xl mx-auto bg-surface p-6 rounded-lg border border-border shadow-sm">
                                <h3 className="text-sm font-semibold text-text-muted mb-4 uppercase tracking-wider flex items-center gap-2">
                                    <FileText size={16} /> Script Content
                                </h3>
                                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-main">
                                    {extractedScript}
                                </pre>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50">
                                <FileText size={48} className="mb-4" />
                                <p>No script detected in this page.</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="w-full h-full overflow-auto scrollbar-thin scrollbar-thumb-surface-hover">
                        <div
                            className="min-h-full p-8 transition-transform origin-top-left"
                            style={{
                                transform: `scale(${zoom / 100})`,
                                width: `${100 * (100 / zoom)}%`,
                                height: `${100 * (100 / zoom)}%`,
                                minWidth: 'max-content'
                            }}
                        >
                            <style>{`
                                .onenote-content table { border-collapse: collapse; width: auto; margin-bottom: 1em; }
                                .onenote-content td, .onenote-content th { border: 1px solid var(--color-border); padding: 8px; white-space: nowrap; }
                                .onenote-content img { max-width: none !important; }
                                .onenote-content p { margin-bottom: 0.5em; }
                            `}</style>
                            <div
                                className="onenote-content text-text-main font-sans"
                                dangerouslySetInnerHTML={getFormattedContent()}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

};

export default Editor;
