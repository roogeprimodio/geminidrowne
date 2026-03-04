import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Trash2, PauseCircle, PlayCircle, StopCircle, Search, Copy, ArrowDownToLine } from 'lucide-react';
import { electron } from '../../services/electron';

const LogPanel = ({ className }) => {
    const [logs, setLogs] = useState([]);
    const [autoState, setAutoState] = useState('idle'); // 'running', 'paused', 'idle'
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const bottomRef = useRef(null);

    useEffect(() => {
        const cleanupLog = electron.onLogMessage((message) => {
            setLogs(prev => [...prev, { text: message.message || message, type: 'info', timestamp: Date.now() }].slice(-500));
        });

        const cleanupError = electron.onLogError((message) => {
            setLogs(prev => [...prev, { text: `ERROR: ${message.message || message}`, type: 'error', timestamp: Date.now() }].slice(-500));
        });

        let cleanupAutoLog = () => { };
        if (electron.onAutomationLog) {
            cleanupAutoLog = electron.onAutomationLog((message) => {
                setLogs(prev => [...prev, { text: message, type: 'automation', timestamp: Date.now() }].slice(-500));
            });
        }

        let cleanupAutoState = () => { };
        if (electron.onAutomationState) {
            cleanupAutoState = electron.onAutomationState((state) => {
                setAutoState(state);
            });
            electron.getAutomationState().then(state => setAutoState(state)).catch(() => { });
        }

        return () => {
            if (cleanupLog) cleanupLog();
            if (cleanupError) cleanupError();
            if (cleanupAutoLog) cleanupAutoLog();
            if (cleanupAutoState) cleanupAutoState();
        };
    }, []);

    useEffect(() => {
        if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs, autoScroll]);

    const clearLogs = () => setLogs([]);

    const handleControl = (action) => {
        if (electron.setAutomationControl) {
            electron.setAutomationControl({ action });
        }
    };

    const copyAllLogs = () => {
        const text = logs.map(l => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.text}`).join('\n');
        navigator.clipboard.writeText(text);
    };

    const filteredLogs = searchQuery
        ? logs.filter(l => l.text.toLowerCase().includes(searchQuery.toLowerCase()))
        : logs;

    return (
        <div className={`flex flex-col bg-background border-t border-border ${className}`}>
            <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border">
                <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Terminal size={14} />
                    <span className="font-semibold">Automation Output</span>
                    {logs.length > 0 && (
                        <span className="text-[10px] text-text-muted/60">{logs.length}/500</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {(autoState === 'running' || autoState === 'paused') && (
                        <div className="flex items-center gap-2 mr-4 border-r border-border pr-4">
                            {autoState === 'running' ? (
                                <button onClick={() => handleControl('pause')} className="text-yellow-500 hover:text-yellow-400 p-1 flex items-center gap-1 text-xs font-semibold" title="Pause">
                                    <PauseCircle size={16} /> Pause
                                </button>
                            ) : (
                                <button onClick={() => handleControl('resume')} className="text-green-500 hover:text-green-400 p-1 flex items-center gap-1 text-xs font-semibold" title="Resume">
                                    <PlayCircle size={16} /> Resume
                                </button>
                            )}
                            <button onClick={() => handleControl('stop')} className="text-red-500 hover:text-red-400 p-1 flex items-center gap-1 text-xs font-semibold" title="Stop">
                                <StopCircle size={16} /> Stop
                            </button>
                        </div>
                    )}

                    {showSearch && (
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search logs..."
                            className="text-xs bg-background border border-border rounded px-2 py-0.5 w-36 text-text-main outline-none focus:border-primary/50"
                            autoFocus
                        />
                    )}
                    <button
                        onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(''); }}
                        className={`p-1 rounded ${showSearch ? 'text-primary' : 'text-text-muted hover:text-text-main'}`}
                        title="Search logs"
                    >
                        <Search size={14} />
                    </button>
                    <button
                        onClick={copyAllLogs}
                        className="text-text-muted hover:text-text-main p-1 rounded"
                        title="Copy all logs"
                    >
                        <Copy size={14} />
                    </button>
                    <button
                        onClick={() => setAutoScroll(!autoScroll)}
                        className={`p-1 rounded ${autoScroll ? 'text-primary' : 'text-text-muted hover:text-text-main'}`}
                        title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                    >
                        <ArrowDownToLine size={14} />
                    </button>
                    <button
                        onClick={clearLogs}
                        className="text-text-muted hover:text-text-main p-1 rounded"
                        title="Clear Logs"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
                {filteredLogs.length === 0 && (
                    <div className="text-text-muted/70 italic">
                        {searchQuery ? 'No logs match your search.' : 'Ready for automation...'}
                    </div>
                )}
                {filteredLogs.map((log, i) => (
                    <div key={i} className={`border-l-2 pl-2 ${log.type === 'error' ? 'border-red-500/50 text-red-400' : 'border-primary/30 text-text-main'}`}>
                        <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        {log.text}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};

export default LogPanel;
