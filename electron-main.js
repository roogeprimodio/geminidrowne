const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { runDownloader } = require('./download-gemini-images.js');
const { runAutomation, setAutomationControl } = require('./automation-runner.js');
const oneNoteService = require('./services/one-note-service');
const { loadAutomationState, saveAutomationState, getDefaultState } = require('./automation-store');
const localStore = require('./electron/store');
const SyncManager = require('./electron/sync-manager');
const LocalDatabase = require('./electron/local-database');

const syncManager = new SyncManager(oneNoteService);
const localDB = new LocalDatabase();

let mainWindow;
let isDownloading = false;
let automationState = getDefaultState();
let automationBusy = false;
const automationControl = {
  chatgpt: { paused: false, aborted: false },
  gemini: { paused: false, aborted: false }
};

const makeId = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

// Helper function to sanitize file names
function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 100); // Limit length
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#080c1a',
    title: 'Gemini Image Downloader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.removeMenu();

  const isDev = process.argv.includes('--dev');

  if (isDev) {
    console.log('🔌 Connecting to Vite dev server...');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    console.log('📂 Loading production file:', indexPath);

    // Check if file exists
    fs.access(indexPath)
      .then(() => {
        console.log("✅ File exists");
        mainWindow.loadFile(indexPath).catch(e => console.error("❌ Load file error:", e));
      })
      .catch(() => console.error("❌ File NOT found at:", indexPath));

    // Open DevTools in production temporarily to see errors
    // mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-finish-load', () => {
    broadcastAutomationState();
  });
}

function saveAndBroadcastAutomationState() {
  saveAutomationState(automationState);
  broadcastAutomationState();
}

function broadcastAutomationState(target) {
  const webContents = target || (mainWindow && mainWindow.webContents);
  if (webContents) {
    webContents.send('automation-state', automationState);
  }
}

function resetAutomationControl(stage) {
  if (automationControl[stage]) {
    automationControl[stage].paused = false;
    automationControl[stage].aborted = false;
  }
}

function broadcastAutomationStatus(payload) {
  const webContents = mainWindow && mainWindow.webContents;
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('automation-run-status', payload);
  }
}

function flattenScripts() {
  const scripts = [];
  (automationState.sectionGroups || []).forEach(group => {
    (group.sections || []).forEach(section => {
      (section.subsections || []).forEach(subsection => {
        scripts.push({
          groupId: group.id,
          groupName: group.name,
          sectionId: section.id,
          subsectionId: subsection.id,
          sectionName: section.name,
          scriptName: subsection.name,
          script: subsection.script || ''
        });
      });
    });
  });
  return scripts;
}

function findSubsection(sectionId, subsectionId) {
  for (const group of (automationState.sectionGroups || [])) {
    const section = group.sections.find(sec => sec.id === sectionId);
    if (section) {
      const subsection = section.subsections.find(sub => sub.id === subsectionId);
      if (subsection) return { group, section, subsection };
    }
  }
  return null;
}

function createAutomationLogger(sender) {
  return message => {
    if (sender && !sender.isDestroyed()) {
      sender.send('automation-log', { message, timestamp: Date.now() });
    }
  };
}

function emitAutomationStatus(sender, status) {
  if (sender && !sender.isDestroyed()) {
    sender.send('automation-run-status', status);
  }
}

app.whenReady().then(() => {
  automationState = loadAutomationState();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('automation-state:get', async event => {
  if (!app.isReady()) {
    automationState = getDefaultState();
  }
  return automationState;
});

ipcMain.handle('automation-state:update', async (event, payload) => {
  if (payload && Array.isArray(payload.sectionGroups)) {
    automationState.sectionGroups = payload.sectionGroups;
  }
  if (payload && Array.isArray(payload.history)) {
    automationState.history = payload.history;
  }
  if (payload && typeof payload.nextBatchNumber === 'number') {
    automationState.nextBatchNumber = payload.nextBatchNumber;
  }
  saveAndBroadcastAutomationState();
  return automationState;
});

// Add reset handler for new conversations
ipcMain.handle('automation-state:reset', async (event) => {
  automationState.history = [];
  automationState.nextBatchNumber = 1;
  automationState.activeGeminiChatUrl = null;
  automationState.completedPromptLabels = [];

  (automationState.sectionGroups || []).forEach(group => {
    (group.sections || []).forEach(section => {
      section.subsections = (section.subsections || []).map(sub => ({
        ...sub,
        chatgptResponse: undefined
      }));
    });
  });

  saveAndBroadcastAutomationState();
  return automationState;
});

ipcMain.handle('automation-state:reset-all', async () => {
  automationState = getDefaultState();
  saveAndBroadcastAutomationState();
  return automationState;
});

ipcMain.handle('automation-control:set', async (event, payload) => {
  const { stage, action } = payload;

  // New Global Control Pattern (used by Gemini V2)
  if (!stage) {
    if (typeof setAutomationControl === 'function') {
      setAutomationControl(action);
      return { success: true };
    }
  }

  // Legacy Pattern (with stage)
  if (!automationControl[stage]) {
    // If exact stage unknown, just try global control as fallback
    if (typeof setAutomationControl === 'function') {
      setAutomationControl(action);
      return { success: true };
    }
    throw new Error('Unknown automation stage.');
  }

  const control = automationControl[stage];

  if (action === 'pause') {
    control.paused = true;
    broadcastAutomationStatus({ stage, state: 'paused' });
  } else if (action === 'resume' || action === 'continue') {
    control.paused = false;
    control.aborted = false;
    broadcastAutomationStatus({ stage, state: 'running' });
  } else if (action === 'abort' || action === 'stop') {
    control.aborted = true;
    control.paused = false;
    broadcastAutomationStatus({ stage, state: 'aborted' });
  } else {
    throw new Error('Unknown automation action.');
  }

  return control;
});

ipcMain.handle('automation-run', async (event, payload) => {
  try {
    await runAutomation(event, payload, localDB);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/* Old Handler Logic - Deprecated
// ipcMain.handle('automation-run', async (event, stageOrPayload, maybeOptions) => {
  let stage, options;
  if (typeof stageOrPayload === 'string') {
    stage = stageOrPayload;
    options = maybeOptions || {};
  } else {
    stage = stageOrPayload.stage;
    options = stageOrPayload.options || {};
  }

  if (automationBusy) {
    throw new Error('Another automation run is already in progress.');
  }

  const sender = event.sender;
  const log = createAutomationLogger(sender);
  const sendStatus = status => emitAutomationStatus(sender, status);

  let scripts;
  if (options && options.script) {
    // Single script run mode (from Editor)
    log('⚡ Running in Single Script Mode (from Editor)');
    scripts = [{
      groupId: 'manual-run',
      groupName: 'Manual Run',
      sectionId: options.sectionId || 'manual-section',
      sectionName: 'Manual Section',
      subsectionId: options.pageId || makeId('manual-sub'),
      scriptName: 'Current Script',
      script: options.script
    }];
  } else {
    // Bulk run mode (from State)
    scripts = flattenScripts().filter(item => item.script && item.script.trim().length > 0);
  }

  log(`📊 Found ${scripts.length} scripts to process`);

  if (stage === 'chatgpt' && scripts.length === 0) {
    throw new Error('Please add at least one script with content before running automation.');
  }

  automationBusy = true;
  resetAutomationControl(stage);
  sendStatus({ stage, state: 'running' });

  try {
    // Always refresh state from disk before running to pick up latest extractions
    automationState = loadAutomationState();

    if (stage === 'chatgpt') {
      // Start fresh: clear previous ChatGPT responses/history so new run never merges
      automationState.history = [];
      automationState.sections = automationState.sections.map(section => ({
        ...section,
        subsections: section.subsections.map(sub => ({
          ...sub,
          chatgptResponse: undefined
        }))
      }));
      saveAndBroadcastAutomationState();

      // Use scripts as-is, no batching or duplicate checking
      const result = await runChatGPTBatch({
        scripts: scripts,
        log,
        control: automationControl[stage],
        options: options,
        onResult: async result => {
          const match = findSubsection(result.sectionId, result.subsectionId);
          if (!match) return;
          match.subsection.chatgptResponse = result.response;
          automationState.history.push({
            timestamp: Date.now(),
            sectionId: result.sectionId,
            subsectionId: result.subsectionId,
            script: '', // do not persist user script content in history
            response: result.response
          });
          saveAndBroadcastAutomationState();
        }
      });

      log('💾 ChatGPT outputs saved to disk.');

      // Handle completion properly
      if (result && result.completed) {
        log(`🎉 ChatGPT batch completed successfully! Processed ${result.scriptsProcessed} scripts.`);
      }

      // Return the result to the renderer
      return result;
    } else if (stage === 'gemini') {
      // Build prompts directly from the latest ChatGPT history to avoid stale files
      const history = Array.isArray(automationState.history) ? automationState.history : [];
      if (history.length === 0) {
        throw new Error('No ChatGPT responses available. Run ChatGPT batch first.');
      }

      const prompts = [];
      let lastProcessedIndex = -1;

      const completedSet = new Set(automationState.completedPromptLabels || []);

      history.forEach((entry) => {
        if (!entry?.response) return;
        const extracted = extractPromptsFromResponse(entry.response);
        extracted.forEach((prompt, pIndex) => {
          if (entry.excludedIndices && entry.excludedIndices.includes(pIndex)) return;

          const trimmed = (prompt || '').trim();
          if (!trimmed) return;
          const numberMatch = trimmed.match(/^(\d+\.\d+(?:\.\d+)*)\s+/);
          let label;

          if (numberMatch) {
            label = numberMatch[1];
          } else {
            label = `P${prompts.length + 1}`;
          }

          // Resume logic: Only add if not in completedSet
          if (!completedSet.has(label)) {
            prompts.push({
              response: trimmed,
              batchLabel: label
            });
          }
        });
      });

      if (prompts.length === 0) {
        log('✅ All prompts already marked as completed. Reset history to run again.');
        return { completed: true, message: 'All prompts already completed.' };
      }

      log(`🎯 Found ${prompts.length} pending prompts for Gemini processing (Skipped ${completedSet.size} already completed)`);

      const activeProfiles = (automationState.engineProfiles || []).filter(p => p.active);
      const useParallel = options.enableParallel && activeProfiles.length > 1;

      if (!useParallel) {
        const primaryProfile = activeProfiles[0] || { id: 'p1', name: 'Primary' };
        log(`🧵 Running sequentially using account: ${primaryProfile.name}`);

        const result = await runGeminiReplay({
          prompts,
          log,
          control: automationControl[stage],
          options: {
            ...options,
            profileId: primaryProfile.id,
            targetUrl: primaryProfile.chatUrl || automationState.activeGeminiChatUrl,
            onUrlUpdate: (url) => {
              primaryProfile.chatUrl = url;
              automationState.activeGeminiChatUrl = url;
              saveAndBroadcastAutomationState();
            },
            onPromptComplete: (label) => {
              if (!automationState.completedPromptLabels) automationState.completedPromptLabels = [];
              if (!automationState.completedPromptLabels.includes(label)) {
                automationState.completedPromptLabels.push(label);
                if (!primaryProfile.completed) primaryProfile.completed = [];
                primaryProfile.completed.push(label);
                saveAndBroadcastAutomationState();
              }
            }
          }
        });
        return result;
      } else {
        log(`🚀 Starting PARALLEL execution across ${activeProfiles.length} Gemini accounts...`);

        // Chunk prompts for each account
        const chunks = [];
        const chunkSize = Math.ceil(prompts.length / activeProfiles.length);
        for (let i = 0; i < prompts.length; i += chunkSize) {
          chunks.push(prompts.slice(i, i + chunkSize));
        }

        const tasks = activeProfiles.map((profile, index) => {
          const chunk = chunks[index];
          if (!chunk || chunk.length === 0) return Promise.resolve({ completed: true, scriptsProcessed: 0 });

          const engineLog = msg => log(`[${profile.name}] ${msg}`);

          return runGeminiReplay({
            prompts: chunk,
            log: engineLog,
            control: automationControl[stage],
            options: {
              ...options,
              profileId: profile.id,
              targetUrl: profile.chatUrl,
              onUrlUpdate: (url) => {
                profile.chatUrl = url;
                saveAndBroadcastAutomationState();
              },
              onPromptComplete: (label) => {
                if (!automationState.completedPromptLabels) automationState.completedPromptLabels = [];
                if (!automationState.completedPromptLabels.includes(label)) {
                  automationState.completedPromptLabels.push(label);
                  if (!profile.completed) profile.completed = [];
                  profile.completed.push(label);
                  saveAndBroadcastAutomationState();
                }
              }
            }
          });
        });

        const results = await Promise.all(tasks);
        log(`✅ All ${activeProfiles.length} Gemini threads completed.`);
        return { completed: true, results };
      }
    } else {
      throw new Error('Unknown automation stage.');
    }
  } finally {
    resetAutomationControl(stage);
    automationBusy = false;
    sendStatus({ stage, state: 'idle' });
  }
});
*/

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('extract-prompts-from-chat', async (event, { chatUrl }) => {
  if (automationBusy) {
    throw new Error('Another automation run is already in progress.');
  }

  if (!chatUrl || !chatUrl.trim()) {
    throw new Error('Please provide a valid ChatGPT chat URL.');
  }

  const sender = event.sender;
  const log = createAutomationLogger(sender);

  automationBusy = true;

  try {
    log('🔗 Starting prompt extraction from ChatGPT chat...');

    // Extract prompts from the chat
    const extractedPrompts = await extractPromptsFromChat(chatUrl.trim(), log);

    if (extractedPrompts.length === 0) {
      throw new Error('No prompts found in the provided chat.');
    }

    // Store extracted prompts directly in history (do not touch user sections)
    const extractedSectionId = makeId('chat-extract');
    automationState.history = extractedPrompts.map((prompt, index) => ({
      timestamp: Date.now(),
      sectionId: extractedSectionId,
      subsectionId: makeId('sub'),
      script: `Extracted Prompt ${index + 1}`,
      response: prompt // treat extracted prompt as the ChatGPT response
    }));

    saveAndBroadcastAutomationState();

    log(`✅ Successfully extracted and saved ${extractedPrompts.length} prompts as new subsections.`);

    return {
      success: true,
      promptsCount: extractedPrompts.length,
      subsectionsCount: extractedPrompts.length,
      prompts: extractedPrompts
    };

  } catch (error) {
    log(`❌ Prompt extraction failed: ${error.message}`);
    throw error;
  } finally {
    automationBusy = false;
  }
});

ipcMain.handle('start-download', async (event, { url, outputDir, outputFolderName }) => {
  if (isDownloading) {
    throw new Error('A download is already in progress. Please wait.');
  }

  if (!url || !url.trim()) {
    throw new Error('Please provide a Gemini share URL.');
  }

  const webContents = event.sender;
  const emitLog = message => webContents.send('log-message', message);
  const emitError = message => webContents.send('log-error', message);

  const resolvedOutput = outputDir ? path.resolve(outputDir) : undefined;
  const folderName = outputFolderName && outputFolderName.trim() ? outputFolderName.trim() : 'gemini_images';
  const finalOutputDir = resolvedOutput ? path.join(resolvedOutput, folderName) : path.join(process.cwd(), folderName);

  isDownloading = true;
  let success = false;
  try {
    await runDownloader(url.trim(), {
      outputDir: finalOutputDir,
      onLog: emitLog,
      onError: emitError
    });
    emitLog(`🎉 Download complete! You can find your images in the ${folderName} folder.`);
    success = true;
  } catch (error) {
    emitError(`❌ ${error.message}`);
    // Don't re-throw here, as we want to handle the UI state gracefully
  } finally {
    isDownloading = false;
    webContents.send('download-complete', { success });
  }
});

function parseGeminiPromptsFile(fileContent) {
  const prompts = [];
  const lines = fileContent.split('\n');
  let currentPrompt = '';
  let promptNumber = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for numbered prompts (1.1, 1.2, 2.1, etc.) - must be at start of line
    if (/^\d+\.\d+\s/.test(line)) {
      // Save previous prompt if exists
      if (currentPrompt.trim().length > 0) {
        prompts.push({
          response: currentPrompt.trim(),
          batchLabel: `Prompt ${promptNumber}`
        });
        promptNumber++;
      }

      // Start new prompt
      currentPrompt = line;
    }
    // Continue adding to current prompt (skip copy code lines)
    else if (currentPrompt.length > 0 && line.length > 0 && !line.includes('Copy code')) {
      currentPrompt += '\n' + line;
    }
    // Empty line ends the current prompt
    else if (currentPrompt.length > 0 && line.length === 0) {
      prompts.push({
        response: currentPrompt.trim(),
        batchLabel: `Prompt ${promptNumber}`
      });
      promptNumber++;
      currentPrompt = '';
    }
  }

  // Add the last prompt if exists
  if (currentPrompt.trim().length > 0) {
    prompts.push({
      response: currentPrompt.trim(),
      batchLabel: `Prompt ${promptNumber}`
    });
  }

  return prompts;
}

ipcMain.handle('repair-browsers', async (event) => {
  const webContents = event.sender;
  const log = (msg) => webContents.send('automation-log', { message: msg, timestamp: Date.now() });

  log('🔧 Starting automatic browser repair...');
  log('ℹ️ This will download the required Chromium instance (~150MB).');
  log('⏳ Please wait, this process may take 1-2 minutes depending on your internet speed.');

  return new Promise((resolve) => {
    // Attempt to install chromium via npx
    // This is most robust as it handles both dev and packaged states if npm/npx is available
    // For a fully standalone app, we'd bundle the browser, but this is a great middle ground for distribution to friends.
    const cmd = 'npx playwright install chromium';

    const installProcess = exec(cmd);

    installProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) log(`[Download] ${output}`);
    });

    installProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      // stderr often contains progress bars or info logs for playwright
      if (output && !output.includes('node_modules')) log(`[Info] ${output}`);
    });

    installProcess.on('close', (code) => {
      if (code === 0) {
        log('✅ Success! Browsers are now installed and ready.');
        resolve({ success: true });
      } else {
        log(`❌ Installation failed with exit code ${code}.`);
        log('💡 Alternative fix: Open a terminal and run "npx playwright install chromium" manually.');
        resolve({ success: false, error: `Exit code ${code}` });
      }
    });

    installProcess.on('error', (err) => {
      log(`❌ Critical error starting repair: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
});

// --- OneNote Integration ---
const http = require('http');

ipcMain.handle('onenote-check-auth', async (event, { clientId, redirectUri }) => {
  try {
    const userDataPath = app.getPath('userData');
    oneNoteService.initialize(clientId, redirectUri, userDataPath);
    return await oneNoteService.trySilentLogin();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-login', async (event, { clientId, redirectUri }) => {
  try {
    // 1. Initialize Service
    const userDataPath = app.getPath('userData');
    oneNoteService.initialize(clientId, redirectUri, userDataPath);
    const authUrl = await oneNoteService.getAuthUrl();

    // 2. Start Local Web Server to listen for callback
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);

        // Only handle the callback path (e.g., /callback or just /)
        // Since we are listening on port 3000, we accept any request to it for simplicity, 
        // or check urlObj.pathname if we want to be strict.

        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        if (code) {
          try {
            const response = await oneNoteService.acquireTokenByCode(code);

            // Send success response to browser
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: system-ui; background: #111; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh;">
                  <h1 style="color: #6dff8b;">Authentication Successful</h1>
                  <p>You can close this window and return to the app.</p>
                  <script>window.close();</script>
                </body>
              </html>
            `);

            resolve({ success: true, account: response.account });
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Auth Error</h1><p>${err.message}</p>`);
            reject(err);
          } finally {
            server.close();
          }
        } else if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Failed</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`Microsoft Auth Error: ${error}`));
        } else {
          // Ignore other requests (favicons etc) if necessary, but for now we might close too early?
          // Actually, browsers might request favicon.ico.
          if (req.url.includes('fav')) {
            res.writeHead(404);
            res.end();
            return;
          }
          // If it's a legitimate hit without code, maybe we just wait?
          res.writeHead(200);
          res.end('Waiting for code...');
        }
      });

      server.listen(3000, () => {
        // 3. Open System Default Browser
        console.log('Local auth server listening on port 3000');
        require('electron').shell.openExternal(authUrl);
      });

      server.on('error', (err) => {
        server.close();
        reject(new Error(`Failed to start local auth server: ${err.message}. Is port 3000 in use?`));
      });

      // Safety timeout
      setTimeout(() => {
        if (server.listening) {
          server.close();
          reject(new Error('Authentication timed out after 5 minutes.'));
        }
      }, 5 * 60 * 1000);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-get-notebooks', async () => {
  try {
    const notebooks = await oneNoteService.fetchNotebooks();
    // Save minimal notebook data to DB
    localDB.saveNotebooks(notebooks);
    return { success: true, notebooks };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-get-children', async (event, { parentId, parentType }) => {
  try {
    const sectionGroups = (parentType === 'notebook' || parentType === 'sectionGroup')
      ? await oneNoteService.fetchSectionGroups(parentId, parentType)
      : [];
    const sections = await oneNoteService.fetchSections(parentId, parentType);

    // Save to local DB
    if (sectionGroups.length) localDB.saveSectionGroups(sectionGroups, parentId, parentType);
    if (sections.length) localDB.saveSections(sections, parentId, parentType);

    return { success: true, sectionGroups, sections };
  } catch (error) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('log-error', `Fetch Children Failed: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-get-pages', async (event, { sectionId } = {}) => {
  try {
    const pages = sectionId
      ? await oneNoteService.fetchPages(sectionId)
      : await oneNoteService.fetchRecentPages();

    // Save to local DB if we have a sectionId
    if (sectionId && pages.length) {
      localDB.savePages(pages, sectionId);
    }

    return { success: true, pages };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-get-page-content', async (event, { pageId }) => {
  try {
    // 1. Get Local Content
    let localPage = localDB.getPages ? localDB.getPage(pageId) : null;
    // Fallback if getPage doesn't separate exist (we added getPages, not getPage, checking store...)
    if (!localPage) {
      const content = localStore.getPageContent(pageId);
      if (content) localPage = { id: pageId, content, lastModifiedDateTime: null };
    }

    // 2. Validate Local Content
    let needsSync = false;
    let reason = '';

    if (!localPage || !localPage.content) {
      needsSync = true;
      reason = 'missing_local';
    } else {
      const content = localPage.content;
      const isContentEmpty = !content || content.trim().length === 0;
      const isErrorParams = content.startsWith('Failed to load content');
      const hasHtmlStructure = content.includes('<html') || content.includes('<body') || content.includes('<div') || content.includes('<p');
      const isTooShort = content.length < 200;
      const isLiteralUndefined = content === 'undefined' || content === 'null';

      // Grid Check
      const textOnly = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
      const isEmptyLayout = textOnly.length < 10;

      if (isContentEmpty || isErrorParams || isLiteralUndefined || (!hasHtmlStructure && isTooShort) || isEmptyLayout) {
        needsSync = true;
        reason = 'invalid_content';
      }
    }

    // 3. Check for Updates (Metadata) - Only if content looks valid locally to catch updates
    if (!needsSync) {
      try {
        const remoteMeta = await oneNoteService.getPageMetadata(pageId);
        // If local date is missing or older than remote
        if (!localPage.lastModifiedDateTime || (remoteMeta.lastModifiedDateTime > localPage.lastModifiedDateTime)) {
          needsSync = true;
          reason = 'outdated';
          console.log(`[SmartPage] Page ${pageId} is outdated. Local: ${localPage.lastModifiedDateTime}, Remote: ${remoteMeta.lastModifiedDateTime}`);
        }
      } catch (err) {
        console.warn(`[SmartPage] Failed to check metadata for ${pageId}, using local if available.`, err);
      }
    }

    if (needsSync) {
      console.log(`[SmartPage] Syncing page ${pageId} due to: ${reason}`);
      const content = await oneNoteService.fetchPageContent(pageId);

      // Save to DB
      localDB.savePageContent(pageId, content);
      localStore.savePageContent(pageId, content); // Legacy store backup

      // We might also need to update the lastModifiedDateTime in the DB to avoid re-syncing loop
      // But fetchPageContent doesn't return metadata. We should probably update it with the meta we fetched or just assume current time.
      // Ideally we save the whole page object if we have meta.
      // For now, content update timestamps it in localDB.

      return { success: true, content };
    }

    return { success: true, content: localPage.content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// --- Prompts Handlers ---

ipcMain.handle('prompts-get', async (event, { pageId }) => {
  try {
    const prompts = localDB.getPrompts(pageId);
    return { success: true, prompts };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prompts-add', async (event, { pageId, content }) => {
  try {
    const id = localDB.addPrompt(pageId, content);
    return { success: true, id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prompts-delete', async (event, { id }) => {
  try {
    localDB.deletePrompt(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prompts-toggle-skip', async (event, { id, isSkipped }) => {
  try {
    localDB.updatePromptSkip(id, isSkipped);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('prompts-toggle-skip-all', async (event, { pageId, isSkipped }) => {
  try {
    localDB.updateAllPromptsSkip(pageId, isSkipped);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- Settings Handlers ---

ipcMain.handle('settings-get', async (event, { key }) => {
  try {
    const value = localDB.getSetting(key);
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings-save', async (event, { key, value }) => {
  try {
    localDB.saveSetting(key, value);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle('open-folder', async (event, { path: folderPath }) => {
  try {
    const fullPath = path.resolve(folderPath);
    await require('electron').shell.openPath(fullPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


ipcMain.handle('onenote-get-local-data', async () => {
  console.log('[Main] Fetching local data from SQLite DB');
  try {
    const notebooks = localDB.loadNotebooks();
    console.log('[Main] Loaded from DB:', notebooks.length, 'notebooks');
    const lastSync = localDB.getLastSyncTime();
    return { notebooks, lastSyncTime: lastSync };
  } catch (error) {
    console.error('[Main] Failed to load from DB:', error);
    return { notebooks: [], lastSyncTime: null };
  }
});

ipcMain.handle('onenote-sync-all', async (event) => {
  try {
    const progressCallback = (msg) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('onenote-sync-progress', msg);
      }
    };

    console.log('[Main] Starting sync...');
    const updatedData = await syncManager.syncAll(progressCallback);

    // Save to local database
    console.log('[Main] Saving to local database...');
    localDB.saveNotebooks(updatedData);

    // Also save to old store for backward compatibility
    localStore.saveData({ notebooks: updatedData });

    console.log('[Main] Sync complete and saved to DB');
    return { success: true, data: updatedData };
  } catch (error) {
    console.error('[Main] Sync failed:', error);
    if (!event.sender.isDestroyed()) {
      event.sender.send('log-error', `Sync Failed: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-sync-section', async (event, { sectionId }) => {
  try {
    const progressCallback = (status) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('onenote-sync-progress', status);
      }
    };

    // 1. Fetch Remote List (Metadata only)
    if (progressCallback) progressCallback({ status: 'checking_updates', message: '🔎 Checking for updates...' });
    const remotePages = await oneNoteService.fetchPages(sectionId);

    // 2. Fetch Local List
    const localPages = localDB.getPages(sectionId);
    const localMap = new Map(localPages.map(p => [p.id, p]));

    // 3. Identify pages needing update
    const pagesToSync = [];
    const upToDatePages = [];

    for (const remotePage of remotePages) {
      const localPage = localMap.get(remotePage.id);

      let needsSync = false;
      let reason = '';

      if (!localPage) {
        needsSync = true;
        reason = 'new';
      } else if (localPage.lastModifiedDateTime !== remotePage.lastModifiedDateTime) {
        needsSync = true;
        reason = 'updated';
      } else {
        // Content validation
        // Optimization: localPage from getPages is metadata-only. Fetch full if needed.
        const fullLocalPage = localDB.getPage(localPage.id);
        const content = fullLocalPage ? (fullLocalPage.content || '') : '';

        const isContentEmpty = !content || content.trim().length === 0;
        const isErrorParams = content.startsWith('Failed to load content');

        // Stricter check: OneNote API always returns HTML. If no body/div/p, it's likely bad.
        // Also check if it's the specific "undefined" string literal
        const hasHtmlStructure = content.includes('<html') || content.includes('<body') || content.includes('<div') || content.includes('<p');
        const isTooShort = content.length < 200; // Lowered to 200 to be safe, but relied on structure check
        const isLiteralUndefined = content === 'undefined' || content === 'null';

        if (isContentEmpty || isErrorParams || isLiteralUndefined || (!hasHtmlStructure && isTooShort)) {
          // Fix "bad" pages or empty pages
          needsSync = true;
          reason = isContentEmpty ? 'empty_content' : (isErrorParams ? 'error_state' : 'invalid_structure');
        } else {
          // Deep check: Is it just an empty OneNote table?
          // OneNote often returns a table with empty cells for layout.
          // Check if there is any actual text content outside of tags.
          // Strip tags and whitespace
          const textOnly = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
          if (textOnly.length < 10) {
            needsSync = true;
            reason = 'empty_layout_detected';
          }
        }
      }

      if (needsSync) {
        pagesToSync.push({ ...remotePage, reason });
      } else {
        // Keep local content for up-to-date pages
        upToDatePages.push(localPage);
      }
    }

    // 4. Fetch content for needed pages
    if (pagesToSync.length > 0) {
      if (progressCallback) progressCallback({
        status: 'syncing_pages',
        message: `⬇️ Found ${pagesToSync.length} pages to sync...`
      });

      console.log(`[SmartSync] Syncing ${pagesToSync.length} pages in section ${sectionId}. Reasons: ${pagesToSync.map(p => p.reason).join(', ')}`);

      for (let i = 0; i < pagesToSync.length; i++) {
        const page = pagesToSync[i];
        try {
          if (progressCallback) progressCallback({
            status: 'fetching_page',
            message: `📝 Fetching (${i + 1}/${pagesToSync.length}): ${page.title || 'Untitled'} (${page.reason})`
          });

          // Fetch content
          const content = await oneNoteService.fetchPageContent(page.id);
          const fullPage = { ...page, content };

          // Save immediately to DB
          localDB.savePages([fullPage], sectionId);
          localDB.savePageContent(page.id, content);

          // Add to result list
          upToDatePages.push(fullPage);

          // Rate limit protection
          if (i < pagesToSync.length - 1) await new Promise(r => setTimeout(r, 500));

        } catch (err) {
          console.error(`Failed to sync page ${page.id}:`, err);
          // Keep existing if available, or error state
          const existing = localMap.get(page.id);
          if (existing) {
            upToDatePages.push(existing);
          } else {
            upToDatePages.push({ ...page, content: `Failed to load content: ${err.message}` });
          }
        }
      }
    } else {
      if (progressCallback) progressCallback({ status: 'up_to_date', message: '✅ Section is up to date' });
    }

    // 5. Sort final list by title (or whatever logic matches UI) - Remote list order is usually best or alpha
    // We'll trust the remotePages order which comes from API (alpha sorted in service)
    const finalMap = new Map(upToDatePages.map(p => [p.id, p]));
    const orderedPages = remotePages.map(rp => finalMap.get(rp.id)).filter(p => p);

    return { success: true, pages: orderedPages };

  } catch (error) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('log-error', `Sync Section Failed: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-sync-page', async (event, { pageId, sectionName, groupName }) => {
  try {
    const content = await oneNoteService.fetchPageContent(pageId);
    const prompts = extractPromptsFromResponse(content);

    if (prompts.length === 0) {
      throw new Error('No prompts found on this OneNote page.');
    }

    // Find or create the group
    const targetGroupName = groupName || 'OneNote Imports';
    let group = automationState.sectionGroups.find(g => g.name === targetGroupName);
    if (!group) {
      group = { id: makeId('group'), name: targetGroupName, sections: [] };
      automationState.sectionGroups.push(group);
    }

    // Create the section
    const targetSectionName = sectionName || `Page Sync ${new Date().toLocaleDateString()}`;
    const newSection = {
      id: makeId('sec'),
      name: targetSectionName,
      subsections: prompts.map((p, i) => {
        const match = p.match(/^(\d+\.\d+)\s+(.+)/);
        return {
          id: makeId('sub'),
          name: match ? `Prompt ${match[1]}` : `Synced Prompt ${i + 1}`,
          script: p
        };
      })
    };

    group.sections.push(newSection);
    saveAndBroadcastAutomationState();

    return { success: true, sectionId: newSection.id, groupId: group.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper for recursive sync with hard save
async function syncRecursively(parentId, parentType, targetGroupName, progressCallback = null) {
  // Initialize progress tracking
  const progress = {
    totalSections: 0,
    processedSections: 0,
    totalPages: 0,
    processedPages: 0,
    totalSectionGroups: 0,
    processedSectionGroups: 0,
    currentSection: '',
    currentPage: '',
    currentSectionGroup: '',
    errors: []
  };

  // Create base directory for hard saves
  const userDataPath = app.getPath('userData');
  const onenoteDataPath = path.join(userDataPath, 'onenote-data');
  const groupDataPath = path.join(onenoteDataPath, sanitizeFileName(targetGroupName));

  try {
    await fs.mkdir(onenoteDataPath, { recursive: true });
    await fs.mkdir(groupDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create directories for hard save:', err);
  }

  // 1. Fetch direct children and count totals
  const sections = await oneNoteService.fetchSections(parentId, parentType);
  const sectionGroups = (parentType === 'notebook' || parentType === 'sectionGroup')
    ? await oneNoteService.fetchSectionGroups(parentId, parentType)
    : [];

  progress.totalSections = sections.length;
  progress.totalSectionGroups = sectionGroups.length;

  // Count total pages for progress tracking
  for (const section of sections) {
    try {
      const pages = await oneNoteService.fetchPages(section.id);
      progress.totalPages += pages.length;
    } catch (e) {
      console.warn(`Failed to count pages for section ${section.displayName}:`, e);
    }

    // Add longer delay to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (progressCallback) {
    progressCallback({
      ...progress,
      status: 'starting',
      message: `🔍 Starting sync: Found ${progress.totalSections} sections, ${progress.totalPages} pages, ${progress.totalSectionGroups} section groups in "${targetGroupName}"`
    });
  }

  // 2. Process Sections (containing pages)
  if (sections.length > 0) {
    // Find or create the App Group
    let group = automationState.sectionGroups.find(g => g.name === targetGroupName);
    if (!group) {
      group = { id: makeId('group'), name: targetGroupName, sections: [] };
      automationState.sectionGroups.push(group);
      if (progressCallback) {
        progressCallback({
          ...progress,
          status: 'group_created',
          message: `Created group: ${targetGroupName}`
        });
      }
    }

    for (const section of sections) {
      progress.currentSection = section.displayName || section.name || "Untitled Section";
      progress.processedSections++;

      if (progressCallback) {
        progressCallback({
          ...progress,
          status: 'processing_section',
          message: `📁 Processing section ${progress.processedSections}/${progress.totalSections}: ${progress.currentSection}`
        });
      }

      // Check if section already exists in group to avoid duplicates? 
      // For now, let's create a NEW App Section for simplicity
      const sectionName = section.displayName || section.name || "Untitled Section";
      const newAppSection = {
        id: makeId('sec'),
        name: sectionName,
        subsections: [],
        collapsed: false
      };

      // Create section directory for hard saves
      const sectionDataPath = path.join(groupDataPath, sanitizeFileName(sectionName));
      try {
        await fs.mkdir(sectionDataPath, { recursive: true });
      } catch (err) {
        console.error(`Failed to create section directory: ${err}`);
      }

      // Fetch pages for this section
      try {
        const pages = await oneNoteService.fetchPages(section.id);

        if (progressCallback) {
          progressCallback({
            ...progress,
            status: 'fetching_pages',
            message: `📄 Found ${pages.length} pages in section: ${sectionName}`
          });
        }

        for (const page of pages) {
          progress.currentPage = page.title || "Untitled Page";
          progress.processedPages++;

          if (progressCallback) {
            progressCallback({
              ...progress,
              status: 'processing_page',
              message: `📝 Syncing page ${progress.processedPages}/${progress.totalPages}: ${progress.currentPage}`
            });
          }

          // Add longer delay between page requests to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));

          try {
            const pageContent = await oneNoteService.fetchPageContent(page.id);
            // Simple text extraction: remove HTML tags, keep newlines
            // Ideally we use a proper converter, but regex is a start
            // The user wants "as is", so maybe we leave some HTML? 
            // For safety and editor compatibility: strip tags but keep structure
            let cleanScript = pageContent
              .replace(/<title>.*?<\/title>/g, '') // remove title
              .replace(/<br>/g, '\n')
              .replace(/<\/p>/g, '\n')
              .replace(/<[^>]*>/g, '') // remove other tags
              .replace(/&nbsp;/g, ' ')
              .trim();

            if (!cleanScript) cleanScript = "（Empty Page）";

            // Hard save page content to file
            const pageFileName = sanitizeFileName(page.title || "Untitled Page") + '.txt';
            const pageFilePath = path.join(sectionDataPath, pageFileName);

            try {
              await fs.writeFile(pageFilePath, cleanScript, 'utf8');

              // Save metadata
              const metadata = {
                id: page.id,
                title: page.title,
                lastModifiedDateTime: page.lastModifiedDateTime,
                sectionId: section.id,
                sectionName: sectionName,
                groupName: targetGroupName,
                filePath: pageFilePath,
                syncedAt: new Date().toISOString()
              };

              const metadataPath = path.join(sectionDataPath, sanitizeFileName(page.title || "Untitled Page") + '.meta.json');
              await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

              if (progressCallback) {
                progressCallback({
                  ...progress,
                  status: 'page_saved',
                  message: `💾 Saved page: ${progress.currentPage}`
                });
              }
            } catch (saveErr) {
              const errorMsg = `Failed to save page "${page.title}": ${saveErr.message}`;
              progress.errors.push(errorMsg);
              console.error(errorMsg);

              if (progressCallback) {
                progressCallback({
                  ...progress,
                  status: 'save_error',
                  message: `❌ ${errorMsg}`
                });
              }
            }

            newAppSection.subsections.push({
              id: makeId('sub'),
              name: page.title || "Untitled Page",
              script: cleanScript,
              filePath: pageFilePath,
              metadata: metadata
            });

            if (progressCallback) {
              progressCallback({
                ...progress,
                status: 'page_synced',
                message: `✅ Synced page: ${progress.currentPage}`
              });
            }
          } catch (pageError) {
            const errorMsg = `Failed to sync page "${page.title}": ${pageError.message}`;
            progress.errors.push(errorMsg);
            console.error(errorMsg);

            if (progressCallback) {
              progressCallback({
                ...progress,
                status: 'page_error',
                message: `❌ ${errorMsg}`
              });
            }
          }
        }
      } catch (e) {
        const errorMsg = `Failed to sync pages for section "${sectionName}": ${e.message}`;
        progress.errors.push(errorMsg);
        console.error(errorMsg);

        if (progressCallback) {
          progressCallback({
            ...progress,
            status: 'section_error',
            message: `❌ ${errorMsg}`
          });
        }
      }

      if (newAppSection.subsections.length > 0) {
        group.sections.push(newAppSection);

        if (progressCallback) {
          progressCallback({
            ...progress,
            status: 'section_completed',
            message: `✅ Completed section: ${sectionName} (${newAppSection.subsections.length} pages)`
          });
        }
      }
    }
    // Add longer delay between section processing to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // 3. Process Nested Section Groups (recurse)
  for (const sg of sectionGroups) {
    progress.currentSectionGroup = sg.displayName || sg.name;
    progress.processedSectionGroups++;

    if (progressCallback) {
      progressCallback({
        ...progress,
        status: 'processing_section_group',
        message: `📂 Processing section group ${progress.processedSectionGroups}/${progress.totalSectionGroups}: ${progress.currentSectionGroup}`
      });
    }

    const sgName = sg.displayName || sg.name;
    // Flatten hierarchy for app: "Parent Group - Child Group"
    const newTargetGroupName = `${targetGroupName} - ${sgName}`;

    try {
      await syncRecursively(sg.id, 'sectionGroup', newTargetGroupName, progressCallback);

      if (progressCallback) {
        progressCallback({
          ...progress,
          status: 'section_group_completed',
          message: `✅ Completed section group: ${sgName}`
        });
      }
    } catch (sgError) {
      const errorMsg = `Failed to sync section group "${sgName}": ${sgError.message}`;
      progress.errors.push(errorMsg);
      console.error(errorMsg);

      if (progressCallback) {
        progressCallback({
          ...progress,
          status: 'section_group_error',
          message: `❌ ${errorMsg}`
        });
      }
    }

    // Add longer delay between section group processing
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Final progress update
  if (progressCallback) {
    progressCallback({
      ...progress,
      status: 'completed',
      message: `✅ Sync completed! ${progress.processedSections}/${progress.totalSections} sections, ${progress.processedPages}/${progress.totalPages} pages, ${progress.processedSectionGroups}/${progress.totalSectionGroups} section groups. ${progress.errors.length} errors.`
    });
  }

  return progress;
}

ipcMain.handle('onenote-sync-complete-notebook', async (event, { notebookId, notebookName }) => {
  try {
    const rootName = notebookName || 'Imported Notebook';

    // Send initial status to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('onenote-sync-progress', {
        status: 'starting',
        message: `🔍 Starting complete notebook sync for: ${rootName}`
      });
    }

    // Progress callback to send updates to renderer
    const progressCallback = (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('onenote-sync-progress', progress);
      }
    };

    const finalProgress = await syncCompleteNotebook(notebookId, rootName, progressCallback);
    saveAndBroadcastAutomationState();

    return {
      success: true,
      progress: finalProgress
    };
  } catch (e) {
    console.error("Complete notebook sync error:", e);

    // Send error to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('onenote-sync-progress', {
        status: 'error',
        message: `❌ Sync failed: ${e.message}`
      });
    }

    return { success: false, error: e.message };
  }
});

// NEW: Complete notebook sync function
async function syncCompleteNotebook(notebookId, notebookName, progressCallback = null) {
  const progress = {
    totalSections: 0,
    processedSections: 0,
    totalPages: 0,
    processedPages: 0,
    totalSectionGroups: 0,
    processedSectionGroups: 0,
    currentSection: '',
    currentPage: '',
    currentSectionGroup: '',
    errors: []
  };

  // Create base directory for hard saves
  const userDataPath = app.getPath('userData');
  const onenoteDataPath = path.join(userDataPath, 'onenote-data');
  const notebookDataPath = path.join(onenoteDataPath, sanitizeFileName(notebookName));

  try {
    await fs.mkdir(onenoteDataPath, { recursive: true });
    await fs.mkdir(notebookDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create directories for hard save:', err);
  }

  if (progressCallback) {
    progressCallback({
      ...progress,
      status: 'fetching_hierarchy',
      message: `🚀 Starting mega-batch download of entire notebook...`
    });
  }

  // Fetch complete hierarchy using single mega-batch request
  const hierarchy = await oneNoteService.fetchEntireNotebookInOneRequest(notebookId, (progress) => {
    // Send progress updates to UI
    if (progressCallback) {
      progressCallback({
        ...progress,
        ...progress,
        status: progress.status,
        message: progress.message
      });
    }
  });

  progress.totalSections = hierarchy.sections.length;
  progress.totalSectionGroups = hierarchy.sectionGroups.length;
  progress.totalPages = hierarchy.pages.length;

  if (progressCallback) {
    progressCallback({
      ...progress,
      status: 'hierarchy_fetched',
      message: `🔍 Found complete hierarchy: ${progress.totalSections} sections, ${progress.totalPages} pages, ${progress.totalSectionGroups} section groups`
    });
  }

  // Create a map of groups and sections for hierarchy reconstruction
  const groupMap = new Map();
  const sectionMap = new Map();

  // 1. Create Notebook Root in automationState
  let rootNode = automationState.sectionGroups.find(g => g.metadata?.id === notebookId);
  if (!rootNode) {
    rootNode = {
      id: makeId('group'),
      name: notebookName,
      sections: [],
      childGroups: [],
      metadata: { id: notebookId, type: 'notebook' }
    };
    automationState.sectionGroups.push(rootNode);
  } else {
    // Clear old children but keep reference
    rootNode.sections = [];
    rootNode.childGroups = [];
  }
  groupMap.set(notebookId, rootNode);

  // 2. Initialize Section Groups in the map
  for (const sg of hierarchy.sectionGroups) {
    groupMap.set(sg.id, {
      id: makeId('group'),
      name: sg.displayName,
      sections: [],
      childGroups: [],
      metadata: { id: sg.id, type: 'sectionGroup' }
    });
  }

  // 3. Reconstruct Groups Hierarchy
  for (const sg of hierarchy.sectionGroups) {
    const node = groupMap.get(sg.id);
    const parentId = sg.parentGroupId || notebookId;
    const parentNode = groupMap.get(parentId);
    if (parentNode) {
      if (!parentNode.childGroups) parentNode.childGroups = [];
      parentNode.childGroups.push(node);
    }
  }

  // 4. Process all sections and place them in the correct level
  for (const section of hierarchy.sections) {
    const sectionName = section.displayName || section.name || "Untitled Section";
    const parentId = section.parentGroupId || notebookId;
    const parentNode = groupMap.get(parentId);

    if (!parentNode) continue;

    const newAppSection = {
      id: makeId('sec'),
      name: sectionName,
      subsections: [],
      collapsed: false,
      metadata: { id: section.id, type: 'section' }
    };

    const sectionPages = hierarchy.pages.filter(p => p.sectionId === section.id);

    // Add pages
    for (const page of sectionPages) {
      newAppSection.subsections.push({
        id: makeId('sub'),
        name: page.title || "Untitled Page",
        script: `Downloaded from OneNote: ${page.title}`,
        filePath: path.join(notebookDataPath, sanitizeFileName(sectionName), sanitizeFileName(page.title || "Untitled Page") + '.txt'),
        metadata: {
          id: page.id,
          title: page.title,
          lastModifiedDateTime: page.lastModifiedDateTime,
          sectionId: section.id,
          sectionName: sectionName,
          notebookName: notebookName,
          syncedAt: new Date().toISOString()
        }
      });
    }

    parentNode.sections.push(newAppSection);
  }

  // Save and broadcast state after each section is added
  saveAndBroadcastAutomationState();

  // Final progress update
  if (progressCallback) {
    progressCallback({
      ...progress,
      status: 'completed',
      message: `🎉 Complete notebook sync finished! ${progress.processedSections}/${progress.totalSections} sections, ${progress.processedPages}/${progress.totalPages} pages, ${progress.totalSectionGroups} section groups. ${progress.errors.length} errors.`
    });
  }

  return progress;
}



ipcMain.handle('scan-page-images', async (event, { pageId }) => {
  if (!pageId) return { success: false, assets: [] };

  try {
    const saveRoot = localDB.getSetting('image_save_path');
    if (!saveRoot) return { success: false, assets: [] };

    const hierarchyPath = localDB.getPageHierarchyPath(pageId);

    // Sanitize path parts - MUST MATCH automation-runner.js logic EXACTLY
    const sanitizedPath = hierarchyPath.map(part =>
      part.replace(/[^a-z0-9 ]/gi, '_').substring(0, 50)
    );

    const pageDir = path.join(saveRoot, ...sanitizedPath);

    try {
      await fs.access(pageDir);
    } catch {
      return { success: true, assets: [] };
    }

    const files = await fs.readdir(pageDir);
    const assets = files
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map(f => ({
        pageId,
        filePath: path.join(pageDir, f),
        filename: f,
        promptId: 'restored'
      }));

    return { success: true, assets };

  } catch (error) {
    console.error('Scan images error:', error);
    return { success: false, error: error.message, assets: [] };
  }
});
