import React, { useState } from 'react';
import { Play, Square, Smartphone, Monitor } from 'lucide-react';

const RunConfiguration = ({ isOpen, onClose, onRun, position }) => {
    const [aspectRatio, setAspectRatio] = useState('16:9');

    if (!isOpen) return null;

    const aspectRatios = [
        { id: '16:9', label: 'YouTube (16:9)', icon: Monitor, value: '16:9' },
        { id: '9:16', label: 'Shorts (9:16)', icon: Smartphone, value: '9:16' },
        { id: '1:1', label: 'Square (1:1)', icon: Square, value: '1:1' },
    ];

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-transparent"
                onClick={onClose}
            />

            {/* Popover */}
            <div
                className="absolute z-50 w-72 bg-surface border border-border rounded-xl shadow-xl animate-in zoom-in-95 duration-200"
                style={{
                    top: (position?.bottom || 0) + 8,
                    right: window.innerWidth - (position?.right || 0),
                    width: '18rem'
                }}
            >
                <div className="p-3 border-b border-border bg-surface-hover/30 rounded-t-xl">
                    <h3 className="text-sm font-semibold text-text-main">Gemini Configuration</h3>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-medium text-text-muted mb-2 block uppercase tracking-wider">Aspect Ratio</label>
                        <div className="grid grid-cols-3 gap-2">
                            {aspectRatios.map((ar) => (
                                <button
                                    key={ar.id}
                                    onClick={() => setAspectRatio(ar.value)}
                                    className={`
                                        flex flex-col items-center gap-2 p-2 rounded-lg border transition-all duration-200
                                        ${aspectRatio === ar.value
                                            ? 'bg-primary/10 border-primary text-primary shadow-sm'
                                            : 'bg-background border-border text-text-muted hover:border-primary/50 hover:text-text-main'}
                                    `}
                                >
                                    <ar.icon size={20} />
                                    <span className="text-[10px] font-medium">{ar.id}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={() => onRun({ aspectRatio })}
                            className="w-full py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-md"
                        >
                            <Play size={16} fill="white" />
                            Start Generation
                        </button>
                    </div>
                </div>
            </div >
        </>
    );
};

export default RunConfiguration;
