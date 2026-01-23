import React, { useState } from 'react';
import { Image, ExternalLink, RefreshCw, ZoomIn } from 'lucide-react';

const GalleryView = ({ assets = [], onOpenFolder }) => {
    const [selectedImage, setSelectedImage] = useState(null);

    if (assets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50">
                <Image size={48} className="mb-4" />
                <p>No images generated yet.</p>
                <p className="text-xs mt-1">Run an automation to see results here.</p>
            </div>
        );
    }

    return (
        <div className="h-full p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-text-main flex items-center gap-2">
                    <Image size={20} className="text-primary" />
                    Generated Gallery
                    <span className="text-xs font-normal text-text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
                        {assets.length}
                    </span>
                </h3>
                {onOpenFolder && (
                    <button
                        onClick={onOpenFolder}
                        className="text-xs flex items-center gap-1 text-primary hover:text-primary-hover hover:underline"
                    >
                        <ExternalLink size={14} />
                        Open Folder
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {assets.map((asset, index) => (
                    <div
                        key={asset.filePath || index}
                        className="group relative aspect-square bg-surface rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                        onClick={() => setSelectedImage(asset)}
                    >
                        {/* Image Preview - Using file:// protocol if allowed, or base64 if passed */}
                        {/* Note: React/Electron often blocks local file access directly from Render unless configured or using a specific protocol handler. 
                            We assume assets contain a 'src' property which is a safe URL (e.g. atom:// or custom protocol), or we retry using a base64 loader if needed.
                            For now, assuming the automation passed a usable path or we need a helper.
                        */}
                        <img
                            src={`file://${asset.filePath}`}
                            alt={asset.filename}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.parentElement.classList.add('flex', 'items-center', 'justify-center');
                                e.target.parentElement.innerHTML = '<span class="text-xs text-text-muted">Image not loaded</span>';
                            }}
                        />

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[1px]">
                            <button className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md">
                                <ZoomIn size={16} />
                            </button>
                        </div>

                        {/* Caption */}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] truncate">
                            {asset.filename}
                        </div>
                    </div>
                ))}
            </div>

            {/* Lightbox Modal */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setSelectedImage(null)}
                >
                    <div className="relative max-w-5xl max-h-full">
                        <img
                            src={`file://${selectedImage.filePath}`}
                            alt={selectedImage.filename}
                            className="max-h-[85vh] rounded shadow-2xl"
                        />
                        <p className="text-white/80 text-center mt-4 font-mono text-sm">{selectedImage.filename}</p>
                    </div>
                    <button className="absolute top-4 right-4 text-white/50 hover:text-white">
                        <ZoomIn className="rotate-45" size={32} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default GalleryView;
