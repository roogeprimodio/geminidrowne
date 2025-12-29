const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { runDownloader } = require('./download-gemini-images.js');
const { runChatGPTBatch, runGeminiReplay } = require('./automation-runner');
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

  if (scripts.length === 0) {
    throw new Error('Please add at least one script with content before running automation.');
  }

  automationBusy = true;
  sendStatus({ stage, state: 'running' });

  try {
    if (stage === 'chatgpt') {
      const seenScripts = new Map();
      automationState.history.forEach(entry => {
        seenScripts.set((entry.script || '').trim(), entry.batchNumber);
      });

      const preparedScripts = [];
      let nextBatch = automationState.nextBatchNumber || 1;
      scripts.forEach(script => {
        const trimmed = script.script.trim();
        if (seenScripts.has(trimmed)) {
          throw new Error(`⚠️ Script "${script.scriptName}" matches Batch ${seenScripts.get(trimmed)}. Please update the text before rerunning.`);
        }
        const payload = {
          ...script,
          batchNumber: nextBatch,
          batchLabel: `Batch ${nextBatch}`,
          script: `Batch ${nextBatch} script:\n${trimmed}`
        };
        preparedScripts.push(payload);
        nextBatch += 1;
      });

      await runChatGPTBatch({
        scripts: preparedScripts,
        log,
        onResult: async result => {
          const match = findSubsection(result.sectionId, result.subsectionId);
          if (!match) return;
          match.subsection.chatgptResponse = result.response;
          match.subsection.batchNumber = result.batchNumber;
          match.subsection.batchLabel = result.batchLabel;
          automationState.history.push({
            timestamp: Date.now(),
            sectionId: result.sectionId,
            subsectionId: result.subsectionId,
            batchNumber: result.batchNumber,
            batchLabel: result.batchLabel,
            script: match.subsection.script || '',
            response: result.response
          });
          saveAndBroadcastAutomationState();
        }
      });

      automationState.nextBatchNumber = preparedScripts[preparedScripts.length - 1].batchNumber + 1;
      saveAndBroadcastAutomationState();
      log('💾 ChatGPT outputs saved to disk.');
    } else if (stage === 'gemini') {
      const prompts = [];
      automationState.sections.forEach(section => {
        section.subsections
          .filter(sub => sub.chatgptResponse && sub.batchNumber)
          .sort((a, b) => (a.batchNumber || 0) - (b.batchNumber || 0))
          .forEach(sub => {
            prompts.push({
              response: sub.chatgptResponse,
              batchLabel: sub.batchLabel || `Batch ${sub.batchNumber}`
            });
          });
      });

      if (prompts.length === 0) {
        throw new Error('No ChatGPT outputs found. Run the ChatGPT batch first.');
      }

      await runGeminiReplay({ prompts, log });
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
