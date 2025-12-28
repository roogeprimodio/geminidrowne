const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { runDownloader } = require('./download-gemini-images.js');

let mainWindow;
let isDownloading = false;

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
}

app.whenReady().then(() => {
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
