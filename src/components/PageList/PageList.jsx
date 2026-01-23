import React from 'react';
import { FileText, Clock } from 'lucide-react';

const PageItem = ({ page, isSelected, onClick }) => {
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
                    <p className="text-xs text-text-muted/70 truncate mt-1">
                        {page.contentPreview || 'No preview available'}
                    </p>
                </div>
            </div>
        </div>
    );
};

const PageList = ({ pages = [], selectedPageId, onSelectPage }) => {
    return (
        <div className="flex flex-col h-full bg-background border-r border-border w-72">
            <div className="p-4 border-b border-border bg-surface/30">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-text-muted">
                    {pages.length} Pages
                </h2>
                {/* Search bar could go here */}
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
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default PageList;
