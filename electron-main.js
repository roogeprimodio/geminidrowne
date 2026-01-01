const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { runDownloader } = require('./download-gemini-images.js');
const { runChatGPTBatch, runGeminiReplay, extractPromptsFromChat, saveExtractedPrompts } = require('./automation-runner');
const { loadAutomationState, saveAutomationState, getDefaultState } = require('./automation-store');

let mainWindow;
let isDownloading = false;
let automationState = getDefaultState();
let automationBusy = false;

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

function flattenScripts() {
  const scripts = [];
  automationState.sections.forEach(section => {
    section.subsections.forEach(subsection => {
      scripts.push({
        sectionId: section.id,
        subsectionId: subsection.id,
        sectionName: section.name,
        scriptName: subsection.name,
        script: subsection.script || ''
      });
    });
  });
  return scripts;
}

function findSubsection(sectionId, subsectionId) {
  const section = automationState.sections.find(sec => sec.id === sectionId);
  if (!section) return null;
  const subsection = section.subsections.find(sub => sub.id === subsectionId);
  if (!subsection) return null;
  return { section, subsection };
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
  if (payload && Array.isArray(payload.sections)) {
    automationState.sections = payload.sections;
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

ipcMain.handle('automation-run', async (event, { stage }) => {
  if (automationBusy) {
    throw new Error('Another automation run is already in progress.');
  }

  const sender = event.sender;
  const log = createAutomationLogger(sender);
  const sendStatus = status => emitAutomationStatus(sender, status);

  const scripts = flattenScripts().filter(item => item.script && item.script.trim().length > 0);

  log(`📊 Found ${flattenScripts().length} total scripts, ${scripts.length} with content`);
  
  if (scripts.length === 0) {
    throw new Error('Please add at least one script with content before running automation.');
  }

  automationBusy = true;
  sendStatus({ stage, state: 'running' });

  try {
    if (stage === 'chatgpt') {
      // Use scripts as-is, no batching or duplicate checking
      const result = await runChatGPTBatch({
        scripts: scripts,
        log,
        onResult: async result => {
          const match = findSubsection(result.sectionId, result.subsectionId);
          if (!match) return;
          match.subsection.chatgptResponse = result.response;
          automationState.history.push({
            timestamp: Date.now(),
            sectionId: result.sectionId,
            subsectionId: result.subsectionId,
            script: match.subsection.script || '',
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
      // Read prompts from any available output file
      const fs = require('fs');
      const path = require('path');
      
      // Use the app's working directory (where electron-main.js is located)
      const appDir = __dirname;
      
      // Look for both gemini-prompts and chatgpt-output files
      const geminiFiles = fs.readdirSync(appDir).filter(f => f.startsWith('gemini-prompts-') && f.endsWith('.md'));
      const chatgptFiles = fs.readdirSync(appDir).filter(f => f.includes('chatgpt-output') && f.endsWith('.md'));
      
      // Combine all files and get the most recent one
      const allFiles = [...geminiFiles, ...chatgptFiles];
      
      log(`🔍 Searching for prompt files in: ${appDir}`);
      
      if (allFiles.length === 0) {
        throw new Error('No prompt files found. Please run ChatGPT batch first to generate prompts.');
      }
      
      // Get the most recent file by modification time
      let latestFile = allFiles[0];
      let latestTime = fs.statSync(path.join(appDir, latestFile)).mtime;
      
      for (const file of allFiles) {
        const fileTime = fs.statSync(path.join(appDir, file)).mtime;
        if (fileTime > latestTime) {
          latestFile = file;
          latestTime = fileTime;
        }
      }
      
      const fullPath = path.join(appDir, latestFile);
      log(`📄 Reading prompts from: ${fullPath}`);
      
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      const prompts = parseGeminiPromptsFile(fileContent);
      
      if (prompts.length === 0) {
        throw new Error('No prompts found in the prompts file. The file may not contain properly formatted prompts.');
      }

      log(`🎯 Found ${prompts.length} prompts for Gemini processing`);
      const result = await runGeminiReplay({ prompts, log });
      
      // Return the result to the renderer
      return result;
    } else {
      throw new Error('Unknown automation stage.');
    }
  } finally {
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

    // Save as new subsections
    const newSubsections = await saveExtractedPrompts(extractedPrompts, log);
    
    // Add to automation state
    if (automationState.sections.length === 0) {
      // Create a new section if none exists
      automationState.sections.push({
        id: 'extracted-' + Date.now(),
        name: 'Extracted Prompts',
        subsections: newSubsections
      });
    } else {
      // Add to the first existing section
      automationState.sections[0].subsections.push(...newSubsections);
    }

    saveAndBroadcastAutomationState();
    
    log(`✅ Successfully extracted and saved ${extractedPrompts.length} prompts as new subsections.`);
    
    return {
      success: true,
      promptsCount: extractedPrompts.length,
      subsectionsCount: newSubsections.length,
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
  try {
    await runDownloader(url.trim(), {
      outputDir: finalOutputDir,
      onLog: emitLog,
      onError: emitError
    });
    emitLog(`🎉 Download complete! You can find your images in the ${folderName} folder.`);
  } catch (error) {
    emitError(`❌ ${error.message}`);
    throw error;
  } finally {
    isDownloading = false;
    webContents.send('download-complete');
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
