const form = document.getElementById('download-form');
const startBtn = document.getElementById('start-btn');
const logOutput = document.getElementById('log-output');
const statusPill = document.getElementById('status-pill');
const browseBtn = document.getElementById('browse-btn');
const outputDirInput = document.getElementById('output-dir');

browseBtn.addEventListener('click', async () => {
  const selectedPath = await window.electronAPI.selectFolder();
  if (selectedPath) {
    outputDirInput.value = selectedPath;
  }
});

function setRunning(isRunning) {
  startBtn.disabled = isRunning;
  statusPill.textContent = isRunning ? 'Running' : 'Idle';
  statusPill.className = isRunning ? 'running' : 'idle';
}

function appendLog(message, isError = false) {
  const line = document.createElement('div');
  line.textContent = message;
  if (isError) {
    line.classList.add('error');
  }
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = {
    url: formData.get('geminiUrl'),
    outputDir: formData.get('outputDir'),
    outputFolderName: formData.get('outputFolderName')
  };

  appendLog(`➡️ Starting download for ${payload.url}`);
  setRunning(true);

  try {
    await window.electronAPI.startDownload(payload);
  } catch (error) {
    appendLog(error.message || 'Unexpected error', true);
    setRunning(false);
  }
});

window.electronAPI.onLogMessage((message) => appendLog(message));
window.electronAPI.onLogError((message) => appendLog(message, true));
window.electronAPI.onDownloadComplete(() => {
  setRunning(false);
  statusPill.textContent = 'Finished';
  statusPill.className = 'done';
});
