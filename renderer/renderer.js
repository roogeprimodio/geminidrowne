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
const viewOutputBtn = document.getElementById('view-output-btn');
const chatgptResponsesBtn = document.getElementById('chatgpt-responses-btn');
const openExtractionBtn = document.getElementById('open-extraction-btn');
const resetAppBtn = document.getElementById('reset-app-btn');
const drawerToggleBtn = document.getElementById('drawer-toggle-btn');
const chatExtraction = document.getElementById('chat-extraction');
const chatUrlInput = document.getElementById('chat-url-input');
const extractPromptsBtn = document.getElementById('extract-prompts-btn');
const extractionStatusPill = document.getElementById('extraction-status-pill');
const chatgptPauseBtn = document.getElementById('chatgpt-pause-btn');
const chatgptResumeBtn = document.getElementById('chatgpt-resume-btn');
const chatgptStopBtn = document.getElementById('chatgpt-stop-btn');
const geminiPauseBtn = document.getElementById('gemini-pause-btn');
const geminiResumeBtn = document.getElementById('gemini-resume-btn');
const geminiStopBtn = document.getElementById('gemini-stop-btn');
const responsesModal = document.getElementById('responses-modal');
const responsesEditor = document.getElementById('responses-editor');
const responsesStatus = document.getElementById('responses-status');
const responsesStats = document.getElementById('responses-stats');
const closeResponsesBtn = document.getElementById('close-responses-btn');
const downloadResponsesBtn = document.getElementById('download-responses-btn');
const clearResponsesBtn = document.getElementById('clear-responses-btn');

let sectionsState = [];
let activeSelection = null; // { sectionId, subsectionId }
let autosaveTimeout;
let automationState = {
  sections: [],
  history: [],
  nextBatchNumber: 1
};
let pendingStateSave;
let drawerOpen = true;

// Initialize control buttons in a safe idle state
setStageControlState('chatgpt', 'idle');
setStageControlState('gemini', 'idle');

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

    const controls = document.createElement('div');
    controls.className = 'section-controls';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'delete-section-btn';
    editBtn.type = 'button';
    editBtn.innerHTML = '<i data-lucide="pencil-line"></i>';
    editBtn.title = 'Rename section';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Rename section', section.name);
      if (newName && newName.trim()) {
        section.name = newName.trim();
        renderSections();
        queueStateSave();
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-section-btn';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.title = 'Delete section';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete "${section.name}" and all its scripts?`)) {
        deleteSection(section.id);
      }
    });

    controls.appendChild(editBtn);
    controls.appendChild(deleteBtn);

    const caret = document.createElement('span');
    caret.className = 'caret-btn';
    caret.innerHTML = '<i data-lucide="chevron-down"></i>';

    header.appendChild(meta);
    header.appendChild(controls);
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
        const row = document.createElement('div');
        row.className = 'script-item';
        const isActive =
          activeSelection &&
          activeSelection.sectionId === section.id &&
          activeSelection.subsectionId === sub.id;
        if (isActive) row.classList.add('active');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'script-name';
        nameSpan.textContent = sub.name;

        if (sub.batchNumber) {
          const badge = document.createElement('span');
          badge.className = 'script-badge';
          badge.textContent = `Batch ${sub.batchNumber}`;
          row.appendChild(badge);
        }

        const actions = document.createElement('div');
        actions.className = 'script-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'script-action-btn';
        editBtn.title = 'Rename script';
        editBtn.innerHTML = '<i data-lucide="pencil-line"></i>';
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const newName = prompt('Rename script', sub.name);
          if (newName && newName.trim()) {
            sub.name = newName.trim();
            renderSections();
            queueStateSave();
          }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'script-action-btn danger';
        deleteBtn.title = 'Delete script';
        deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete script "${sub.name}"?`)) {
            deleteSubsection(section.id, sub.id);
          }
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(nameSpan);
        row.appendChild(actions);
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

  // Reinitialize Lucide icons after rendering
  if (window.lucide) {
    window.lucide.createIcons();
  }
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

function deleteSection(sectionId) {
  sectionsState = sectionsState.filter(section => section.id !== sectionId);
  
  // Clear active selection if it was in the deleted section
  if (activeSelection && activeSelection.sectionId === sectionId) {
    activeSelection = null;
    updateEditorState();
  }
  
  queueStateSave();
  renderSections();
}

function deleteSubsection(sectionId, subsectionId) {
  const section = sectionsState.find(sec => sec.id === sectionId);
  if (!section) return;

  section.subsections = section.subsections.filter(sub => sub.id !== subsectionId);

  if (
    activeSelection &&
    activeSelection.sectionId === sectionId &&
    activeSelection.subsectionId === subsectionId
  ) {
    activeSelection = null;
    updateEditorState();
  }

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

function setStageControlState(stage, state) {
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isActive = isRunning || isPaused;

  if (stage === 'chatgpt') {
    if (chatgptPauseBtn) chatgptPauseBtn.disabled = !isRunning;
    if (chatgptResumeBtn) chatgptResumeBtn.disabled = !isPaused;
    if (chatgptStopBtn) chatgptStopBtn.disabled = !isActive;
  } else if (stage === 'gemini') {
    if (geminiPauseBtn) geminiPauseBtn.disabled = !isRunning;
    if (geminiResumeBtn) geminiResumeBtn.disabled = !isPaused;
    if (geminiStopBtn) geminiStopBtn.disabled = !isActive;
  } else {
    // Default: disable all when unknown
    if (chatgptPauseBtn) chatgptPauseBtn.disabled = true;
    if (chatgptResumeBtn) chatgptResumeBtn.disabled = true;
    if (chatgptStopBtn) chatgptStopBtn.disabled = true;
    if (geminiPauseBtn) geminiPauseBtn.disabled = true;
    if (geminiResumeBtn) geminiResumeBtn.disabled = true;
    if (geminiStopBtn) geminiStopBtn.disabled = true;
  }
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

  let label = 'Idle';
  let className = 'status-pill idle';
  const disableRuns = state === 'running' || state === 'paused';

  if (state === 'running') {
    label = stage === 'chatgpt' ? 'ChatGPT batch running' : 'Gemini replay running';
    className = 'status-pill running';
  } else if (state === 'paused') {
    label = stage === 'chatgpt' ? 'ChatGPT paused' : 'Gemini paused';
    className = 'status-pill warning';
  } else if (state === 'aborted') {
    label = 'Run aborted';
    className = 'status-pill error';
  }

  automationStatusPill.textContent = label;
  automationStatusPill.className = className;
  setAutomationButtonsDisabled(disableRuns);
  if (stage === 'chatgpt') {
    setStageControlState('chatgpt', state);
    setStageControlState('gemini', 'idle');
  } else if (stage === 'gemini') {
    setStageControlState('gemini', state);
    setStageControlState('chatgpt', 'idle');
  } else {
    setStageControlState('chatgpt', 'idle');
    setStageControlState('gemini', 'idle');
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
    
    // Get scripts for validation
    const scripts = getFlattenedScripts();
    
    if (stage === 'chatgpt' && scripts.length > 0) {
      // Run validation before starting
      const validation = validateScriptsLocally(scripts);
      
      let shouldContinue = true;
      
      // Show validation popup if there are issues
      if (validation.duplicates.length > 0 || validation.empty.length > 0) {
        shouldContinue = await showValidationPopup(validation);
      }
      
      if (!shouldContinue) {
        appendAutomationLog('❌ Automation cancelled by user');
        return;
      }
    }
    
    setAutomationButtonsDisabled(true);
    const result = await window.electronAPI.runAutomation(stage);
    
    // Handle ChatGPT batch completion
    if (stage === 'chatgpt' && result && result.completed) {
      appendAutomationLog('🎉 ChatGPT batch completed successfully!');
      appendAutomationLog(`📊 Processed ${result.scriptsProcessed || 'unknown'} scripts`);
      showChatExtraction();
    } else if (stage === 'chatgpt') {
      appendAutomationLog('⚠️ ChatGPT batch completed but result state unclear');
    }
  } catch (error) {
    appendAutomationLog(error.message || 'Automation failed', Date.now(), true);
    automationStatusPill.textContent = 'Error';
    automationStatusPill.className = 'status-pill error';
    setAutomationButtonsDisabled(false);
  }
}

async function setAutomationControl(stage, action) {
  if (!window.electronAPI?.setAutomationControl) return;
  try {
    await window.electronAPI.setAutomationControl({ stage, action });
    const verb =
      action === 'pause' ? '⏸️ Paused' :
      action === 'resume' || action === 'continue' ? '▶️ Resumed' :
      action === 'abort' || action === 'stop' ? '⏹️ Stopped' : action;
    appendAutomationLog(`${verb} ${stage.toUpperCase()} run.`);
  } catch (error) {
    appendAutomationLog(error.message || 'Failed to update control state', Date.now(), true);
  }
}

async function showResponsesModal() {
  if (!responsesModal || !responsesEditor) return;

  // Refresh latest history from main to avoid stale data
  let latestHistory = Array.isArray(automationState?.history) ? automationState.history : [];
  if (window.electronAPI?.getAutomationState) {
    try {
      const state = await window.electronAPI.getAutomationState();
      if (state && Array.isArray(state.history)) {
        latestHistory = state.history;
        automationState.history = state.history;
      }
    } catch (err) {
      console.warn('Failed to refresh history before showing responses modal', err);
    }
  }

  let content = '';
  if (latestHistory.length > 0) {
    content += `# ChatGPT Responses\n\n`;
    content += `Generated: ${new Date().toLocaleString()}\n`;
    content += `Total Responses: ${latestHistory.length}\n\n`;
    
    latestHistory.forEach((entry, index) => {
      content += `## ${index + 1}. ${entry.script || 'Untitled Script'}\n\n`;
      content += `${entry.response || '[No response captured]'}\n\n`;
    });
  } else {
    content = '# No ChatGPT responses yet\n\nRun a batch to populate responses.';
  }

  responsesEditor.value = content.trim();
  responsesStatus.textContent = 'Ready';
  responsesStats.textContent = `${latestHistory.length || 0} responses`;
  responsesModal.style.display = 'flex';
  appendAutomationLog('👁️ Viewing ChatGPT responses');
}

function hideResponsesModal() {
  if (!responsesModal) return;
  responsesModal.style.display = 'none';
}

function downloadResponses() {
  if (!responsesEditor) return;
  const blob = new Blob([responsesEditor.value || ''], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt-responses-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  responsesStatus.textContent = 'Downloaded';
  setTimeout(() => (responsesStatus.textContent = 'Ready'), 1500);
}

async function clearResponses() {
  if (!window.electronAPI?.updateAutomationState) return;
  if (!confirm('Clear all saved ChatGPT responses?')) return;

  automationState.history = [];
  automationState.sections = automationState.sections.map(section => ({
    ...section,
    subsections: section.subsections.map(sub => ({
      ...sub,
      chatgptResponse: undefined
    }))
  }));

  await window.electronAPI.updateAutomationState({
    sections: automationState.sections,
    history: automationState.history,
    nextBatchNumber: automationState.nextBatchNumber
  });

  responsesEditor.value = '# No ChatGPT responses yet\n\nRun a batch to populate responses.';
  responsesStats.textContent = '0 responses';
  responsesStatus.textContent = 'Cleared';
  appendAutomationLog('🧹 Cleared saved ChatGPT responses');
}

function openExtractionPanel() {
  showChatExtraction();
  setExtractionStatus('idle', 'Ready');
}

function getFlattenedScripts() {
  const scripts = [];
  
  sectionsState.forEach((section, sectionIndex) => {
    section.subsections.forEach((subsection, subsectionIndex) => {
      if (subsection.script && subsection.script.trim().length > 0) {
        scripts.push({
          scriptName: subsection.name,
          script: subsection.script,
          sectionName: section.name,
          subsectionName: subsection.name,
          sectionIndex: sectionIndex,
          subsectionIndex: subsectionIndex,
          batchNumber: scripts.length + 1
        });
      }
    });
  });
  
  return scripts;
}

// Local validation function (simplified version)
function validateScriptsLocally(scripts) {
  const validation = {
    duplicates: [],
    empty: [],
    total: scripts.length,
    valid: 0
  };
  
  // Check for empty scripts
  scripts.forEach((script, i) => {
    if (!script.script || script.script.trim().length === 0) {
      validation.empty.push({
        scriptName: script.scriptName,
        index: i
      });
    }
  });
  
  // Simple duplicate check (exact match for now)
  for (let i = 0; i < scripts.length; i++) {
    for (let j = i + 1; j < scripts.length; j++) {
      const script1 = scripts[i];
      const script2 = scripts[j];
      
      if (script1.script && script2.script && 
          script1.script.trim().toLowerCase() === script2.script.trim().toLowerCase()) {
        validation.duplicates.push({
          scriptName: script2.scriptName,
          originalScriptName: script1.scriptName,
          percentage: 100,
          index: j,
          originalIndex: i
        });
      }
    }
  }
  
  validation.valid = validation.total - validation.empty.length;
  return validation;
}

// Show validation popup
async function showValidationPopup(validation) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      max-height: 70vh;
      overflow-y: auto;
    `;
    
    let html = `
      <h3 style="margin: 0 0 16px 0; color: var(--text);">🔍 Script Validation Results</h3>
      <div style="margin-bottom: 20px;">
        <p style="margin: 4px 0; color: var(--text);">Total scripts: <strong>${validation.total}</strong></p>
        <p style="margin: 4px 0; color: var(--text);">Valid scripts: <strong>${validation.valid}</strong></p>
        <p style="margin: 4px 0; color: var(--error);">Empty scripts: <strong>${validation.empty.length}</strong></p>
        <p style="margin: 4px 0; color: var(--warning);">Potential duplicates: <strong>${validation.duplicates.length}</strong></p>
      </div>
    `;
    
    if (validation.empty.length > 0) {
      html += `
        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--error);">Empty Scripts:</h4>
          ${validation.empty.map(e => `<p style="margin: 4px 0; color: var(--text-muted);">• ${e.scriptName}</p>`).join('')}
        </div>
      `;
    }
    
    if (validation.duplicates.length > 0) {
      html += `
        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--warning);">Potential Duplicates:</h4>
          ${validation.duplicates.map(d => `<p style="margin: 4px 0; color: var(--text-muted);">• "${d.scriptName}" is ${d.percentage}% similar to "${d.originalScriptName}"</p>`).join('')}
        </div>
      `;
    }
    
    html += `
      <div style="display: flex; gap: 12px; margin-top: 20px;">
        <button id="continue-btn" style="flex: 1; padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">Continue Anyway</button>
        <button id="cancel-btn" style="flex: 1; padding: 8px 16px; background: var(--error); color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
      </div>
    `;
    
    content.innerHTML = html;
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    document.getElementById('continue-btn').onclick = () => {
      document.body.removeChild(modal);
      resolve(true);
    };
    
    document.getElementById('cancel-btn').onclick = () => {
      document.body.removeChild(modal);
      resolve(false);
    };
    
    // Close on outside click
    modal.onclick = (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        resolve(false);
      }
    };
  });
}

// Toggle log size function
function toggleLogSize() {
  const automationLogElement = document.getElementById('automation-log');
  if (!automationLogElement) return;
  
  automationLogElement.classList.toggle('expanded');
  
  // Update button text if exists
  const toggleBtn = document.getElementById('log-toggle-btn');
  if (toggleBtn) {
    const isExpanded = automationLogElement.classList.contains('expanded');
    toggleBtn.textContent = isExpanded ? '▼ Minimize' : '▲ Expand';
  }
}

// Switch log tab function
function switchLogTab(tabName) {
  // Update tab buttons
  const tabs = document.querySelectorAll('.log-tab');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update log views
  const views = document.querySelectorAll('.log-view');
  views.forEach(view => {
    view.classList.toggle('active', view.id === `log-${tabName}`);
  });
}

// Enhanced log append with tab support
function appendAutomationLog(message, timestamp = Date.now(), isError = false) {
  const allLogsView = document.getElementById('log-all');
  const cleanLogsView = document.getElementById('log-clean');
  
  // Remove empty state if exists
  if (allLogsView && allLogsView.querySelector('.empty-state')) {
    allLogsView.innerHTML = '';
  }
  if (cleanLogsView && cleanLogsView.querySelector('.empty-state')) {
    cleanLogsView.innerHTML = '';
  }
  
  // Create log entry
  const logEntry = createLogEntry(message, timestamp, isError);
  
  // Add to all logs
  if (allLogsView) {
    allLogsView.appendChild(logEntry.cloneNode(true));
    allLogsView.scrollTop = allLogsView.scrollHeight;
  }
  
  // Add to clean logs (filtered)
  if (cleanLogsView && isCleanLogMessage(message)) {
    cleanLogsView.appendChild(logEntry);
    cleanLogsView.scrollTop = cleanLogsView.scrollHeight;
  }
}

// Create log entry element
function createLogEntry(message, timestamp, isError) {
  const row = document.createElement('div');
  row.className = 'automation-log-row';
  
  // Add log type classes
  if (isError) {
    row.classList.add('error');
  } else if (message.includes('✅') || message.includes('🎉')) {
    row.classList.add('success');
  } else if (message.includes('⚠️') || message.includes('⏭️')) {
    row.classList.add('warning');
  } else if (message.includes('▶️') || message.includes('🔄') || message.includes('📊')) {
    row.classList.add('info');
  }
  
  const time = new Date(timestamp).toLocaleTimeString();
  row.innerHTML = `<span class="log-time">${time}</span><span class="log-message">${message}</span>`;
  
  return row;
}

// Determine if message should appear in clean logs
function isCleanLogMessage(message) {
  // Include important messages in clean logs
  const cleanPatterns = [
    /✅/, // Success
    /❌/, // Errors
    /⚠️/, // Warnings
    /⏭️/, // Skips
    /🎉/, // Completion
    /▶️.*Starting/, // Start messages
    /📊.*Processing/, // Processing messages
    /🔄.*Processing/, // Processing messages
    /📊.*Found.*scripts/, // Script counts
    /✅.*processed.*scripts/ // Completion counts
  ];
  
  return cleanPatterns.some(pattern => pattern.test(message));
}

// Enhanced error handling
function handleAutomationError(error, context = '') {
  console.error(`Automation Error ${context}:`, error);
  
  const errorMessage = error?.message || error || 'Unknown error occurred';
  
  appendAutomationLog(`❌ Error${context ? ` in ${context}` : ''}: ${errorMessage}`, Date.now(), true);
  
  // Update UI status
  if (automationStatusPill) {
    automationStatusPill.textContent = 'Error';
    automationStatusPill.className = 'status-pill error';
  }
  
  setAutomationButtonsDisabled(false);
}

// Retry mechanism for failed operations
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      appendAutomationLog(`⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`, Date.now(), false);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

function showChatExtraction() {
  if (chatExtraction) {
    chatExtraction.style.display = 'block';
    appendAutomationLog('🔗 Chat extraction UI is now available. Paste your ChatGPT chat link to extract prompts.');
  }
}

function hideChatExtraction() {
  if (chatExtraction) {
    chatExtraction.style.display = 'none';
  }
}

function setExtractionStatus(status, text = status) {
  if (!extractionStatusPill) return;
  extractionStatusPill.textContent = text;
  extractionStatusPill.className = `status-pill ${status}`;
}

async function handleExtractPrompts() {
  if (!window.electronAPI?.extractPromptsFromChat || !chatUrlInput) return;
  
  const chatUrl = chatUrlInput.value.trim();
  if (!chatUrl) {
    appendAutomationLog('❌ Please enter a ChatGPT chat URL.', Date.now(), true);
    return;
  }

  try {
    setExtractionStatus('running', 'Extracting...');
    if (extractPromptsBtn) {
      extractPromptsBtn.disabled = true;
      extractPromptsBtn.querySelector('.btn-label').textContent = 'Extracting...';
    }

    appendAutomationLog(`🔗 Extracting prompts from: ${chatUrl}`);
    
    const result = await window.electronAPI.extractPromptsFromChat(chatUrl);
    
    if (result.success) {
      appendAutomationLog(`✅ Successfully extracted ${result.promptsCount} prompts and saved as ${result.subsectionsCount} new subsections.`);
      setExtractionStatus('done', 'Completed');
      hideChatExtraction();
      chatUrlInput.value = '';
    }
    
  } catch (error) {
    appendAutomationLog(error.message || 'Prompt extraction failed', Date.now(), true);
    setExtractionStatus('error', 'Failed');
  } finally {
    if (extractPromptsBtn) {
      extractPromptsBtn.disabled = false;
      extractPromptsBtn.querySelector('.btn-label').textContent = 'Extract Prompts';
    }
  }
}

function toggleDrawer() {
  drawerOpen = !drawerOpen;
  const automationShell = document.querySelector('.automation-shell');
  if (automationShell) {
    automationShell.classList.toggle('drawer-closed', !drawerOpen);
  }
  
  // Update toggle icon
  if (drawerToggleBtn) {
    const icon = drawerToggleBtn.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', drawerOpen ? 'menu' : 'x');
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
  }
}

function handleViewOutput() {
  showOutputModal();
}

async function showOutputModal() {
  const modal = document.getElementById('output-modal');
  const editor = document.getElementById('output-editor');
  const statusSpan = document.getElementById('output-status');
  const statsSpan = document.getElementById('output-stats');
  
  // Pull latest history from main to avoid stale prompts (do not overwrite local scripts)
  let latestHistory = Array.isArray(automationState?.history) ? automationState.history : [];
  if (window.electronAPI?.getAutomationState) {
    try {
      const state = await window.electronAPI.getAutomationState();
      if (state && Array.isArray(state.history)) {
        latestHistory = state.history;
        automationState.history = state.history;
      }
    } catch (err) {
      console.warn('Failed to refresh history before showing output modal', err);
    }
  }

  // Generate output content
  let outputContent = '';
  let totalPrompts = 0;
  const generatedAt = new Date().toLocaleString();
  
  if (latestHistory.length > 0) {
    outputContent += `# Gemini Prompts\n\n`;
    outputContent += `Generated: ${generatedAt}\n`;
    outputContent += `Total Scripts: ${latestHistory.length}\n\n`;
    
    latestHistory.forEach((entry, scriptIndex) => {
      if (entry.response && entry.response.trim().length > 0) {
        const prompts = extractPromptsFromResponse(entry.response);
        const scriptNumber = scriptIndex + 1;
        let promptIndex = 1;

        prompts.forEach(prompt => {
          const cleanedPrompt = prompt.replace(/^[0-9]+(\.[0-9]+)*\s*/, '').trim();
          if (!cleanedPrompt) return;
          const promptNumber = `${scriptNumber}.${promptIndex}`;
          outputContent += `${promptNumber} ${cleanedPrompt}\n\n`;
          promptIndex++;
          totalPrompts++;
        });
      }
    });
    
    if (totalPrompts === 0) {
      outputContent += `No prompts found in ChatGPT responses.\n\nPlease check the responses and ensure they contain properly formatted prompts.`;
    }
  } else {
    outputContent = `# No Prompts Available\n\nNo ChatGPT responses have been generated yet. Run the ChatGPT batch first.`;
  }
  
  // Update modal content
  editor.value = outputContent;
  statusSpan.textContent = 'Ready';
  statsSpan.textContent = `${totalPrompts} prompts`;
  
  // Show modal
  modal.style.display = 'flex';
  
  appendAutomationLog('📄 Output modal opened');
}

function extractPromptsFromResponse(response) {
  const prompts = [];
  
  // Split response by code blocks (``` ) to get complete prompts
  const codeBlocks = response.split(/```/);
  
  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i].trim();
    
    // Skip empty blocks and language identifiers
    if (block.length === 0 || block === 'markdown' || block === 'text') {
      continue;
    }
    
    // Only extract prompts that start with 1.x, 2.x, 3.x, etc. (script numbering)
    // Skip ChatGPT's internal numbering (11.x, 12.x, 51.x, etc.)
    if (/^[1-9]\.\d+\s/.test(block) && !/^[1][1-9]\./.test(block)) {
      prompts.push(block);
    }
    // Also check for script content without numbering
    else if (block.includes('🎥 Video Title') || 
             block.includes('✅ 45-Second YouTube Shorts Script') ||
             block.includes('[SEGMENT') ||
             block.includes('🎙️ News Narration:') ||
             block.includes('🖼️ Image to Display:') ||
             block.includes('🎬 Scene Description:') ||
             block.includes('📝 Script:')) {
      prompts.push(block);
    }
  }
  
  // If no code blocks found, try to extract numbered lines from the entire response
  if (prompts.length === 0) {
    const lines = response.split('\n');
    let currentPrompt = '';
    let scriptIndex = 1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Only start new prompt if line begins with script numbering (1.x, 2.x, etc.)
      // Skip ChatGPT's internal numbering
      if (/^[1-9]\.\d+\s/.test(line) && !/^[1][1-9]\./.test(line)) {
        // Save previous prompt if exists
        if (currentPrompt.trim().length > 0) {
          prompts.push(currentPrompt.trim());
        }
        currentPrompt = line;
        scriptIndex++;
      }
      // Continue adding to current prompt
      else if (currentPrompt.length > 0 && line.length > 0) {
        currentPrompt += '\n' + line;
        
        // End prompt if we hit a major separator
        if (line.includes('---') || line.includes('===') || line.includes('###')) {
          prompts.push(currentPrompt.trim());
          currentPrompt = '';
        }
      }
    }
    
    // Add the last prompt
    if (currentPrompt.trim().length > 0) {
      prompts.push(currentPrompt.trim());
    }
  }
  
  return prompts;
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

if (chatgptPauseBtn) {
  chatgptPauseBtn.addEventListener('click', () => setAutomationControl('chatgpt', 'pause'));
}

if (chatgptResumeBtn) {
  chatgptResumeBtn.addEventListener('click', () => setAutomationControl('chatgpt', 'resume'));
}

if (chatgptStopBtn) {
  chatgptStopBtn.addEventListener('click', () => setAutomationControl('chatgpt', 'abort'));
}

if (geminiPauseBtn) {
  geminiPauseBtn.addEventListener('click', () => setAutomationControl('gemini', 'pause'));
}

if (geminiResumeBtn) {
  geminiResumeBtn.addEventListener('click', () => setAutomationControl('gemini', 'resume'));
}

if (geminiStopBtn) {
  geminiStopBtn.addEventListener('click', () => setAutomationControl('gemini', 'abort'));
}

if (viewOutputBtn) {
  viewOutputBtn.addEventListener('click', handleViewOutput);
}

if (chatgptResponsesBtn) {
  chatgptResponsesBtn.addEventListener('click', showResponsesModal);
}

if (closeResponsesBtn) {
  closeResponsesBtn.addEventListener('click', hideResponsesModal);
}

if (downloadResponsesBtn) {
  downloadResponsesBtn.addEventListener('click', downloadResponses);
}

if (clearResponsesBtn) {
  clearResponsesBtn.addEventListener('click', clearResponses);
}

if (openExtractionBtn) {
  openExtractionBtn.addEventListener('click', openExtractionPanel);
}

if (resetAppBtn) {
  resetAppBtn.addEventListener('click', async () => {
    if (confirm('Reset everything? This clears sections, scripts, history, and responses.')) {
      try {
        await window.electronAPI.resetAutomationStateAll();
        await hydrateAutomationState();
        appendAutomationLog('🧹 Full reset completed');
      } catch (error) {
        appendAutomationLog(`❌ Failed to reset app: ${error.message}`, Date.now(), true);
      }
    }
  });
}

const resetOutputBtn = document.getElementById('reset-output-btn');
if (resetOutputBtn) {
  resetOutputBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all output? This will clear all ChatGPT responses and start fresh.')) {
      try {
        await window.electronAPI.resetAutomationState();
        appendAutomationLog('🔄 Output reset successfully');
      } catch (error) {
        appendAutomationLog(`❌ Failed to reset output: ${error.message}`);
      }
    }
  });
}

// Modal event listeners
const closeModalBtn = document.getElementById('close-modal-btn');
const downloadOutputBtn = document.getElementById('download-output-btn');
const saveOutputBtn = document.getElementById('save-output-btn');
const clearOutputBtn = document.getElementById('clear-output-btn');
const outputEditor = document.getElementById('output-editor');

if (closeModalBtn) {
  closeModalBtn.addEventListener('click', () => {
    document.getElementById('output-modal').style.display = 'none';
    appendAutomationLog('📄 Output modal closed');
  });
}

if (downloadOutputBtn) {
  downloadOutputBtn.addEventListener('click', () => {
    const content = outputEditor.value;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-prompts-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    appendAutomationLog('📄 Output downloaded successfully');
  });
}

if (saveOutputBtn) {
  saveOutputBtn.addEventListener('click', async () => {
    const content = outputEditor.value;
    // Here you could implement saving to the automation state if needed
    appendAutomationLog('💾 Output changes saved locally');
    document.getElementById('output-status').textContent = 'Saved';
    setTimeout(() => {
      document.getElementById('output-status').textContent = 'Ready';
    }, 2000);
  });
}

if (clearOutputBtn) {
  clearOutputBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all output content?')) {
      outputEditor.value = '# No Prompts Available\n\nNo prompts available.';
      document.getElementById('output-stats').textContent = '0 prompts';
      appendAutomationLog('🗑️ Output content cleared');
    }
  });
}

// Update stats when editor content changes
if (outputEditor) {
  outputEditor.addEventListener('input', () => {
    const content = outputEditor.value;
    const promptMatches = content.match(/^\d+\.\d+\s/gm) || [];
    document.getElementById('output-stats').textContent = `${promptMatches.length} prompts`;
    document.getElementById('output-status').textContent = 'Modified';
  });
}

if (drawerToggleBtn) {
  drawerToggleBtn.addEventListener('click', toggleDrawer);
}

if (extractPromptsBtn) {
  extractPromptsBtn.addEventListener('click', handleExtractPrompts);
}

if (chatUrlInput) {
  chatUrlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      handleExtractPrompts();
    }
  });
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

// Initialize Lucide icons after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

// Fallback initialization if DOMContentLoaded already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  });
} else {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
