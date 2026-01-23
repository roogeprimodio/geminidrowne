import React, { useState, useEffect } from 'react';
import { X, Save, Key, FolderOpen } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose, onSave }) => {
    const [clientId, setClientId] = useState('');
    const [savePath, setSavePath] = useState('');

    useEffect(() => {
        if (isOpen) {
            const stored = localStorage.getItem('onenote_client_id');
            if (stored) setClientId(stored);
            loadSettings();
        }
    }, [isOpen]);

    const loadSettings = async () => {
        try {
            const result = await window.electronAPI.settingsGet('image_save_path');
            if (result.success && result.value) setSavePath(result.value);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    };

    const handleBrowse = async () => {
        try {
            const result = await window.electronAPI.selectDirectory();
            if (result.success && result.path) {
                setSavePath(result.path);
            }
        } catch (error) {
            console.error('Failed to select directory:', error);
        }
    };

    const handleSave = async () => {
        localStorage.setItem('onenote_client_id', clientId);
        try {
            await window.electronAPI.settingsSave({ key: 'image_save_path', value: savePath });
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
        onSave();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-md flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-xl font-semibold text-text-main flex items-center gap-2">
                        <Key size={20} className="text-purple-400" />
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-text-muted hover:text-text-main transition-colors p-1"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-main">Microsoft Client ID (Azure App)</label>
                        <input
                            type="text"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="e.g., 00000000-0000-0000-0000-000000000000"
                            className="w-full bg-surface-light border border-border rounded-md px-3 py-2 text-text-main placeholder-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                        />
                        <p className="text-xs text-text-muted">
                            Required for OneNote integration. You can get this from the Azure Portal.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-main">Image Save Location</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={savePath}
                                readOnly
                                placeholder="Select a folder..."
                                className="flex-1 bg-surface-light border border-border rounded-md px-3 py-2 text-text-main placeholder-text-muted/50 focus:outline-none"
                            />
                            <button
                                onClick={handleBrowse}
                                className="px-3 py-2 bg-surface hover:bg-surface-hover border border-border rounded-md text-text-main transition-colors"
                            >
                                <FolderOpen size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-text-muted">
                            Images will be saved here in folder structure: Notebook/Section/Page/
                        </p>
                    </div>
                </div>

                <div className="p-4 border-t border-border flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-main transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium flex items-center gap-2 transition-colors shadow-lg"
                    >
                        <Save size={16} />
                        Save Settings
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
