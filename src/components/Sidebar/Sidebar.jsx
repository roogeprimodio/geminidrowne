import React, { useState } from 'react';
import {
    Folder,
    ChevronRight,
    ChevronDown,
    Hash,
    Settings,
    BookOpen,
    Download
} from 'lucide-react';

const SidebarItem = ({ item, level = 0, onSelect, onExpand, selectedId, expandedIds, toggleExpand }) => {
    const isExpanded = expandedIds.includes(item.id);
    // Notebooks and SectionGroups should always be expandable to allow lazy loading
    const hasChildren = (item.sections && item.sections.length > 0) ||
        (item.childGroups && item.childGroups.length > 0) ||
        item.type === 'notebook' ||
        item.type === 'sectionGroup';
    const isSelected = selectedId === item.id;

    const paddingLeft = `${level * 12 + 12}px`;

    return (
        <div>
            <div
                className={`
          flex items-center py-1 pr-2 cursor-pointer
          ${isSelected ? 'bg-primary/20 text-primary' : 'text-text-muted hover:bg-surface-hover hover:text-text-main'}
          ${item.isDeleted ? 'line-through text-red-500/70 opacity-60' : ''}
        `}
                style={{ paddingLeft }}
                onClick={() => {
                    if (hasChildren) {
                        toggleExpand(item.id);
                        if (!expandedIds.includes(item.id) && onExpand) {
                            onExpand(item);
                        }
                    }
                    onSelect(item);
                }}
            >
                <span className="mr-1 opacity-70">
                    {hasChildren ? (
                        isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    ) : (
                        <span className="w-[14px] inline-block" />
                    )}
                </span>

                <span className="mr-2">
                    {item.type === 'notebook' && <BookOpen size={16} />}
                    {item.type === 'sectionGroup' && <Folder size={16} />}
                    {item.type === 'section' && <Hash size={16} />}
                </span>

                <span className="text-sm truncate select-none">{item.displayName || item.name}</span>
            </div>

            {isExpanded && hasChildren && (
                <div>
                    {item.childGroups?.map(group => (
                        <SidebarItem
                            key={group.id}
                            item={group}
                            level={level + 1}
                            onSelect={onSelect}
                            onExpand={onExpand}
                            selectedId={selectedId}
                            expandedIds={expandedIds}
                            toggleExpand={toggleExpand}
                        />
                    ))}
                    {item.sections?.map(section => (
                        <SidebarItem
                            key={section.id}
                            item={section}
                            level={level + 1}
                            onSelect={onSelect}
                            onExpand={onExpand}
                            selectedId={selectedId}
                            expandedIds={expandedIds}
                            toggleExpand={toggleExpand}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const Sidebar = ({ data = [], onSelect, onExpand, selectedId, onSync, isSyncing, onSettings }) => {
    const [expandedIds, setExpandedIds] = useState([]);

    const toggleExpand = (id) => {
        setExpandedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    return (
        <div className="flex flex-col h-full bg-surface border-r border-border">
            <div className="p-4 border-b border-border">
                <h1 className="font-bold text-lg text-primary flex items-center gap-2">
                    <BookOpen className="text-primary" size={20} />
                    <span>Gemini Ops</span>
                </h1>
            </div>

            <div className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-surface-hover">
                <div className="px-3 mb-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Notebooks
                </div>
                {data.length === 0 ? (
                    <div className="px-4 py-8 text-center text-text-muted text-sm">
                        <BookOpen size={48} className="mx-auto mb-3 opacity-20" />
                        <p className="mb-2">No notebooks found</p>
                        <p className="text-xs">
                            Click "Sync Notebooks" below or make sure you're logged in
                        </p>
                    </div>
                ) : (
                    data.map(item => (
                        <SidebarItem
                            key={item.id}
                            item={item}
                            onSelect={onSelect}
                            onExpand={onExpand}
                            selectedId={selectedId}
                            expandedIds={expandedIds}
                            toggleExpand={toggleExpand}
                        />
                    ))
                )}
            </div>

            <div className="p-2 border-t border-border space-y-1">
                <button
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:text-text-main hover:bg-surface-hover rounded-md transition-colors ${isSyncing ? 'animate-pulse' : ''}`}
                    onClick={onSync}
                    disabled={isSyncing}
                >
                    <Download size={18} className={isSyncing ? "animate-spin" : ""} />
                    <span>{isSyncing ? "Syncing..." : "Sync Notebooks"}</span>
                </button>
                <button
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:text-text-main hover:bg-surface-hover rounded-md transition-colors"
                    onClick={onSettings}
                >
                    <Settings size={18} />
                    <span>Settings</span>
                </button>
            </div>
        </div>
    );
};

export default Sidebar;
