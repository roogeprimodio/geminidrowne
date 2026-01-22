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
                "$orderby": "lastModifiedDateTime desc"
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

        const response = await axios.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            params: { "$select": "id,displayName,lastModifiedDateTime" }
        });

        return response.data.value.map(sg => ({ ...sg, type: 'sectionGroup' }));
    }

    async fetchSections(parentId, parentType = 'notebook') {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const endpoint = parentType === 'notebook'
            ? `https://graph.microsoft.com/v1.0/me/onenote/notebooks/${parentId}/sections`
            : `https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/${parentId}/sections`;

        const response = await axios.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            params: { "$select": "id,displayName,lastModifiedDateTime" }
        });

        return response.data.value.map(s => ({ ...s, type: 'section' }));
    }

    async fetchPages(sectionId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                "$select": "id,title,lastModifiedDateTime",
                "$orderby": "lastModifiedDateTime desc"
            }
        });

        return response.data.value.map(p => ({ ...p, type: 'page' }));
    }

    async fetchRecentPages() {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available. Please login.");

        const today = new Date();
        today.setDate(today.getDate() - 3); // Last 3 days instead of just 24h for better usability
        const dateString = today.toISOString();

        const response = await axios.get("https://graph.microsoft.com/v1.0/me/onenote/pages", {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                "$filter": `lastModifiedDateTime ge ${dateString}`,
                "$orderby": "lastModifiedDateTime desc",
                "$select": "id,title,lastModifiedDateTime"
            }
        });

        return response.data.value.map(p => ({ ...p, type: 'page' }));
    }

    async fetchPageContent(pageId) {
        const token = await this.getAccessToken();
        if (!token) throw new Error("No access token available.");

        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}/content?includeIDs=true`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        return response.data;
    }
}

module.exports = new OneNoteService();
