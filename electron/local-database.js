const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class LocalDatabase {
    constructor() {
        const userDataPath = app.getPath('userData');
        const dbPath = path.join(userDataPath, 'onenote-cache.db');

        console.log('[LocalDB] Initializing database at:', dbPath);
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL'); // Better performance

        this.initTables();
    }

    initTables() {
        // Notebooks table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS notebooks (
                id TEXT PRIMARY KEY,
                displayName TEXT NOT NULL,
                lastModifiedDateTime TEXT,
                isDeleted INTEGER DEFAULT 0,
                data TEXT NOT NULL,
                syncedAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Section Groups table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS section_groups (
                id TEXT PRIMARY KEY,
                displayName TEXT NOT NULL,
                parentNotebookId TEXT,
                parentGroupId TEXT,
                isDeleted INTEGER DEFAULT 0,
                data TEXT NOT NULL,
                syncedAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sections table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sections (
                id TEXT PRIMARY KEY,
                displayName TEXT NOT NULL,
                parentNotebookId TEXT,
                parentGroupId TEXT,
                isDeleted INTEGER DEFAULT 0,
                data TEXT NOT NULL,
                syncedAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Pages table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                title TEXT,
                sectionId TEXT NOT NULL,
                lastModifiedDateTime TEXT,
                content TEXT,
                isDeleted INTEGER DEFAULT 0,
                data TEXT NOT NULL,
                syncedAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Prompts table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pageId TEXT NOT NULL,
                content TEXT NOT NULL,
                orderIndex INTEGER DEFAULT 0,
                isSkipped INTEGER DEFAULT 0,
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Settings table (for Base Prompt etc.)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('[LocalDB] Tables initialized');
    }

    // Save entire notebook hierarchy
    saveNotebooks(notebooks) {
        const insertNotebook = this.db.prepare(`
            INSERT OR REPLACE INTO notebooks (id, displayName, lastModifiedDateTime, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        const insertGroup = this.db.prepare(`
            INSERT OR REPLACE INTO section_groups (id, displayName, parentNotebookId, parentGroupId, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        const insertSection = this.db.prepare(`
            INSERT OR REPLACE INTO sections (id, displayName, parentNotebookId, parentGroupId, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        const insertPage = this.db.prepare(`
            INSERT OR REPLACE INTO pages (id, title, sectionId, lastModifiedDateTime, content, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        const saveTransaction = this.db.transaction((notebooks) => {
            for (const notebook of notebooks) {
                insertNotebook.run(
                    notebook.id,
                    notebook.displayName,
                    notebook.lastModifiedDateTime,
                    JSON.stringify(notebook)
                );

                // Save section groups recursively
                const saveGroups = (groups, notebookId, parentGroupId = null) => {
                    for (const group of groups || []) {
                        insertGroup.run(
                            group.id,
                            group.displayName,
                            notebookId,
                            parentGroupId,
                            JSON.stringify(group)
                        );

                        // Recursive nested groups
                        if (group.childGroups?.length) {
                            saveGroups(group.childGroups, notebookId, group.id);
                        }

                        // Save sections in this group
                        for (const section of group.sections || []) {
                            insertSection.run(
                                section.id,
                                section.displayName,
                                notebookId,
                                group.id,
                                JSON.stringify(section)
                            );

                            // Save pages
                            for (const page of section.pages || []) {
                                insertPage.run(
                                    page.id,
                                    page.title,
                                    section.id,
                                    page.lastModifiedDateTime,
                                    page.content || null,
                                    JSON.stringify(page)
                                );
                            }
                        }
                    }
                };

                saveGroups(notebook.childGroups || [], notebook.id);

                // Save sections directly under notebook
                for (const section of notebook.sections || []) {
                    insertSection.run(
                        section.id,
                        section.displayName,
                        notebook.id,
                        null,
                        JSON.stringify(section)
                    );

                    // Save pages
                    for (const page of section.pages || []) {
                        insertPage.run(
                            page.id,
                            page.title,
                            section.id,
                            page.lastModifiedDateTime,
                            page.content || null,
                            JSON.stringify(page)
                        );
                    }
                }
            }
        });

        saveTransaction(notebooks);
        console.log('[LocalDB] Saved', notebooks.length, 'notebooks');
    }

    // Save specific section groups
    saveSectionGroups(groups, parentId, parentType) {
        if (!groups || !groups.length) return;

        const parentNotebookId = parentType === 'notebook' ? parentId : null; // Logic might be complex if we only have ID
        // Actually, we need to know the parent hierarchy to fill parentNotebookId/parentGroupId correctly.
        // For simplicity, let's assume we pass what we know.
        // If parentType is 'notebook', parentNotebookId=parentId, parentGroupId=null
        // If parentType is 'sectionGroup', parentGroupId=parentId. But we need parentNotebookId... 
        // We might need to look it up or just update what we have.
        // For partial updates, maybe we just use UPSERT and trust the ID is unique.

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO section_groups (id, displayName, parentNotebookId, parentGroupId, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        // We might need to query the existing entry to preserve parentNotebookId if we don't have it
        const getExisting = this.db.prepare('SELECT parentNotebookId FROM section_groups WHERE id = ?');

        const transaction = this.db.transaction((groups) => {
            for (const group of groups) {
                let pNotebookId = null;
                let pGroupId = null;

                if (parentType === 'notebook') {
                    pNotebookId = parentId;
                } else {
                    pGroupId = parentId;
                    // Look up parent group to get notebook ID
                    const parentGroup = this.db.prepare('SELECT parentNotebookId FROM section_groups WHERE id = ?').get(parentId);
                    if (parentGroup) {
                        pNotebookId = parentGroup.parentNotebookId;
                    } else {
                        // Fallback: search existing entry if it's an update
                        const existing = getExisting.get(group.id);
                        if (existing) pNotebookId = existing.parentNotebookId;
                    }
                }

                stmt.run(
                    group.id,
                    group.displayName,
                    pNotebookId,
                    pGroupId,
                    JSON.stringify(group)
                );
            }
        });
        transaction(groups);
    }

    // Save specific sections
    saveSections(sections, parentId, parentType) {
        if (!sections || !sections.length) return;

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sections (id, displayName, parentNotebookId, parentGroupId, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `);

        const getExisting = this.db.prepare('SELECT parentNotebookId FROM sections WHERE id = ?');

        const transaction = this.db.transaction((sections) => {
            for (const section of sections) {
                let pNotebookId = null;
                let pGroupId = null;

                if (parentType === 'notebook') {
                    pNotebookId = parentId;
                } else {
                    pGroupId = parentId;
                    // Look up parent group to get notebook ID
                    const parentGroup = this.db.prepare('SELECT parentNotebookId FROM section_groups WHERE id = ?').get(parentId);
                    if (parentGroup) {
                        pNotebookId = parentGroup.parentNotebookId;
                    } else {
                        const existing = getExisting.get(section.id);
                        if (existing) pNotebookId = existing.parentNotebookId;
                    }
                }

                stmt.run(
                    section.id,
                    section.displayName,
                    pNotebookId,
                    pGroupId,
                    JSON.stringify(section)
                );
            }
        });
        transaction(sections);
    }

    // Save specific pages
    savePages(pages, sectionId) {
        if (!pages || !pages.length) return;

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO pages (id, title, sectionId, lastModifiedDateTime, content, data, isDeleted, syncedAt)
            VALUES (?, ?, ?, ?, coalesce((SELECT content FROM pages WHERE id = ?), ?), ?, 0, CURRENT_TIMESTAMP)
        `);

        const transaction = this.db.transaction((pages) => {
            for (const page of pages) {
                stmt.run(
                    page.id,
                    page.title,
                    sectionId,
                    page.lastModifiedDateTime,
                    page.id, // for subquery
                    page.content || null, // default content
                    JSON.stringify(page)
                );
            }
        });
        transaction(pages);
    }

    // Load all notebooks from local DB
    loadNotebooks() {
        const notebooks = this.db.prepare('SELECT * FROM notebooks ORDER BY displayName ASC').all();

        if (!notebooks.length) {
            console.log('[LocalDB] No cached notebooks found');
            return [];
        }

        const result = notebooks.map(nb => {
            const notebook = JSON.parse(nb.data);
            notebook.isDeleted = nb.isDeleted === 1;

            // Load section groups
            const loadGroups = (parentGroupId = null) => {
                const groups = this.db.prepare(`
                    SELECT * FROM section_groups 
                    WHERE parentNotebookId = ? AND parentGroupId ${parentGroupId ? '= ?' : 'IS NULL'}
                    ORDER BY displayName ASC
                `).all(parentGroupId ? [notebook.id, parentGroupId] : [notebook.id]);

                return groups.map(g => {
                    const group = JSON.parse(g.data);
                    group.isDeleted = g.isDeleted === 1;

                    // Recursive nested groups
                    group.childGroups = loadGroups(group.id);

                    // Load sections in this group
                    const sections = this.db.prepare(`
                        SELECT * FROM sections 
                        WHERE parentGroupId = ?
                        ORDER BY displayName ASC
                    `).all(group.id);

                    group.sections = sections.map(s => {
                        const section = JSON.parse(s.data);
                        section.isDeleted = s.isDeleted === 1;

                        // Load pages
                        const pages = this.db.prepare(`
                            SELECT * FROM pages 
                            WHERE sectionId = ?
                            ORDER BY title ASC
                        `).all(section.id);

                        section.pages = pages.map(p => {
                            const page = JSON.parse(p.data);
                            page.isDeleted = p.isDeleted === 1;
                            page.content = p.content;
                            return page;
                        });

                        return section;
                    });

                    return group;
                });
            };

            notebook.childGroups = loadGroups();

            // Load sections directly under notebook
            const sections = this.db.prepare(`
                SELECT * FROM sections 
                WHERE parentNotebookId = ? AND parentGroupId IS NULL
                ORDER BY displayName ASC
            `).all(notebook.id);

            notebook.sections = sections.map(s => {
                const section = JSON.parse(s.data);
                section.isDeleted = s.isDeleted === 1;

                // Load pages
                const pages = this.db.prepare(`
                    SELECT * FROM pages 
                    WHERE sectionId = ?
                    ORDER BY title ASC
                `).all(section.id);

                section.pages = pages.map(p => {
                    const page = JSON.parse(p.data);
                    page.isDeleted = p.isDeleted === 1;
                    page.content = p.content;
                    return page;
                });

                return section;
            });

            return notebook;
        });

        console.log('[LocalDB] Loaded', result.length, 'notebooks from cache');
        return result;
    }

    // Mark items as deleted (soft delete)
    markAsDeleted(type, ids) {
        const table = {
            'notebook': 'notebooks',
            'sectionGroup': 'section_groups',
            'section': 'sections',
            'page': 'pages'
        }[type];

        if (!table) return;

        const stmt = this.db.prepare(`UPDATE ${table} SET isDeleted = 1 WHERE id = ?`);
        const transaction = this.db.transaction((ids) => {
            for (const id of ids) {
                stmt.run(id);
            }
        });

        transaction(ids);
        console.log(`[LocalDB] Marked ${ids.length} ${type}(s) as deleted`);
    }

    // Save page content
    savePageContent(pageId, content) {
        this.db.prepare(`
            UPDATE pages 
            SET content = ?, syncedAt = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(content, pageId);
    }

    // Get pages for a section (metadata only for list/sync comparison)
    getPages(sectionId) {
        const pages = this.db.prepare(`
            SELECT id, title, lastModifiedDateTime, isDeleted, sectionId FROM pages 
            WHERE sectionId = ?
            ORDER BY title ASC
        `).all(sectionId);

        return pages.map(p => ({
            id: p.id,
            title: p.title,
            lastModifiedDateTime: p.lastModifiedDateTime,
            sectionId: p.sectionId,
            isDeleted: p.isDeleted === 1,
            content: null // Explicitly null to indicate need to fetch if validating
        }));
    }

    // Get single page with content
    getPage(pageId) {
        const p = this.db.prepare(`
            SELECT * FROM pages WHERE id = ?
        `).get(pageId);

        if (!p) return null;

        const page = JSON.parse(p.data);
        page.isDeleted = p.isDeleted === 1;
        page.content = p.content;
        return page;
    }

    // --- Prompts Management ---

    getPrompts(pageId) {
        return this.db.prepare(`
            SELECT * FROM prompts 
            WHERE pageId = ? 
            ORDER BY orderIndex ASC, id ASC
        `).all(pageId);
    }

    addPrompt(pageId, content) {
        const result = this.db.prepare(`
            INSERT INTO prompts (pageId, content, orderIndex)
            VALUES (?, ?, (SELECT COALESCE(MAX(orderIndex), 0) + 1 FROM prompts WHERE pageId = ?))
        `).run(pageId, content, pageId);
        return result.lastInsertRowid;
    }

    updatePromptSkip(id, isSkipped) {
        this.db.prepare('UPDATE prompts SET isSkipped = ? WHERE id = ?').run(isSkipped ? 1 : 0, id);
    }

    updateAllPromptsSkip(pageId, isSkipped) {
        this.db.prepare('UPDATE prompts SET isSkipped = ? WHERE pageId = ?').run(isSkipped ? 1 : 0, pageId);
    }

    deletePrompt(id) {
        this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    }

    // --- Settings Management ---

    getSetting(key) {
        const result = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return result ? result.value : null;
    }

    saveSetting(key, value) {
        this.db.prepare(`
            INSERT OR REPLACE INTO settings (key, value, updatedAt)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `).run(key, value);
    }

    // Get last sync time
    getLastSyncTime() {
        const result = this.db.prepare(`
            SELECT MAX(syncedAt) as lastSync FROM (
                SELECT syncedAt FROM notebooks
                UNION ALL SELECT syncedAt FROM section_groups
                UNION ALL SELECT syncedAt FROM sections
                UNION ALL SELECT syncedAt FROM pages
            )
        `).get();

        return result?.lastSync || null;
    }

    close() {
        this.db.close();
    }

    // Get full hierarchy path for a page
    getPageHierarchyPath(pageId) {
        const page = this.db.prepare('SELECT title, sectionId FROM pages WHERE id = ?').get(pageId);
        if (!page) return null;

        const pathArray = [page.title || 'Untitled Page'];

        let currentSection = this.db.prepare('SELECT displayName, parentNotebookId, parentGroupId FROM sections WHERE id = ?').get(page.sectionId);
        if (currentSection) {
            pathArray.unshift(currentSection.displayName);

            let currentGroupId = currentSection.parentGroupId;
            // Traverse up Section Groups
            while (currentGroupId) {
                const group = this.db.prepare('SELECT displayName, parentGroupId, parentNotebookId FROM section_groups WHERE id = ?').get(currentGroupId);
                if (group) {
                    pathArray.unshift(group.displayName);
                    currentGroupId = group.parentGroupId;
                } else {
                    currentGroupId = null;
                }
            }

            // Get Notebook
            const notebookId = currentSection.parentNotebookId ||
                this.db.prepare('SELECT parentNotebookId FROM section_groups WHERE id = ?').get(currentSection.parentGroupId)?.parentNotebookId;

            if (notebookId) {
                const notebook = this.db.prepare('SELECT displayName FROM notebooks WHERE id = ?').get(notebookId);
                if (notebook) {
                    pathArray.unshift(notebook.displayName);
                }
            }
        }

        return pathArray; // [Notebook, Group?, Section, Page]
    }
}

module.exports = LocalDatabase;
