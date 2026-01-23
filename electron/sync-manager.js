const localStore = require('./store');

class SyncManager {
    constructor(oneNoteService) {
        this.service = oneNoteService;
        this.shouldStop = false;
        this.limit = null;
    }

    cancel() {
        this.shouldStop = true;
    }

    async syncAll(onProgress) {
        // Dynamically import p-limit to comply with ES module structure if needed, or use require check
        const pLimit = (await import('p-limit')).default;
        this.limit = pLimit(3); // Concurrency limit of 3

        this.shouldStop = false;
        try {
            // 1. Get Local Data Map for comparison
            const localData = localStore.getData();
            const localNotebooks = localData.notebooks || [];
            const localMap = this.buildMap(localNotebooks);

            // 2. Fetch Remote Notebooks
            if (onProgress) onProgress('Fetching notebooks...');
            const remoteNotebooks = await this.service.fetchNotebooks();

            // 3. Process each notebook concurrently
            const notebookPromises = remoteNotebooks.map((nb, i) => {
                return this.limit(async () => {
                    if (this.shouldStop) return null;
                    if (onProgress) onProgress(`Syncing notebook: ${nb.displayName} (${i + 1}/${remoteNotebooks.length})`);
                    return await this.syncNotebookNode(nb, localMap.get(nb.id));
                });
            });

            const mergedNotebooksRaw = await Promise.all(notebookPromises);
            const mergedNotebooks = mergedNotebooksRaw.filter(nb => nb !== null);

            // 4. Mark missing notebooks as deleted
            localNotebooks.forEach(localNb => {
                const stillExists = remoteNotebooks.find(rn => rn.id === localNb.id);
                if (!stillExists) {
                    mergedNotebooks.push({ ...localNb, _deleted: true });
                }
            });

            // 5. Save to Local Store
            localStore.saveData({
                notebooks: mergedNotebooks,
                lastSync: new Date().toISOString()
            });

            return mergedNotebooks;

        } catch (error) {
            console.error('Sync failed:', error);
            throw error;
        }
    }

    async syncNotebookNode(remoteNb, localNb) {
        // Deep fetch children concurrently
        const [sections, sectionGroups] = await Promise.all([
            this.service.fetchSections(remoteNb.id, 'notebook').catch(err => {
                console.warn(`Failed to fetch sections for notebook ${remoteNb.displayName}`, err);
                return [];
            }),
            this.service.fetchSectionGroups(remoteNb.id, 'notebook').catch(err => {
                console.warn(`Failed to fetch section groups for notebook ${remoteNb.displayName}`, err);
                return [];
            })
        ]);

        // Process Sections
        const mergedSections = await this.syncSections(sections, localNb?.sections);

        // Process Section Groups
        const mergedGroups = await this.syncSectionGroups(sectionGroups, localNb?.childGroups);

        return {
            ...remoteNb,
            type: 'notebook',
            sections: mergedSections,
            childGroups: mergedGroups,
            _syncedAt: new Date().toISOString()
        };
    }

    async syncSectionGroups(remoteGroups, localGroups = []) {
        const localMap = new Map(localGroups.map(g => [g.id, g]));

        const groupPromises = remoteGroups.map(rg => {
            return this.limit(async () => {
                if (this.shouldStop) return null;
                const localG = localMap.get(rg.id);

                // Recurse concurrently
                const [sections, subGroups] = await Promise.all([
                    this.service.fetchSections(rg.id, 'sectionGroup').catch(e => []),
                    this.service.fetchSectionGroups(rg.id, 'sectionGroup').catch(e => [])
                ]);

                const processedSections = await this.syncSections(sections, localG?.sections);
                const processedSubGroups = await this.syncSectionGroups(subGroups, localG?.childGroups);

                return {
                    ...rg,
                    type: 'sectionGroup',
                    sections: processedSections,
                    childGroups: processedSubGroups
                };
            });
        });

        const mergedRaw = await Promise.all(groupPromises);
        let merged = mergedRaw.filter(g => g !== null);

        // Handle deleted
        localGroups.forEach(lg => {
            if (!remoteGroups.find(rg => rg.id === lg.id)) {
                merged.push({ ...lg, _deleted: true });
            }
        });

        return merged;
    }

    async syncSections(remoteSections, localSections = []) {
        const merged = [];
        const localMap = new Map(localSections.map(s => [s.id, s]));

        // We process sections in parallel but with the same shared limit
        const sectionPromises = remoteSections.map(rs => {
            return this.limit(async () => {
                const localS = localMap.get(rs.id);
                let pages = localS?.pages || [];
                try {
                    const remotePages = await this.service.fetchPages(rs.id);
                    pages = this.mergePages(remotePages, pages);
                } catch (e) {
                    console.warn(`Failed to sync pages for section ${rs.displayName}`, e);
                }

                return {
                    ...rs,
                    type: 'section',
                    pages: pages
                };
            });
        });

        const syncedSections = await Promise.all(sectionPromises);
        merged.push(...syncedSections);

        // Handle deleted
        localSections.forEach(ls => {
            if (!remoteSections.find(rs => rs.id === ls.id)) {
                merged.push({ ...ls, _deleted: true });
            }
        });

        return merged;
    }

    mergePages(remotePages, localPages) {
        // Logic to merge page lists and mark deleted
        const merged = [];
        const localMap = new Map(localPages.map(p => [p.id, p]));

        remotePages.forEach(rp => {
            const lp = localMap.get(rp.id);
            merged.push({ ...rp, _cached: lp?._cached || false }); // Preserve cached flag
        });

        localPages.forEach(lp => {
            if (!remotePages.find(rp => rp.id === lp.id)) {
                merged.push({ ...lp, _deleted: true });
            }
        });

        return merged;
    }

    buildMap(items) {
        return new Map(items.map(i => [i.id, i]));
    }
}

module.exports = SyncManager;
