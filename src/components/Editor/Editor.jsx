import React, { useState, useEffect } from 'react';
import { Play, Clipboard, Save, MoreVertical, BookOpen, Edit, FileText, Code } from 'lucide-react';
import { extractScriptFromHTML } from '../../utils/scriptExtractor';

const Editor = ({ page, isLoading, onRunAutomation }) => {
    // viewMode: 'formatted' | 'script' | 'source'
    const [viewMode, setViewMode] = useState('formatted');
    const [content, setContent] = useState('');
    const [extractedScript, setExtractedScript] = useState('');
    const [zoom, setZoom] = useState(100);

    useEffect(() => {
        if (page) {
            setContent(page.content || '');
            if (viewMode === 'script') {
                setExtractedScript(extractScriptFromHTML(page.content));
            }
        }
    }, [page, viewMode]);

    // Basic sanitization/cleanup of OneNote HTML to make it look decent
    // This is a simple pass; robust sanitization should be done if security is a concern
    const getFormattedContent = () => {
        if (!content) return { __html: '<p class="text-text-muted italic">No content available.</p>' };
        // Clean up some common OneNote weirdness if necessary, or just render as is
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
            {/* Header */}
            <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-surface/20">
                {/* ... header content ... */}
                <div className="flex items-center gap-4">
                    <h1 className="font-semibold text-lg truncate max-w-lg text-text-main" title={page.title}>
                        {page.title}
                    </h1>
                </div>
                {/* ... action buttons ... */}
                <div className="flex items-center gap-2">
                    {/* Zoom Controls */}
                    <div className="flex items-center bg-surface-light rounded mx-2 border border-border">
                        <button onClick={handleResetZoom} className="text-xs text-text-muted hover:text-text-main px-2 py-1.5 border-r border-border">
                            {zoom}%
                        </button>
                        <button onClick={handleZoomOut} className="p-1.5 text-text-muted hover:text-text-main border-r border-border">
                            -
                        </button>
                        <button onClick={handleZoomIn} className="p-1.5 text-text-muted hover:text-text-main">
                            +
                        </button>
                    </div>

                    <button
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-600/10 text-green-500 hover:bg-green-600/20 border border-green-600/20 rounded text-sm transition-colors"
                        onClick={() => onRunAutomation('chatgpt')}
                        title="Run ChatGPT Automation"
                    >
                        <Play size={14} />
                        <span className="hidden xl:inline">ChatGPT</span>
                    </button>
                    <button
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 text-blue-500 hover:bg-blue-600/20 border border-blue-600/20 rounded text-sm transition-colors"
                        onClick={() => onRunAutomation('gemini')}
                        title="Run Gemini Automation"
                    >
                        <Play size={14} />
                        <span className="hidden xl:inline">Gemini</span>
                    </button>

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
                {viewMode === 'source' ? (
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
