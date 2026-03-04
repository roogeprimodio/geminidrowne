import React, { useState } from 'react';
import {
    Folder,
    ChevronRight,
    ChevronDown,
    Hash,
    Settings,
    BookOpen,
    Download,
    Play
} from 'lucide-react';

const SidebarItem = ({ item, level = 0, onSelect, onExpand, selectedId, expandedIds, toggleExpand, onRunSectionGroupBatch }) => {
    const [isHovered, setIsHovered] = useState(false);
    const isExpanded = expandedIds.includes(item.id);
    const hasChildren = (item.sections && item.sections.length > 0) ||
        (item.childGroups && item.childGroups.length > 0) ||
        item.type === 'notebook' ||
        item.type === 'sectionGroup';
    const isSelected = selectedId === item.id;
    const isSectionGroup = item.type === 'sectionGroup';

    const paddingLeft = `${level * 12 + 12}px`;

    return (
        <div>
            <div
                className={`
          flex items-center py-1 pr-2 cursor-pointer group
          ${isSelected ? 'bg-primary/20 text-primary' : 'text-text-muted hover:bg-surface-hover hover:text-text-main'}
          ${item.isDeleted ? 'line-through text-red-500/70 opacity-60' : ''}
        `}
                style={{ paddingLeft }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
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

                <span className="text-sm truncate select-none flex-1">{item.displayName || item.name}</span>

                {/* Run All ChatGPT button — shows on hover for sectionGroups */}
                {isSectionGroup && isHovered && onRunSectionGroupBatch && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onRunSectionGroupBatch('chatgpt', item);
                        }}
                        title="Run All ChatGPT for this group"
                        className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 ml-1 rounded text-[10px] bg-green-900/60 hover:bg-green-700 text-green-400 hover:text-white border border-green-800 transition-all"
                    >
                        <Play size={9} />
                        All
                    </button>
                )}
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
                            onRunSectionGroupBatch={onRunSectionGroupBatch}
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
                            onRunSectionGroupBatch={onRunSectionGroupBatch}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};


const Sidebar = ({ data = [], onSelect, onExpand, selectedId, onSync, isSyncing, onSettings, onRunSectionGroupBatch, syncStats = { total: 0, done: 0 } }) => {
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
                            onRunSectionGroupBatch={onRunSectionGroupBatch}
                        />
                    ))
                )}
            </div>

            <div className="p-2 border-t border-border space-y-1">
                <button
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${isSyncing || syncStats.total > 0 ? 'text-blue-400/80 bg-blue-500/5' : 'text-text-muted hover:text-text-main hover:bg-surface-hover'}`}
                    onClick={onSync}
                    disabled={isSyncing}
                >
                    <svg className={`w-[18px] h-[18px] flex-shrink-0 ${isSyncing || syncStats.total > 0 ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <span className="flex-1 text-left">
                        {isSyncing ? 'Syncing notebooks...' : syncStats.total > 0 ? `Caching pages...` : 'Sync Notebooks'}
                    </span>
                    {syncStats.total > 0 && (
                        <span className="text-[10px] font-semibold tabular-nums text-blue-400/80">
                            {syncStats.done}/{syncStats.total}
                        </span>
                    )}
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
