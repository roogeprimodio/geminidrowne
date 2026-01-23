const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const DATA_FILENAME = 'onenote-data.json';
const CONTENT_DIR = 'onenote-content';

class LocalStore {
    constructor() {
        this.userDataPath = app.getPath('userData');
        this.dataPath = path.join(this.userDataPath, DATA_FILENAME);
        this.contentPath = path.join(this.userDataPath, CONTENT_DIR);
        this.init();
    }

    init() {
        try {
            fs.ensureDirSync(this.contentPath);
            if (!fs.existsSync(this.dataPath)) {
                this.saveData({ notebooks: [], lastSync: null });
            }
        } catch (err) {
            console.error('Store init failed:', err);
        }
    }

    getData() {
        try {
            return fs.readJsonSync(this.dataPath);
        } catch (error) {
            return { notebooks: [], lastSync: null };
        }
    }

    saveData(data) {
        try {
            fs.outputJsonSync(this.dataPath, data, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('Save failed:', error);
            return false;
        }
    }

    // Save HTML content for a specific page
    savePageContent(pageId, content) {
        try {
            const filePath = path.join(this.contentPath, `${pageId}.html`);
            fs.outputFileSync(filePath, content);
            return true;
        } catch (error) {
            console.error(`Failed to save content for ${pageId}:`, error);
            return false;
        }
    }

    // Get HTML content for a specific page
    getPageContent(pageId) {
        try {
            const filePath = path.join(this.contentPath, `${pageId}.html`);
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf-8');
            }
            return null;
        } catch (error) {
            console.error(`Failed to read content for ${pageId}:`, error);
            return null;
        }
    }
}

module.exports = new LocalStore();
