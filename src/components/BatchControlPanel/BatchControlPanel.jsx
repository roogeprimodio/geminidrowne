import React from 'react';
import { Square, Pause, Play, RotateCcw, CheckCircle2, X } from 'lucide-react';

/**
 * BatchControlPanel — floating bottom bar that appears while a batch automation is running.
 * Shows live progress, current page, Pause / Stop controls, and a Retry Gemini button.
 */
const BatchControlPanel = ({
    progress,          // { status, current, total, pageTitle, sectionName, skippedCount, processedCount }
    onPause,           // () => void
    onResume,          // () => void
    onStop,            // () => void
    onRetryGemini,     // () => void  — shown after chatgpt done
    onDismiss,         // () => void  — hide the bar after 'done' or 'stopped'
    isPaused,          // boolean
}) => {
    if (!progress || progress.status === 'idle' || !progress.status) return null;

    const { status, current, total, pageTitle, sectionName, skippedCount = 0, processedCount = 0 } = progress;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;

    const isDone = status === 'done';
    const isStopped = status === 'stopped';
    const isError = status === 'error';
    const isActive = status === 'running' || status === 'starting';

    const barColor = isDone ? 'bg-green-500' : isError || isStopped ? 'bg-red-500' : 'bg-purple-500';

    return (
        <div className={`
      fixed bottom-0 left-0 right-0 z-50
      border-t border-border bg-surface/95 backdrop-blur-md
      shadow-2xl transition-all duration-300
    `}>
            {/* Progress track */}
            <div className="h-1 w-full bg-surface-hover">
                <div
                    className={`h-full ${barColor} transition-all duration-500 ease-out`}
                    style={{ width: `${pct}%` }}
                />
            </div>

            <div className="flex items-center gap-3 px-4 py-2.5">

                {/* Status icon */}
                <div className="flex-shrink-0">
                    {isDone ? <CheckCircle2 size={18} className="text-green-400" /> :
                        isError ? <X size={18} className="text-red-400" /> :
                            isStopped ? <Square size={18} className="text-orange-400" /> :
                                <div className="w-3.5 h-3.5 rounded-full bg-purple-500 animate-pulse" />}
                </div>

                {/* Current page info */}
                <div className="flex-1 min-w-0">
                    {isActive ? (
                        <div>
                            <p className="text-xs text-text-muted truncate">
                                {sectionName ? <span className="text-text-muted">{sectionName} / </span> : null}
                                <span className="text-text-main font-medium">{pageTitle || 'Processing...'}</span>
                            </p>
                            <p className="text-[11px] text-text-muted mt-0.5">
                                {skippedCount > 0 && <span className="text-yellow-400/80 mr-2">⏭ {skippedCount} skipped</span>}
                                {processedCount > 0 && <span className="text-green-400/80">✓ {processedCount} done</span>}
                            </p>
                        </div>
                    ) : isDone ? (
                        <p className="text-xs text-green-400 font-medium">
                            ✅ Complete — {processedCount} processed, {skippedCount} skipped of {total} total
                        </p>
                    ) : isStopped ? (
                        <p className="text-xs text-orange-400 font-medium">
                            🛑 Stopped at {current} / {total}
                        </p>
                    ) : isError ? (
                        <p className="text-xs text-red-400 font-medium">❌ Error during automation</p>
                    ) : null}
                </div>

                {/* Counter */}
                <div className="flex-shrink-0 text-xs tabular-nums text-text-muted font-mono">
                    {current}/{total}
                </div>

                {/* Controls */}
                <div className="flex-shrink-0 flex items-center gap-1.5">
                    {isActive && (
                        isPaused ? (
                            <button
                                onClick={onResume}
                                title="Resume"
                                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-green-600 hover:bg-green-500 text-white transition-colors"
                            >
                                <Play size={13} />
                                Resume
                            </button>
                        ) : (
                            <button
                                onClick={onPause}
                                title="Pause"
                                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-surface-hover hover:bg-yellow-600 text-text-muted hover:text-white transition-colors border border-border"
                            >
                                <Pause size={13} />
                                Pause
                            </button>
                        )
                    )}

                    {(isActive || status === 'starting') && (
                        <button
                            onClick={onStop}
                            title="Stop"
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-900/60 hover:bg-red-600 text-red-300 hover:text-white transition-colors border border-red-800"
                        >
                            <Square size={13} />
                            Stop
                        </button>
                    )}

                    {isDone && onRetryGemini && (
                        <button
                            onClick={onRetryGemini}
                            title="Retry failed Gemini images"
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-purple-900/60 hover:bg-purple-600 text-purple-300 hover:text-white transition-colors border border-purple-800"
                        >
                            <RotateCcw size={13} />
                            Retry Gemini
                        </button>
                    )}

                    {(isDone || isStopped || isError) && (
                        <button
                            onClick={onDismiss}
                            title="Dismiss"
                            className="p-1 rounded-md text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BatchControlPanel;
