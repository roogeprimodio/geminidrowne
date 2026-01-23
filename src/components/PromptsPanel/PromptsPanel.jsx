import React, { useState, useEffect } from 'react';
import { MessageSquare, Plus, Trash2, CheckCircle, XCircle, AlertCircle, ToggleLeft, ToggleRight, X } from 'lucide-react';

const PromptsPanel = ({ page, breadcrumb, width, setWidth, onClose }) => {
    const [prompts, setPrompts] = useState([]);
    const [newPrompt, setNewPrompt] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    // Calculate Page Number from Title (e.g., "12. Title" -> 12)
    const pageNumber = page?.title?.match(/^(\d+)[.]/)?.[1] || '?';

    useEffect(() => {
        if (page?.id) {
            loadPrompts();
        }
    }, [page?.id]);

    const loadPrompts = async () => {
        try {
            const result = await window.electronAPI.promptsGet(page.id);
            if (result.success) {
                setPrompts(result.prompts);
            }
        } catch (error) {
            console.error('Failed to load prompts:', error);
        }
    };

    const handleAddPrompt = async () => {
        if (!newPrompt.trim()) return;

        try {
            const result = await window.electronAPI.promptsAdd({
                pageId: page.id,
                content: newPrompt
            });

            if (result.success) {
                setNewPrompt('');
                setIsAdding(false);
                loadPrompts();
            }
        } catch (error) {
            console.error('Failed to add prompt:', error);
        }
    };

    const handleDeletePrompt = async (id) => {
        try {
            await window.electronAPI.promptsDelete(id);
            loadPrompts();
        } catch (error) {
            console.error('Failed to delete prompt:', error);
        }
    };

    const handleToggleSkip = async (id, currentSkipStatus) => {
        try {
            await window.electronAPI.promptsToggleSkip({
                id,
                isSkipped: !currentSkipStatus
            });
            loadPrompts();
        } catch (error) {
            console.error('Failed to toggle skip:', error);
        }
    };

    const handleToggleSkipAll = async (shouldSkip) => {
        try {
            await window.electronAPI.promptsToggleSkipAll({
                pageId: page.id,
                isSkipped: shouldSkip
            });
            loadPrompts();
        } catch (error) {
            console.error('Failed to toggle all skips:', error);
        }
    };

    const areAllSkipped = prompts.length > 0 && prompts.every(p => p.isSkipped);

    return (
        <div
            className="border-l border-border bg-surface flex flex-col relative h-full shadow-xl z-20"
            style={{ width: `${width}px`, minWidth: '280px', maxWidth: '600px' }}
        >
            {/* Resize Handle */}
            <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors z-30"
                onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startWidth = width;

                    const handleMouseMove = (e) => {
                        const delta = startX - e.clientX;
                        const newWidth = Math.max(280, Math.min(600, startWidth + delta));
                        setWidth(newWidth);
                    };

                    const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                }}
            />

            {/* Header */}
            <div className="p-4 border-b border-border bg-surface-hover/30">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-text-main flex items-center gap-2">
                        <MessageSquare size={18} className="text-primary" />
                        Page Prompts
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded text-text-muted hover:text-red-400">
                        <X size={16} />
                    </button>
                </div>

                {/* Breadcrumb Path */}
                <div className="flex items-center gap-1 text-xs text-text-muted overflow-x-auto pb-2 scrollbar-none">
                    {breadcrumb.map((item, index) => (
                        <React.Fragment key={index}>
                            {index > 0 && <span className="text-text-muted/50">/</span>}
                            <span
                                className={`whitespace-nowrap flex-shrink-0 ${item.type === 'page' ? 'text-primary font-medium' : ''
                                    }`}
                                title={item.name}
                            >
                                {item.name.length > 25 ? item.name.substring(0, 25) + '...' : item.name}
                            </span>
                        </React.Fragment>
                    ))}
                </div>

                {/* Master Controls */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                    <span className="text-xs font-medium text-text-muted">
                        Total Prompts: <span className="text-text-main">{prompts.length}</span>
                    </span>
                    <button
                        onClick={() => handleToggleSkipAll(!areAllSkipped)}
                        className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${areAllSkipped
                                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                                : 'bg-surface-hover text-text-muted hover:text-text-main'
                            }`}
                    >
                        {areAllSkipped ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        {areAllSkipped ? 'Unskip All' : 'Skip All'}
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface/50">
                {prompts.length === 0 ? (
                    <div className="text-center text-text-muted text-sm py-8 border-2 border-dashed border-border rounded-lg">
                        <MessageSquare size={32} className="mx-auto mb-3 opacity-20" />
                        <p>No prompts yet</p>
                        <p className="text-xs mt-1 opacity-60">Add distinct prompts for this page</p>
                    </div>
                ) : (
                    prompts.map((prompt, index) => {
                        const promptNumber = index + 1;
                        const displayId = `${pageNumber}.${promptNumber}`;

                        return (
                            <div
                                key={prompt.id}
                                className={`
                                    group relative p-3 rounded-lg border transition-all duration-200
                                    ${prompt.isSkipped
                                        ? 'bg-surface border-border opacity-60 grayscale-[0.5]'
                                        : 'bg-background border-border hover:border-primary/30 shadow-sm'}
                                `}
                            >
                                {/* Card Header: ID and Skip Toggle */}
                                <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/50">
                                    <span className="text-xs font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                        #{displayId}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handleToggleSkip(prompt.id, prompt.isSkipped)}
                                            className={`
                                                flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full transition-colors
                                                ${prompt.isSkipped
                                                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                                                    : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'}
                                            `}
                                        >
                                            {prompt.isSkipped ? 'Skipped' : 'Active'}
                                        </button>
                                        <button
                                            onClick={() => handleDeletePrompt(prompt.id)}
                                            className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                            title="Delete Prompt"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>

                                {/* Prompt Content */}
                                <div className="text-sm text-text-main whitespace-pre-wrap leading-relaxed font-mono text-[13px]">
                                    {prompt.content}
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Adding New Prompt UI */}
                {isAdding ? (
                    <div className="bg-background border border-primary/50 rounded-lg p-3 shadow-lg animate-in fade-in zoom-in-95 duration-200">
                        <textarea
                            value={newPrompt}
                            onChange={(e) => setNewPrompt(e.target.value)}
                            placeholder="Enter prompt content..."
                            className="w-full bg-surface text-text-main text-sm p-2 rounded border border-border focus:border-primary outline-none min-h-[80px] mb-2 resize-y font-mono"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.ctrlKey) handleAddPrompt();
                                if (e.key === 'Escape') setIsAdding(false);
                            }}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setIsAdding(false)}
                                className="px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface rounded"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddPrompt}
                                disabled={!newPrompt.trim()}
                                className="px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-hover rounded disabled:opacity-50"
                            >
                                Add Prompt
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="w-full py-3 border-2 border-dashed border-border hover:border-primary/50 text-text-muted hover:text-primary rounded-lg flex items-center justify-center gap-2 transition-all group"
                    >
                        <Plus size={16} className="group-hover:scale-110 transition-transform" />
                        <span className="text-sm font-medium">Add New Prompt</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default PromptsPanel;
