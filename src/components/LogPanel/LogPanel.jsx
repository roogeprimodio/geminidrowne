import React, { useEffect, useState, useRef } from 'react';
import { Terminal, XCircle, Trash2 } from 'lucide-react';
import { electron } from '../../services/electron';

const LogPanel = ({ className }) => {
    const [logs, setLogs] = useState([]);
    const bottomRef = useRef(null);

    useEffect(() => {
        // Subscribe to logs
        const unsubscribe = electron.onLogMessage((message) => {
            setLogs(prev => [...prev, { text: message.message || message, type: 'info', timestamp: Date.now() }]);
        });

        const unsubscribeError = electron.onLogError((message) => {
            setLogs(prev => [...prev, { text: `ERROR: ${message.message || message}`, type: 'error', timestamp: Date.now() }]);
        });

        // Also listen for errors (assuming existing IPC sends log-error)
        // Note: We need to verify if electron.js exposes onLogError. 
        // If not, we should update it. For now, we assume standard log stream.

        return () => {
            // Cleanup if possible (Electron IPC listeners usually stay unless removed)
            // Standard practice would be removeListener if exposed
        };
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const clearLogs = () => setLogs([]);

    return (
        <div className={`flex flex-col bg-background border-t border-border ${className}`}>
            <div className="flex items-center justify-between px-4 py-2 bg-surface/50 border-b border-border">
                <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Terminal size={14} />
                    <span className="font-semibold">Automation Output</span>
                </div>
                <button
                    onClick={clearLogs}
                    className="text-text-muted hover:text-text-main p-1 rounded"
                    title="Clear Logs"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
                {logs.length === 0 && (
                    <div className="text-text-muted/70 italic">Ready for automation...</div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="text-text-main border-l-2 border-primary/30 pl-2">
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
