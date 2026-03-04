import React, { useState } from 'react';
import { FileText, Clock, Monitor, Smartphone, Square as SquareIcon, Play, Database, Wifi, WifiOff, MessageSquare } from 'lucide-react';

// Content status badge shown per page
const ContentBadge = ({ status, promptCount = 0, isCaching = false }) => {
    if (isCaching) {
        return (
            <div className="flex items-center gap-1.5 mt-1.5">
                <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border text-blue-400/80 border-blue-500/20 animate-pulse">
                    <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Caching...
                </span>
                {promptCount > 0 && (
                    <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border text-purple-400/80 border-purple-500/20">
                        <MessageSquare size={10} />{promptCount}
                    </span>
                )}
            </div>
        );
    }

    if (!status) return null;
    const { hasCachedContent } = status;

    let icon, label, cls;
    if (hasCachedContent) {
        icon = <Database size={10} />;
        label = 'Cached';
        cls = 'text-green-400/80 border-green-500/20';
    } else if (status.exists) {
        icon = <Wifi size={10} />;
        label = 'Online';
        cls = 'text-yellow-400/80 border-yellow-500/20';
    } else {
        icon = <WifiOff size={10} />;
        label = 'Missing';
        cls = 'text-red-400/80 border-red-500/20';
    }

    return (
        <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border ${cls}`}>
                {icon}{label}
            </span>
            {promptCount > 0 && (
                <span className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border text-purple-400/80 border-purple-500/20">
                    <MessageSquare size={10} />{promptCount}
                </span>
            )}
        </div>
    );
};

const PageItem = ({ page, isSelected, onClick, contentStatus, promptCount, isCaching }) => {
    return (
        <div
            className={`
        p-3 border-b border-border cursor-pointer transition-colors
        ${isSelected ? 'bg-surface border-l-2 border-l-primary' : 'hover:bg-surface/50 border-l-2 border-l-transparent'}
      `}
            onClick={() => onClick(page)}
        >
            <div className="flex items-start gap-2">
                <FileText size={16} className={isSelected ? 'text-primary' : 'text-text-muted'} />
                <div className="flex-1 overflow-hidden">
                    <h3 className={`text-sm font-medium truncate ${isSelected ? 'text-text-main' : 'text-text-muted'}`}>
                        {page.title || 'Untitled Page'}
                    </h3>
                    <div className="flex items-center gap-1 mt-1 text-xs text-text-muted">
                        <Clock size={12} />
                        <span>{new Date(page.lastModifiedDateTime || Date.now()).toLocaleDateString()}</span>
                    </div>
                    <ContentBadge status={contentStatus} promptCount={promptCount} isCaching={isCaching} />
                </div>
            </div>
        </div>
    );
};

const PageList = ({ pages = [], selectedPageId, onSelectPage, onRunBatch, pageStatuses = {}, promptCounts = {}, cachingPageIds = new Set(), syncStats = { total: 0, done: 0 } }) => {
    const [showBatchOptions, setShowBatchOptions] = useState(false);
    const [aspectRatio, setAspectRatio] = useState('16:9');

    const handleRunGeminiBatch = () => {
        if (onRunBatch) {
            onRunBatch('gemini', { aspectRatio });
        }
        setShowBatchOptions(false);
    };
    return (
        <div className="flex flex-col h-full bg-background border-r border-border w-72">
            <div className="p-4 border-b border-border bg-surface/30 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-sm uppercase tracking-wider text-text-muted">
                        {pages.length} Pages
                    </h2>
                    {syncStats.total > 0 && (
                        <span className="text-[10px] text-blue-400/80 flex items-center gap-0.5 animate-pulse">
                            <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                            {syncStats.done}/{syncStats.total} syncing
                        </span>
                    )}
                </div>
                {pages.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={() => onRunBatch && onRunBatch('chatgpt')}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-surface border border-border text-sm font-medium text-text-main hover:bg-surface-hover hover:border-green-500/50 hover:text-green-400 transition-all shadow-sm"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a2 2 0 1 1 0 4h-1v1a2 2 0 1 1-4 0v-1H7v1a2 2 0 1 1-4 0v-1H2a2 2 0 1 1 0-4h1a7 7 0 0 1 7-7h1V5.73A2 2 0 1 1 12 2z" /></svg>
                            Run All ChatGPT
                        </button>
                        <button
                            onClick={() => setShowBatchOptions(!showBatchOptions)}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-surface border border-border text-sm font-medium text-text-main hover:bg-surface-hover hover:border-blue-500/50 hover:text-blue-400 transition-all shadow-sm"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></svg>
                            Run All Gemini
                        </button>

                        {showBatchOptions && (
                            <div className="p-3 bg-surface-light border border-border rounded-lg shadow-inner animate-in fade-in slide-in-from-top-2">
                                <label className="block text-[10px] font-semibold text-text-muted mb-2 uppercase tracking-wider">Aspect Ratio</label>
                                <div className="grid grid-cols-3 gap-1 mb-2">
                                    {[{ id: '16:9', Icon: Monitor }, { id: '9:16', Icon: Smartphone }, { id: '1:1', Icon: SquareIcon }].map(ar => (
                                        <button
                                            key={ar.id}
                                            onClick={() => setAspectRatio(ar.id)}
                                            className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${aspectRatio === ar.id
                                                ? 'bg-primary/20 border-primary/50 text-primary'
                                                : 'bg-background border-border text-text-muted hover:border-text-muted'
                                                }`}
                                        >
                                            <ar.Icon size={14} />
                                            <span className="text-[9px] font-medium leading-none">{ar.id}</span>
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={handleRunGeminiBatch}
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded transition-colors shadow-sm"
                                >
                                    <Play size={12} fill="white" /> Start Batch
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-surface-hover">
                {pages.length === 0 ? (
                    <div className="p-8 text-center text-text-muted text-sm">
                        No pages found in this section.
                    </div>
                ) : (
                    pages.map(page => (
                        <PageItem
                            key={page.id}
                            page={page}
                            isSelected={selectedPageId === page.id}
                            onClick={onSelectPage}
                            contentStatus={pageStatuses[page.id]}
                            promptCount={promptCounts[page.id] || 0}
                            isCaching={cachingPageIds.has(page.id)}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default PageList;
