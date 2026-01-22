const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const { runDownloader } = require('./download-gemini-images.js');
const {
  runChatGPTBatch,
  runGeminiReplay,
  extractPromptsFromChat,
  saveExtractedPrompts,
  extractPromptsFromResponse
} = require('./automation-runner');
const oneNoteService = require('./services/one-note-service');
const { loadAutomationState, saveAutomationState, getDefaultState } = require('./automation-store');

let mainWindow;
let isDownloading = false;
let automationState = getDefaultState();
let automationBusy = false;
const automationControl = {
  chatgpt: { paused: false, aborted: false },
  gemini: { paused: false, aborted: false }
};

const makeId = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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

ipcMain.handle('automation-control:set', async (event, { stage, action }) => {
  if (!automationControl[stage]) {
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

ipcMain.handle('automation-run', async (event, stageOrPayload, maybeOptions) => {
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

  const scripts = flattenScripts().filter(item => item.script && item.script.trim().length > 0);

  log(`📊 Found ${flattenScripts().length} total scripts, ${scripts.length} with content`);

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
    return { success: true, sectionGroups, sections };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('onenote-get-pages', async (event, { sectionId } = {}) => {
  try {
    const pages = sectionId
      ? await oneNoteService.fetchPages(sectionId)
      : await oneNoteService.fetchRecentPages();
    return { success: true, pages };
  } catch (error) {
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

// Helper for recursive sync
async function syncRecursively(parentId, parentType, targetGroupName) {
  // 1. Fetch direct children
  const sections = await oneNoteService.fetchSections(parentId, parentType);
  const sectionGroups = (parentType === 'notebook' || parentType === 'sectionGroup')
    ? await oneNoteService.fetchSectionGroups(parentId, parentType)
    : [];

  // 2. Process Sections (containing pages)
  if (sections.length > 0) {
    // Find or create the App Group
    let group = automationState.sectionGroups.find(g => g.name === targetGroupName);
    if (!group) {
      group = { id: makeId('group'), name: targetGroupName, sections: [] };
      automationState.sectionGroups.push(group);
    }

    for (const section of sections) {
      // Check if section already exists in group to avoid duplicates? 
      // For now, let's create a NEW App Section for simplicity
      const sectionName = section.displayName || section.name || "Untitled Section";
      const newAppSection = {
        id: makeId('sec'),
        name: sectionName,
        subsections: [],
        collapsed: false
      };

      // Fetch pages for this section
      try {
        const pages = await oneNoteService.fetchPages(section.id);
        for (const page of pages) {
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

          newAppSection.subsections.push({
            id: makeId('sub'),
            name: page.title || "Untitled Page",
            script: cleanScript
          });
        }
      } catch (e) {
        console.error(`Failed to sync pages for section ${sectionName}:`, e);
      }

      if (newAppSection.subsections.length > 0) {
        group.sections.push(newAppSection);
      }
    }
  }

  // 3. Process Nested Section Groups (recurse)
  for (const sg of sectionGroups) {
    const sgName = sg.displayName || sg.name;
    // Flatten hierarchy for app: "Parent Group - Child Group"
    const newTargetGroupName = `${targetGroupName} - ${sgName}`;
    await syncRecursively(sg.id, 'sectionGroup', newTargetGroupName);
  }
}

ipcMain.handle('onenote-sync-hierarchy', async (event, { parentId, parentType, name }) => {
  try {
    const rootName = name || 'Imported Notebook';
    await syncRecursively(parentId, parentType, rootName);
    saveAndBroadcastAutomationState();
    return { success: true };
  } catch (e) {
    console.error("Sync error:", e);
    return { success: false, error: e.message };
  }
});
