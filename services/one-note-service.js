const { PublicClientApplication, LogLevel } = require("@azure/msal-node");
const axios = require("axios");

const fs = require('fs');
const path = require('path');

class OneNoteService {
    constructor() {
        this.pca = null;
        this.account = null;
        this.tokenResponse = null;
        this.cachePath = null;
        // Rate limiting and retry configuration
        this.rateLimitDelay = 3000; // Start with 3 seconds delay
        this.maxRetries = 1; // Only 1 retry to avoid long waits
        this.maxRateLimitDelay = 60000; // Max 60 seconds delay
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000; // Minimum 1 second between requests
        this.requestCounter = 0;
        this.requestWindowStart = Date.now();
        this.maxRequestsPerWindow = 20; // Max 20 requests per minute
    }

    // Helper function for rate limiting with exponential backoff
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Retry logic with exponential backoff for rate limiting
    async makeRequestWithRetry(requestFn, context = '') {
        let retries = 0;
        let currentDelay = this.rateLimitDelay;

        while (retries <= this.maxRetries) {
            try {
                // Check request window and throttle if needed
                const now = Date.now();
                const windowElapsed = now - this.requestWindowStart;

                // Reset window every minute
                if (windowElapsed > 60000) {
                    this.requestCounter = 0;
                    this.requestWindowStart = now;
                }

                // If we've hit the limit in this window, wait until the next window
                if (this.requestCounter >= this.maxRequestsPerWindow) {
                    const waitTime = 60000 - windowElapsed;
                    if (waitTime > 0) {
                        console.warn(`🛑 Microsoft Graph API limit: Waiting ${(waitTime / 1000).toFixed(1)}s for next request window (context: ${context})`);
                        console.warn(`📊 API Usage: ${this.requestCounter}/${this.maxRequestsPerWindow} requests this minute`);
                        await this.sleep(waitTime);
                        this.requestCounter = 0;
                        this.requestWindowStart = Date.now();
                    }
                }

                // Enforce minimum interval between requests
                const timeSinceLastRequest = now - this.lastRequestTime;
                if (timeSinceLastRequest < this.minRequestInterval) {
                    await this.sleep(this.minRequestInterval - timeSinceLastRequest);
                }

                const result = await requestFn();
                this.lastRequestTime = Date.now();
                this.requestCounter++;

                // Reset delay on successful request
                this.rateLimitDelay = 3000;
                return result;
            } catch (error) {
                if (error.response?.status === 429) {
                    retries++;

                    if (retries > this.maxRetries) {
                        const errorMsg = `Microsoft Graph API rate limit exceeded after ${this.maxRetries} retries for ${context}. 
                        
Microsoft Graph API Limits:
- 5 requests per minute per app (very strict)
- 20,000 requests per tenant per day
- Retry-After header may specify wait time
- OneNote has additional throttling limits

Please wait several minutes and try again.`;
                        throw new Error(errorMsg);
                    }

                    // Extract retry-after header if available, otherwise use exponential backoff
                    const retryAfter = error.response.headers['retry-after'];
                    const delayMs = retryAfter ?
                        (parseInt(retryAfter) * 1000) :
                        Math.min(currentDelay * 2, this.maxRateLimitDelay);

                    console.warn(`🚫 Microsoft Graph API rate limit hit for ${context}.`);
                    console.warn(`⏱️ Retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${retries}/${this.maxRetries})`);
                    console.warn(`📊 Current usage: ${this.requestCounter}/${this.maxRequestsPerWindow} requests this minute`);
                    await this.sleep(delayMs);

                    // Exponential backoff for next attempt
                    currentDelay = Math.min(currentDelay * 2, this.maxRateLimitDelay);
                } else {
                    // For non-429 errors, don't retry
                    throw error;
                }
            }
        }
    }

    initialize(clientId, redirectUri, userDataPath) {
        this.cachePath = path.join(userDataPath || '.', 'onenote-auth-cache.json');

        const cachePlugin = {
            beforeCacheAccess: async (cacheContext) => {
                try {
                    if (fs.existsSync(this.cachePath)) {
                        const data = fs.readFileSync(this.cachePath, "utf-8");
                        cacheContext.tokenCache.deserialize(data);
                    }
                } catch (e) {
                    console.error("Cache read error:", e);
                }
            },
            afterCacheAccess: async (cacheContext) => {
                if (cacheContext.cacheHasChanged) {
                    try {
                        const data = cacheContext.tokenCache.serialize();
                        fs.writeFileSync(this.cachePath, data);
                    } catch (e) {
                        console.error("Cache write error:", e);
                    }
                }
            }
        };

        this.config = {
            auth: {
                clientId: clientId || "PLACEHOLDER_CLIENT_ID",
                authority: "https://login.microsoftonline.com/common",
            },
            cache: {
                cachePlugin
            },
            system: {
                loggerOptions: {
                    loggerCallback(loglevel, message) {
                        // console.log(message); // Too verbose
                    },
                    piiLoggingEnabled: false,
                    logLevel: LogLevel.Info,
                },
            }
        };

        this.redirectUri = redirectUri || "http://localhost:3000";
        this.pca = new PublicClientApplication(this.config);
    }

    async trySilentLogin() {
        if (!this.pca) return { success: false };
        try {
            const accounts = await this.pca.getTokenCache().getAllAccounts();
            if (accounts.length > 0) {
                this.account = accounts[0];
                const token = await this.getAccessToken();
                if (token) {
                    return { success: true, account: this.account };
                }
            }
        } catch (err) {
            console.error("Silent login check failed:", err);
        }
        return { success: false };
    }

    async getAuthUrl() {
        if (!this.pca) throw new Error("OneNote Service not initialized");

        const authCodeUrlParameters = {
            scopes: ["user.read", "notes.read", "offline_access"],
            redirectUri: this.redirectUri,
        };

        return await this.pca.getAuthCodeUrl(authCodeUrlParameters);
    }

    async acquireTokenByCode(code) {
        const tokenRequest = {
            code: code,
            scopes: ["user.read", "notes.read", "offline_access"],
            redirectUri: this.redirectUri,
        };

        this.tokenResponse = await this.pca.acquireTokenByCode(tokenRequest);
        this.account = this.tokenResponse.account;
        return this.tokenResponse;
    }

    async getAccessToken() {
        if (!this.account || !this.pca) return null;

        const silentRequest = {
            account: this.account,
            scopes: ["user.read", "notes.read", "offline_access"],
        };

        try {
            this.tokenResponse = await this.pca.acquireTokenSilent(silentRequest);
            return this.tokenResponse.accessToken;
        } catch (error) {
            console.error("Silent token acquisition failed, re-auth might be needed", error);
            return null;
        }
    }

    async fetchNotebooks() {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available. Please login.");

        const response = await axios.get("https://graph.microsoft.com/v1.0/me/onenote/notebooks", {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                "$select": "id,displayName,lastModifiedDateTime",
                "$orderby": "displayName asc"  // Sort by name alphabetically instead of date
            }
        });

        return response.data.value.map(n => ({ ...n, type: 'notebook' }));
    }

    async fetchSectionGroups(parentId, parentType = 'notebook') {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const endpoint = parentType === 'notebook'
            ? `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${parentId}/sectionGroups`
            : `https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${parentId}/sectionGroups`;

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get(endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                params: { "$select": "id,displayName,lastModifiedDateTime" }
            });
            return response.data.value.map(sg => ({ ...sg, type: 'sectionGroup' }));
        }, `fetchSectionGroups(${parentId})`);
    }

    async fetchSections(parentId, parentType = 'notebook') {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const endpoint = parentType === 'notebook'
            ? `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${parentId}/sections`
            : `https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${parentId}/sections`;

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get(endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                params: { "$select": "id,displayName,lastModifiedDateTime" }
            });
            return response.data.value.map(s => ({ ...s, type: 'section' }));
        }, `fetchSections(${parentId})`);
    }

    async fetchPages(sectionId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    "$select": "id,title,lastModifiedDateTime",
                    "$orderby": "title asc"
                }
            });
            return response.data.value.map(p => ({ ...p, type: 'page' }));
        }, `fetchPages(${sectionId})`);
    }

    async fetchRecentPages() {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available. Please login.");

        const today = new Date();
        today.setDate(today.getDate() - 3); // Last 3 days instead of just 24h for better usability
        const dateString = today.toISOString();

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get("https://graph.microsoft.com/v1.0/me/onenote/pages", {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                    "$filter": `lastModifiedDateTime ge ${dateString}`,
                    "$orderby": "lastModifiedDateTime desc",
                    "$select": "id,title,lastModifiedDateTime"
                }
            });
            return response.data.value.map(p => ({ ...p, type: 'page' }));
        }, 'fetchRecentPages');
    }

    async fetchPageContent(pageId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}/content?includeIDs=true`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return response.data;
        }, `fetchPageContent(${pageId})`);
    }

    async getPageMetadata(pageId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        return await this.makeRequestWithRetry(async () => {
            const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}?$select=id,title,lastModifiedDateTime`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return response.data;
        }, `getPageMetadata(${pageId})`);
    }

    // NEW: Batch request method for fetching multiple resources in one request
    async makeBatchRequest(requests, context = '') {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        return await this.makeRequestWithRetry(async () => {
            const batchRequest = {
                requests: requests.map((req, index) => ({
                    id: index.toString(),
                    method: "GET",
                    url: req.url,
                    headers: req.headers || {}
                }))
            };

            const response = await axios.post('https://graph.microsoft.com/v1.0/$batch', batchRequest, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            // Process batch response
            return response.data.responses.map(resp => {
                if (resp.status === 200) {
                    return resp.body;
                } else {
                    throw new Error(`Batch request failed: ${resp.body?.error?.message || 'Unknown error'}`);
                }
            });
        }, `batchRequest(${context})`);
    }

    // NEW: Single mega-batch request to fetch entire notebook in one request
    async fetchEntireNotebookInOneRequest(notebookId, progressCallback = null) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const hierarchy = {
            notebook: null,
            sectionGroups: [],
            sections: [],
            pages: []
        };

        try {
            if (progressCallback) {
                progressCallback({
                    status: 'building_batch',
                    message: '🔧 Building mega-batch request for entire notebook...'
                });
            }

            // Step 1: Get notebook info first
            hierarchy.notebook = await this.makeRequestWithRetry(async () => {
                const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebookId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { "$select": "id,displayName,lastModifiedDateTime" }
                });
                return { ...response.data, type: 'notebook' };
            }, `fetchNotebook(${notebookId})`);

            if (progressCallback) {
                progressCallback({
                    status: 'discovering_structure',
                    message: `🔍 Discovering notebook structure for "${hierarchy.notebook.displayName}"...`
                });
            }

            // Step 2: Discover complete structure with minimal requests
            const rootSections = await this.makeRequestWithRetry(async () => {
                const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebookId}/sections?$select=id,displayName,lastModifiedDateTime`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return response.data.value.map(s => ({ ...s, type: 'section', isRoot: true }));
            }, `fetchRootSections(${notebookId})`);

            const rootSectionGroups = await this.makeRequestWithRetry(async () => {
                const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebookId}/sectionGroups?$select=id,displayName,lastModifiedDateTime`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return response.data.value.map(sg => ({ ...sg, type: 'sectionGroup', depth: 0 }));
            }, `fetchRootSectionGroups(${notebookId})`);

            // Step 3: Recursively discover all section groups
            const allSectionGroups = await this.discoverAllSectionGroups(rootSectionGroups, token);

            // Step 4: Get all sections from all section groups
            const allSections = [...rootSections];
            for (const sg of allSectionGroups) {
                if (progressCallback) {
                    progressCallback({
                        status: 'discovering_sections',
                        message: `📁 Discovering sections in group: ${sg.displayName}...`
                    });
                }

                const sgSections = await this.makeRequestWithRetry(async () => {
                    const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${sg.id}/sections?$select=id,displayName,lastModifiedDateTime`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    return response.data.value.map(s => ({
                        ...s,
                        type: 'section',
                        parentGroupId: sg.id,
                        parentGroupName: sg.displayName
                    }));
                }, `fetchSections(${sg.id})`);
                allSections.push(...sgSections);
            }

            hierarchy.sectionGroups = allSectionGroups;
            hierarchy.sections = allSections;

            if (progressCallback) {
                progressCallback({
                    status: 'building_mega_batch',
                    message: `📦 Building mega-batch for ${hierarchy.sections.length} sections...`
                });
            }

            // Step 5: Create mega-batch request for ALL pages
            const allPageRequests = hierarchy.sections.map((section, index) => ({
                id: index.toString(),
                method: "GET",
                url: `/me/onenote/sections/${section.id}/pages?$select=id,title,lastModifiedDateTime&$orderby=title asc`,
                headers: {}
            }));

            // Process in mega-batches of 20 (Microsoft's batch limit)
            const batchSize = 20;
            const totalBatches = Math.ceil(allPageRequests.length / batchSize);

            for (let i = 0; i < allPageRequests.length; i += batchSize) {
                const batch = allPageRequests.slice(i, i + batchSize);
                const currentBatch = Math.floor(i / batchSize) + 1;

                if (progressCallback) {
                    progressCallback({
                        status: 'fetching_pages_batch',
                        message: `📦 Fetching pages batch ${currentBatch}/${totalBatches} (${batch.length} sections)...`
                    });
                }

                const batchResponse = await this.makeBatchRequest(batch, `megaBatchPages(${currentBatch})`);

                // Process batch response
                batchResponse.forEach((response, batchIndex) => {
                    const sectionIndex = i + batchIndex;
                    const section = hierarchy.sections[sectionIndex];
                    if (response?.value) {
                        const pages = response.value.map(p => ({
                            ...p,
                            type: 'page',
                            sectionId: section.id,
                            sectionName: section.displayName
                        }));
                        hierarchy.pages.push(...pages);
                    }
                });

                if (progressCallback) {
                    const fetchedPages = hierarchy.pages.length;
                    const totalPages = hierarchy.sections.reduce((sum, s) => {
                        const sectionPages = allPageRequests.filter(req => req.url.includes(s.id)).length;
                        return sum + sectionPages;
                    }, 0);
                    const progress = Math.round((fetchedPages / totalPages) * 100);
                    progressCallback({
                        status: 'pages_progress',
                        message: `📄 Downloaded ${fetchedPages}/${totalPages} pages (${progress}%)...`
                    });
                }
            }

            return hierarchy;
        } catch (error) {
            throw new Error(`Failed to fetch entire notebook in one request: ${error.message}`);
        }
    }

    // Helper: Discover all section groups recursively
    async discoverAllSectionGroups(sectionGroups, token, depth = 0) {
        if (depth > 5) {
            return sectionGroups;
        }

        const allSectionGroups = [...sectionGroups];
        const currentLevel = sectionGroups.filter(sg => sg.depth === depth);

        if (currentLevel.length === 0) {
            return allSectionGroups;
        }

        for (const sg of currentLevel) {
            const nestedGroups = await this.makeRequestWithRetry(async () => {
                const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${sg.id}/sectionGroups?$select=id,displayName,lastModifiedDateTime`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return response.data.value.map(nsg => ({
                    ...nsg,
                    type: 'sectionGroup',
                    depth: depth + 1,
                    parentGroupId: sg.id
                }));
            }, `fetchNestedSectionGroups(${sg.id})`);
            allSectionGroups.push(...nestedGroups);
        }

        return await this.discoverAllSectionGroups(allSectionGroups, token, depth + 1);
    }

    // NEW: Fetch complete notebook structure (outline only)
    async fetchNotebookStructure(notebookId, progressCallback = null) {
        try {
            if (progressCallback) {
                progressCallback({
                    status: 'discovering_structure',
                    message: '🔍 Discovering notebook structure...'
                });
            }

            const token = await this.getAccessToken();

            // Build batch requests for structure discovery
            const requests = [
                { id: '1', method: 'GET', url: `/me/onenote/notebooks/${notebookId}/sections?$select=id,displayName,parentSectionGroup,parentNotebook` },
                { id: '2', method: 'GET', url: `/me/onenote/notebooks/${notebookId}/sectionGroups?$select=id,displayName,parentSectionGroup,parentNotebook&$expand=sections($select=id,displayName)` }
            ];

            const batchResponse = await this.makeBatchRequest(requests, `fetchStructure(${notebookId})`);

            if (!batchResponse.responses || batchResponse.responses.length === 0) {
                throw new Error('No structure data received');
            }

            const sectionsResponse = batchResponse.responses.find(r => r.id === '1');
            const sectionGroupsResponse = batchResponse.responses.find(r => r.id === '2');

            const sections = sectionsResponse?.body?.value || [];
            const sectionGroups = sectionGroupsResponse?.body?.value || [];

            // Build hierarchical structure
            const structure = {
                notebookId,
                sections: sections.map(s => ({
                    ...s,
                    type: 'section',
                    level: 0,
                    parentPath: []
                })),
                sectionGroups: await this.buildSectionGroupHierarchy(notebookId, sectionGroups, progressCallback)
            };

            if (progressCallback) {
                progressCallback({
                    status: 'structure_complete',
                    message: `📋 Structure discovered: ${structure.sections.length} sections, ${structure.sectionGroups.length} section groups`
                });
            }

            return structure;
        } catch (error) {
            if (progressCallback) {
                progressCallback({
                    status: 'structure_error',
                    message: `❌ Structure discovery failed: ${error.message}`
                });
            }
            throw error;
        }
    }

    // NEW: Build hierarchical section group structure
    async buildSectionGroupHierarchy(notebookId, sectionGroups, progressCallback = null, depth = 0, parentPath = []) {
        const hierarchy = [];

        for (const group of sectionGroups) {
            const currentPath = [...parentPath, group.displayName];

            if (progressCallback && depth <= 2) {
                progressCallback({
                    status: 'building_hierarchy',
                    message: `📂 Building structure: ${currentPath.join(' > ')}`
                });
            }

            const groupData = {
                ...group,
                type: 'sectionGroup',
                level: depth,
                parentPath: parentPath,
                sections: group.sections || [],
                childGroups: []
            };

            // Fetch nested section groups if depth is reasonable
            if (depth < 3) {
                try {
                    const token = await this.getAccessToken();
                    const nestedResponse = await this.makeRequestWithRetry(async () => {
                        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${group.id}/sectionGroups?$select=id,displayName,parentSectionGroup&$expand=sections($select=id,displayName)`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        return response.data;
                    }, `fetchNestedGroups(${group.id})`);

                    if (nestedResponse.value && nestedResponse.value.length > 0) {
                        groupData.childGroups = await this.buildSectionGroupHierarchy(
                            notebookId,
                            nestedResponse.value,
                            progressCallback,
                            depth + 1,
                            currentPath
                        );
                    }
                } catch (err) {
                    console.warn(`Failed to fetch nested groups for ${group.displayName}:`, err);
                }
            }

            hierarchy.push(groupData);
        }

        return hierarchy;
    }

    // NEW: Fetch section content with pages
    async fetchSectionContent(sectionId, progressCallback = null) {
        try {
            if (progressCallback) {
                progressCallback({
                    status: 'fetching_section',
                    message: `📁 Fetching section content...`
                });
            }

            // Fetch pages for this section
            const pagesResponse = await this.makeRequestWithRetry(async () => {
                const token = await this.getAccessToken();
                const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages?$select=id,title,lastModifiedDateTime,contentUrl&$orderby=lastModifiedDateTime desc&$top=100`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                return response.data;
            }, `fetchSectionPages(${sectionId})`);

            const pages = pagesResponse.value || [];

            if (progressCallback) {
                progressCallback({
                    status: 'pages_found',
                    message: `📄 Found ${pages.length} pages in section`
                });
            }

            // Fetch page content progressively
            const pagesWithContent = [];
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];

                if (progressCallback) {
                    progressCallback({
                        status: 'fetching_page',
                        message: `📝 Fetching page ${i + 1}/${pages.length}: ${page.title || 'Untitled'}`
                    });
                }

                try {
                    const pageContent = await this.fetchPageContent(page.id);
                    pagesWithContent.push({
                        ...page,
                        content: pageContent
                    });
                } catch (pageErr) {
                    console.warn(`Failed to fetch content for page ${page.title}:`, pageErr);
                    pagesWithContent.push({
                        ...page,
                        content: `Failed to load content: ${pageErr.message}`,
                        error: true
                    });
                }

                // Small delay between page fetches
                if (i < pages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            if (progressCallback) {
                progressCallback({
                    status: 'section_complete',
                    message: `✅ Section loaded: ${pagesWithContent.length} pages`
                });
            }

            return pagesWithContent;
        } catch (error) {
            if (progressCallback) {
                progressCallback({
                    status: 'section_error',
                    message: `❌ Failed to load section: ${error.message}`
                });
            }
            throw error;
        }
    }
}

module.exports = new OneNoteService();
