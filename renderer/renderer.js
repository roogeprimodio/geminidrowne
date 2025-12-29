const appShell = document.querySelector('.app-shell');
const views = document.querySelectorAll('.view');
const navButtons = document.querySelectorAll('[data-nav]');

function showView(name) {
  views.forEach(view => {
    const isActive = view.dataset.view === name;
    view.classList.toggle('active', isActive);
  });

  if (appShell) {
    if (name === 'automation') {
      appShell.classList.add('automation-mode');
    } else {
      appShell.classList.remove('automation-mode');
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navButtons.forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.nav;
    showView(target);
  });
});

const sectionList = document.getElementById('section-list');
const sectionNameInput = document.getElementById('section-name-input');
const addSectionBtn = document.getElementById('add-section-btn');
const scriptInput = document.getElementById('script-input');
const editorTitle = document.getElementById('editor-title');
const editorBreadcrumb = document.getElementById('editor-breadcrumb');
const clearScriptBtn = document.getElementById('clear-script-btn');
const autosaveIndicator = document.getElementById('autosave-indicator');
const automationLog = document.getElementById('automation-log');
const automationStatusPill = document.getElementById('automation-status-pill');
const runChatgptBtn = document.getElementById('run-chatgpt-btn');
const runGeminiBtn = document.getElementById('run-gemini-btn');

let sectionsState = [];
let activeSelection = null; // { sectionId, subsectionId }
let autosaveTimeout;
let automationState = {
  sections: [],
  history: [],
  nextBatchNumber: 1
};
let pendingStateSave;

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function renderSections() {
  if (!sectionList) return;
  sectionList.innerHTML = '';

  if (sectionsState.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No sections yet. Add one to start organizing scripts.';
    sectionList.appendChild(empty);
    return;
  }

  sectionsState.forEach(section => {
    const block = document.createElement('div');
    block.className = 'section-block';
    if (section.collapsed) block.classList.add('collapsed');

    const header = document.createElement('button');
    header.className = 'section-header';
    header.type = 'button';
    header.addEventListener('click', () => {
      section.collapsed = !section.collapsed;
      renderSections();
      queueStateSave();
    });

    const meta = document.createElement('div');
    meta.className = 'section-meta';
    const label = document.createElement('p');
    label.className = 'section-label';
    label.textContent = 'Section';
    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = section.name;
    meta.appendChild(label);
    meta.appendChild(title);

    const caret = document.createElement('span');
    caret.className = 'caret-btn';
    caret.textContent = '▾';

    header.appendChild(meta);
    header.appendChild(caret);

    const body = document.createElement('div');
    body.className = 'section-body';

    const scriptControls = document.createElement('div');
    scriptControls.className = 'script-controls';
    const scriptInputField = document.createElement('input');
    scriptInputField.placeholder = 'Add script slot';
    const scriptAddBtn = document.createElement('button');
    scriptAddBtn.className = 'primary pill';
    scriptAddBtn.textContent = '+ Script';
    scriptAddBtn.addEventListener('click', () => {
      const name = scriptInputField.value.trim();
      if (!name) return;
      addSubsection(section.id, name);
      scriptInputField.value = '';
    });
    scriptInputField.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const name = scriptInputField.value.trim();
        if (!name) return;
        addSubsection(section.id, name);
        scriptInputField.value = '';
      }
    });

    scriptControls.appendChild(scriptInputField);
    scriptControls.appendChild(scriptAddBtn);

    const scriptList = document.createElement('div');
    scriptList.className = 'script-list';

    if (section.subsections.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'btn-text';
      hint.textContent = 'No scripts saved yet.';
      scriptList.appendChild(hint);
    } else {
      section.subsections.forEach(sub => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'script-item';
        const isActive =
          activeSelection &&
          activeSelection.sectionId === section.id &&
          activeSelection.subsectionId === sub.id;
        if (isActive) row.classList.add('active');

        row.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            setActiveSubsection(section.id, sub.id);
          }
        });

        row.addEventListener('keydown', event => {
          if (event.key === 'F2') {
            event.preventDefault();
            const newName = prompt('Rename script', sub.name);
            if (newName && newName.trim()) {
              sub.name = newName.trim();
              renderSections();
              queueStateSave();
            }
          }
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'script-name';
        nameSpan.textContent = sub.name;

        if (sub.batchNumber) {
          const badge = document.createElement('span');
          badge.className = 'script-badge';
          badge.textContent = `Batch ${sub.batchNumber}`;
          row.appendChild(badge);
        }

        row.appendChild(nameSpan);
        row.addEventListener('click', () => setActiveSubsection(section.id, sub.id));
        scriptList.appendChild(row);
      });
    }

    body.appendChild(scriptControls);
    body.appendChild(scriptList);

    block.appendChild(header);
    block.appendChild(body);
    sectionList.appendChild(block);
  });
}

function addSection(name) {
  const section = {
    id: createId('section'),
    name,
    collapsed: false,
    subsections: []
  };
  sectionsState.push(section);
  queueStateSave();
  renderSections();
}

function addSubsection(sectionId, name) {
  const section = sectionsState.find(sec => sec.id === sectionId);
  if (!section) return;
  const subsection = {
    id: createId('sub'),
    name,
    script: ''
  };
  section.subsections.push(subsection);
  setActiveSubsection(sectionId, subsection.id);
  queueStateSave();
  renderSections();
}

function setActiveSubsection(sectionId, subsectionId) {
  activeSelection = { sectionId, subsectionId };
  updateEditorState();
  renderSections();
}

function getActiveSubsection() {
  if (!activeSelection) return null;
  const section = sectionsState.find(sec => sec.id === activeSelection.sectionId);
  if (!section) return null;
  const subsection = section.subsections.find(sub => sub.id === activeSelection.subsectionId);
  if (!subsection) return null;
  return { section, subsection };
}

function updateEditorState() {
  const selection = getActiveSubsection();
  const hasSelection = !!selection;
  scriptInput.disabled = !hasSelection;
  clearScriptBtn.disabled = !hasSelection;

  if (!selection) {
    editorBreadcrumb.textContent = 'No script selected';
    editorTitle.textContent = 'Select a script to edit';
    scriptInput.value = '';
    autosaveIndicator.textContent = 'Waiting for input...';
    return;
  }

  editorBreadcrumb.textContent = selection.section.name;
  editorTitle.textContent = selection.subsection.name;
  scriptInput.value = selection.subsection.script;
  autosaveIndicator.textContent = 'Loaded';
}

function handleRunSection(sectionId) {
  const section = sectionsState.find(sec => sec.id === sectionId);
  if (!section) return;
  appendDesignerLog(`▶️ Running section "${section.name}" with ${section.subsections.length} subsections.`);
}

function appendDesignerLog(message) {
  console.log(message);
}

function queueStateSave() {
  if (!window.electronAPI?.updateAutomationState) return;
  if (automationState) {
    automationState.sections = sectionsState;
  }
  clearTimeout(pendingStateSave);
  pendingStateSave = setTimeout(() => {
    window.electronAPI.updateAutomationState({
      sections: automationState.sections,
      history: automationState.history,
      nextBatchNumber: automationState.nextBatchNumber
    });
  }, 400);
}

function applyAutomationState(state) {
  if (!state) return;
  const collapsedMap = new Map(
    sectionsState.map(section => [section.id, section.collapsed])
  );

  automationState = {
    sections: Array.isArray(state.sections) ? state.sections.map(section => ({
      ...section,
      subsections: Array.isArray(section.subsections) ? section.subsections.map(sub => ({ ...sub })) : [],
      collapsed: collapsedMap.has(section.id) ? collapsedMap.get(section.id) : !!section.collapsed
    })) : [],
    history: Array.isArray(state.history) ? state.history : [],
    nextBatchNumber: state.nextBatchNumber || 1
  };

  sectionsState = automationState.sections;
  renderSections();
  updateEditorState();
}

async function hydrateAutomationState() {
  if (!window.electronAPI?.getAutomationState) {
    renderSections();
    return;
  }
  try {
    const state = await window.electronAPI.getAutomationState();
    applyAutomationState(state);
  } catch (error) {
    console.error('Failed to load automation state', error);
    renderSections();
  }
}

function setAutomationButtonsDisabled(isDisabled) {
  if (runChatgptBtn) runChatgptBtn.disabled = isDisabled;
  if (runGeminiBtn) runGeminiBtn.disabled = isDisabled;
}

function appendAutomationLog(message, timestamp = Date.now(), isError = false) {
  if (!automationLog) return;
  if (automationLog.querySelector('.empty-state')) {
    automationLog.innerHTML = '';
  }
  const row = document.createElement('div');
  row.className = 'automation-log-row';
  if (isError) row.classList.add('error');
  const time = new Date(timestamp).toLocaleTimeString();
  row.innerHTML = `<span class="log-time">${time}</span><span class="log-message">${message}</span>`;
  automationLog.appendChild(row);
  automationLog.scrollTop = automationLog.scrollHeight;
}

function updateAutomationStatus({ stage, state }) {
  if (!automationStatusPill) return;
  if (state === 'running') {
    const label = stage === 'chatgpt' ? 'ChatGPT batch running' : 'Gemini replay running';
    automationStatusPill.textContent = label;
    automationStatusPill.className = 'status-pill running';
    setAutomationButtonsDisabled(true);
  } else {
    automationStatusPill.textContent = 'Idle';
    automationStatusPill.className = 'status-pill idle';
    setAutomationButtonsDisabled(false);
  }
}

async function triggerAutomation(stage) {
  if (!window.electronAPI?.runAutomation) return;
  try {
    appendAutomationLog(
      stage === 'chatgpt'
        ? '▶️ Starting ChatGPT batch...'
        : '▶️ Starting Gemini replay...'
    );
    setAutomationButtonsDisabled(true);
    await window.electronAPI.runAutomation(stage);
  } catch (error) {
    appendAutomationLog(error.message || 'Automation failed', Date.now(), true);
    automationStatusPill.textContent = 'Error';
    automationStatusPill.className = 'status-pill error';
    setAutomationButtonsDisabled(false);
  }
}

if (addSectionBtn) {
  addSectionBtn.addEventListener('click', () => {
    const name = sectionNameInput.value.trim();
    if (!name) return;
    addSection(name);
    sectionNameInput.value = '';
  });

  sectionNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addSectionBtn.click();
    }
  });
}

if (scriptInput) {
  scriptInput.addEventListener('input', () => {
    const selection = getActiveSubsection();
    if (!selection) return;
    selection.subsection.script = scriptInput.value;
    autosaveIndicator.textContent = 'Saving...';
    clearTimeout(autosaveTimeout);
    autosaveTimeout = setTimeout(() => {
      autosaveIndicator.textContent = 'Saved';
    }, 600);
    queueStateSave();
  });
}

if (clearScriptBtn) {
  clearScriptBtn.addEventListener('click', () => {
    const selection = getActiveSubsection();
    if (!selection) return;
    selection.subsection.script = '';
    scriptInput.value = '';
    autosaveIndicator.textContent = 'Cleared';
    queueStateSave();
  });
}

const form = document.getElementById('download-form');
const startBtn = document.getElementById('start-btn');
const logOutput = document.getElementById('log-output');
const statusPill = document.getElementById('status-pill');
const browseBtn = document.getElementById('browse-btn');
const outputDirInput = document.getElementById('output-dir');

if (browseBtn && outputDirInput) {
  browseBtn.addEventListener('click', async () => {
    const selectedPath = await window.electronAPI.selectFolder();
    if (selectedPath) {
      outputDirInput.value = selectedPath;
    }
  });
}

function setRunning(isRunning) {
  if (!startBtn || !statusPill) return;
  startBtn.disabled = isRunning;
  statusPill.textContent = isRunning ? 'Running' : 'Idle';
  statusPill.className = isRunning ? 'running' : 'idle';
}

function appendLog(message, isError = false) {
  if (!logOutput) return;
  const line = document.createElement('div');
  line.textContent = message;
  if (isError) {
    line.classList.add('error');
  }
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
}

if (form) {
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
    if (!statusPill) return;
    statusPill.textContent = 'Finished';
    statusPill.className = 'done';
  });
}

if (runChatgptBtn) {
  runChatgptBtn.addEventListener('click', () => triggerAutomation('chatgpt'));
}

if (runGeminiBtn) {
  runGeminiBtn.addEventListener('click', () => triggerAutomation('gemini'));
}

if (window.electronAPI) {
  window.electronAPI.onAutomationState(state => applyAutomationState(state));
  window.electronAPI.onAutomationLog(payload =>
    appendAutomationLog(payload.message, payload.timestamp)
  );
  window.electronAPI.onAutomationRunStatus(status => updateAutomationStatus(status));
}

hydrateAutomationState();
showView('home');
