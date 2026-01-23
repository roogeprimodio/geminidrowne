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

// --- OneNote Hub Elements ---
const onenoteHubBtn = document.getElementById('onenote-hub-btn');
const onenoteModal = document.getElementById('onenote-modal');
const closeOnenoteBtn = document.getElementById('close-onenote-btn');
const onenoteLoginBtn = document.getElementById('onenote-login-btn');
const onenoteRefreshBtn = document.getElementById('onenote-refresh-btn');
const onenoteLoginView = document.getElementById('onenote-login-view');
const onenotePagesView = document.getElementById('onenote-pages-view');
const onenoteClientIdInput = document.getElementById('onenote-client-id');
const onenoteContentList = document.getElementById('onenote-content-list');
const onenoteBackBtn = document.getElementById('onenote-back-btn');
const onenoteBreadcrumbs = document.getElementById('onenote-breadcrumbs');
const onenoteSearchInput = document.getElementById('onenote-search');
const onenoteStatus = document.getElementById('onenote-status');

// --- Engine Manager Elements ---
const engineSettingsBtn = document.getElementById('engine-settings-btn');
const engineModal = document.getElementById('engine-modal');
const closeEngineBtn = document.getElementById('close-engine-btn');
const addEngineBtn = document.getElementById('add-engine-btn');
const engineList = document.getElementById('engine-list');
const enableParallelCheck = document.getElementById('enable-parallel');

let groupsState = [];
let activeSelection = null; // { sectionId, subsectionId }
let autosaveTimeout;
let automationState = {
  sectionGroups: [],
  history: [],
  nextBatchNumber: 1,
  activeGeminiChatUrl: null,
  completedPromptLabels: [],
  engineProfiles: []
};
let pendingStateSave;
let drawerOpen = true;

// --- OneNote Explorer State ---
let oneNoteHistory = []; // Array of { id, name, type }
let currentOneNoteParent = null; // { id, name, type }
let oneNoteSearchQuery = '';

// Initialize control buttons in a safe idle state
setStageControlState('chatgpt', 'idle');
setStageControlState('gemini', 'idle');

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function renderSections() {
  if (!sectionList) return;
  sectionList.innerHTML = '';

  if (!groupsState || groupsState.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No content yet. Add a group to start.';
    sectionList.appendChild(empty);
    return;
  }

  groupsState.forEach(group => {
    const groupBlock = document.createElement('div');
    groupBlock.className = 'group-block';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.innerHTML = `
      <div class="group-meta">
        <span class="group-icon"><i data-lucide="folder"></i></span>
        <h3 class="group-title">${group.name}</h3>
      </div>
      <div class="group-actions">
        <button class="ghost mini add-section-btn" title="Add Section">+ Section</button>
        <button class="ghost mini delete-group-btn" title="Delete Group"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    groupHeader.querySelector('.add-section-btn').addEventListener('click', () => {
      const name = prompt('Enter section name:');
      if (name) addSection(group.id, name);
    });

    groupHeader.querySelector('.delete-group-btn').addEventListener('click', () => {
      if (confirm(`Delete group "${group.name}" and all its contents?`)) {
        deleteGroup(group.id);
      }
    });

    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'sections-container';

    group.sections.forEach(section => {
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
      sectionsContainer.appendChild(block);
    });

    groupBlock.appendChild(groupHeader);
    groupBlock.appendChild(sectionsContainer);
    sectionList.appendChild(groupBlock);
  });

  if (window.lucide) window.lucide.createIcons();
}

function addGroup(name) {
  groupsState.push({
    id: createId('group'),
    name: name,
    sections: []
  });
  renderSections();
  queueStateSave();
}

function deleteGroup(groupId) {
  groupsState = groupsState.filter(g => g.id !== groupId);
  // Clear selection if it was in the deleted group
  const selection = getActiveSubsection();
  if (selection && selection.groupId === groupId) {
    activeSelection = null;
    updateEditorState();
  }
  renderSections();
  queueStateSave();
}

function addSection(groupId, name) {
  const group = groupsState.find(g => g.id === groupId);
  if (!group) return;
  group.sections.push({
    id: createId('section'),
    name: name,
    collapsed: false,
    subsections: []
  });
  renderSections();
  queueStateSave();
}

function deleteSection(sectionId) {
  groupsState.forEach(g => {
    g.sections = g.sections.filter(s => s.id !== sectionId);
  });
  if (activeSelection && activeSelection.sectionId === sectionId) {
    activeSelection = null;
    updateEditorState();
  }
  renderSections();
  queueStateSave();
}

function deleteSubsection(sectionId, subsectionId) {
  let section = null;
  groupsState.forEach(g => {
    const found = g.sections.find(s => s.id === sectionId);
    if (found) section = found;
  });
  if (!section) return;

  section.subsections = section.subsections.filter(sub => sub.id !== subsectionId);
  if (activeSelection && activeSelection.subsectionId === subsectionId) {
    activeSelection = null;
    updateEditorState();
  }
  renderSections();
  queueStateSave();
}

function addSubsection(sectionId, name) {
  let section = null;
  for (const group of groupsState) {
    const found = group.sections.find(sec => sec.id === sectionId);
    if (found) {
      section = found;
      break;
    }
  }
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
  for (const group of groupsState) {
    const section = group.sections.find(sec => sec.id === activeSelection.sectionId);
    if (section) {
      const subsection = section.subsections.find(sub => sub.id === activeSelection.subsectionId);
      if (subsection) {
        return { group, section, subsection, groupId: group.id };
      }
    }
  }
  return null;
}

function updateEditorState() {
  const selection = getActiveSubsection();
  if (!selection) {
    editorBreadcrumb.textContent = 'No script selected';
    editorTitle.textContent = 'Select a script to edit';
    scriptInput.value = '';
    autosaveIndicator.textContent = 'Waiting for input...';
    return;
  }

  editorBreadcrumb.textContent = `${selection.group.name} > ${selection.section.name}`;
  editorTitle.textContent = selection.subsection.name;
  scriptInput.value = selection.subsection.script || '';
  autosaveIndicator.textContent = 'Loaded';
}

function handleRunSection(sectionId) {
  let section = null;
  for (const group of groupsState) {
    const found = group.sections.find(sec => sec.id === sectionId);
    if (found) {
      section = found;
      break;
    }
  }
  if (!section) return;
  appendDesignerLog(`▶️ Running section "${section.name}" with ${section.subsections.length} subsections.`);
}

function appendDesignerLog(message) {
  console.log(message);
}

function queueStateSave() {
  if (!window.electronAPI?.updateAutomationState) return;
  clearTimeout(autosaveTimeout);
  autosaveTimeout = setTimeout(() => {
    window.electronAPI.updateAutomationState({
      sectionGroups: groupsState,
      history: automationState.history,
      nextBatchNumber: automationState.nextBatchNumber
    });
    autosaveIndicator.textContent = 'Saved';
  }, 1000);
}

function applyAutomationState(state) {
  if (!state) return;

  // Preserve collapsed states
  const collapsedMap = new Map();
  groupsState.forEach(group => {
    group.sections.forEach(section => {
      collapsedMap.set(section.id, !!section.collapsed);
    });
  });

  automationState = {
    ...state,
    sectionGroups: Array.isArray(state.sectionGroups) ? state.sectionGroups.map(group => ({
      ...group,
      sections: Array.isArray(group.sections) ? group.sections.map(section => ({
        ...section,
        collapsed: collapsedMap.has(section.id) ? collapsedMap.get(section.id) : !!section.collapsed,
        subsections: Array.isArray(section.subsections) ? section.subsections.map(sub => ({ ...sub })) : []
      })) : []
    })) : getDefaultState().sectionGroups,
    history: Array.isArray(state.history) ? state.history : [],
    nextBatchNumber: state.nextBatchNumber || 1
  };

  groupsState = automationState.sectionGroups;
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

async function triggerAutomation(stage, options = {}) {
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
    const result = await window.electronAPI.runAutomation(stage, options);

    // Handle ChatGPT batch completion
    if (stage === 'chatgpt' && result && result.completed) {
      appendAutomationLog('🎉 ChatGPT batch completed successfully!');
      appendAutomationLog(`📊 Processed ${result.scriptsProcessed || 'unknown'} scripts`);
      showChatExtraction();
    } else if (stage === 'chatgpt') {
      appendAutomationLog('⚠️ ChatGPT batch completed but result state unclear');
    }
  } catch (error) {
    if (error.message && error.message.includes('BROWSER_MISSING')) {
      appendAutomationLog('❌ Browser engines are missing! This happens when running the app for the first time.', Date.now(), true);

      const repairId = `repair-${Date.now()}`;
      appendAutomationLog(`🛠️ <button id="${repairId}" class="primary mini" style="padding: 4px 12px; font-size: 11px; margin-top: 8px;">Repair & Install Browsers Now</button>`, Date.now(), false);

      setTimeout(() => {
        const btn = document.getElementById(repairId);
        if (btn) {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Installing...';
            try {
              const result = await window.electronAPI.repairBrowsers();
              if (result.success) {
                appendAutomationLog('✅ Repair successful! You can now start the automation.');
                btn.textContent = 'Fixed!';
              } else {
                appendAutomationLog(`❌ Repair failed: ${result.error}`, Date.now(), true);
                btn.textContent = 'Retry Repair';
                btn.disabled = false;
              }
            } catch (err) {
              appendAutomationLog(`❌ Repair error: ${err.message}`, Date.now(), true);
              btn.textContent = 'Error';
            }
          });
        }
      }, 100);
    } else {
      appendAutomationLog(error.message || 'Automation failed', Date.now(), true);
    }

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
  if (!responsesModal) return;

  // New UI elements
  const responsesCardList = document.getElementById('responses-card-list');
  const responsesStatus = document.getElementById('responses-status');
  const responsesStats = document.getElementById('responses-stats');

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

  // Parse all prompts from history
  let allParsedPrompts = [];
  latestHistory.forEach((entry, historyIndex) => {
    if (entry.response) {
      const extracted = extractPromptsFromResponse(entry.response);
      extracted.forEach((pText, pIndex) => {
        allParsedPrompts.push({
          id: `hist-${historyIndex}-${pIndex}`,
          text: pText,
          originalText: pText,
          sourceScript: entry.script || 'Unknown Script',
          historyIndex: historyIndex,
          promptIndex: pIndex
        });
      });
    }
  });

  // Render cards
  if (responsesCardList) {
    responsesCardList.innerHTML = '';

    if (allParsedPrompts.length === 0) {
      responsesCardList.innerHTML = '<p class="empty-state">No parsed prompts found in history.</p>';
      if (responsesStats) responsesStats.textContent = '0 prompts found';
    } else {
      allParsedPrompts.forEach((promptItem) => {
        const card = document.createElement('div');
        card.className = 'prompt-card';

        const header = document.createElement('div');
        header.className = 'card-header';

        // Attempt to extract prompt number
        const match = promptItem.text.match(/^(\d+\.\d+)/);
        const titleText = match ? `Prompt ${match[1]}` : `Prompt`;

        const historyEntry = automationState.history[promptItem.historyIndex];
        const isExcluded = historyEntry.excludedIndices && historyEntry.excludedIndices.includes(promptItem.promptIndex);

        if (isExcluded) {
          card.classList.add('inactive');
        }

        header.innerHTML = `
          <div class="card-title">
            <i data-lucide="message-square"></i>
            <span>${titleText}</span>
            <span style="font-size: 11px; color: var(--text-muted); margin-left: 8px;">(${promptItem.sourceScript})</span>
          </div>
          <div class="card-actions">
             <button class="toggle-card-btn ${isExcluded ? 'off' : 'active'}" title="${isExcluded ? 'Include in Gemini generation' : 'Skip in Gemini generation'}">
              <i data-lucide="${isExcluded ? 'eye-off' : 'eye'}"></i>
            </button>
             <button class="delete-card-btn" title="Permanently delete from history">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        `;

        const textarea = document.createElement('textarea');
        textarea.className = 'card-textarea';
        textarea.value = promptItem.text;
        textarea.readOnly = true;

        card.appendChild(header);
        card.appendChild(textarea);

        // Toggle Skip handler
        const toggleBtn = header.querySelector('.toggle-card-btn');
        toggleBtn.addEventListener('click', async () => {
          try {
            const entry = automationState.history[promptItem.historyIndex];
            if (!entry) return;

            if (!entry.excludedIndices) entry.excludedIndices = [];

            const idx = entry.excludedIndices.indexOf(promptItem.promptIndex);
            if (idx > -1) {
              entry.excludedIndices.splice(idx, 1);
              appendAutomationLog(`👁️ Included prompt ${titleText} from script: ${promptItem.sourceScript}`);
            } else {
              entry.excludedIndices.push(promptItem.promptIndex);
              appendAutomationLog(`🙈 Skipped prompt ${titleText} from script: ${promptItem.sourceScript}`);
            }

            // Save state
            await window.electronAPI.updateAutomationState(automationState);

            // Re-render
            showResponsesModal();
          } catch (err) {
            console.error('Failed to toggle prompt:', err);
            appendAutomationLog(`❌ Error toggling prompt: ${err.message}`, Date.now(), true);
          }
        });

        // Delete handler (Persistent)
        const deleteBtn = header.querySelector('.delete-card-btn');
        deleteBtn.addEventListener('click', async () => {
          if (!confirm('Are you sure you want to delete this prompt from history?')) return;

          try {
            const entry = automationState.history[promptItem.historyIndex];
            if (!entry) return;

            // Extract all prompts from this entry
            const currentPrompts = extractPromptsFromResponse(entry.response);

            // Remove the target prompt
            currentPrompts.splice(promptItem.promptIndex, 1);

            if (currentPrompts.length === 0) {
              // If no prompts left, remove the entire history entry
              automationState.history.splice(promptItem.historyIndex, 1);
            } else {
              // Re-build the response text with remaining prompts in a clean format
              entry.response = currentPrompts.map(p => `\`\`\`markdown\n${p.trim()}\n\`\`\``).join('\n\n');
            }

            // Save updated state to backend
            await window.electronAPI.updateAutomationState(automationState);
            appendAutomationLog(`🗑️ Deleted prompt from script: ${promptItem.sourceScript}`);

            // Re-render modal to reflect the new state
            showResponsesModal();
          } catch (err) {
            console.error('Failed to delete prompt:', err);
            appendAutomationLog(`❌ Error deleting prompt: ${err.message}`, Date.now(), true);
          }
        });

        responsesCardList.appendChild(card);

        // Adjust height
        requestAnimationFrame(() => {
          textarea.style.height = 'auto';
          textarea.style.height = (textarea.scrollHeight + 2) + 'px';
        });
      });

      if (responsesStats) responsesStats.textContent = `${allParsedPrompts.length} prompts found`;
    }
  }

  if (responsesStatus) responsesStatus.textContent = 'Ready';
  responsesModal.style.display = 'flex';
  appendAutomationLog('👁️ Viewing ChatGPT responses (Parsed View)');

  if (window.lucide) window.lucide.createIcons();
}

function hideResponsesModal() {
  if (!responsesModal) return;
  responsesModal.style.display = 'none';
}

function downloadResponses() {
  if (!automationState.history || automationState.history.length === 0) {
    alert('No responses to download');
    return;
  }

  let content = '# ChatGPT Responses\n\n';
  automationState.history.forEach((entry, i) => {
    content += `## ${i + 1}. ${entry.script}\n\n${entry.response}\n\n`;
  });

  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt-responses-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (responsesStatus) {
    responsesStatus.textContent = 'Downloaded';
    setTimeout(() => (responsesStatus.textContent = 'Ready'), 1500);
  }
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

  automationState.activeGeminiChatUrl = null;
  automationState.completedPromptLabels = [];

  await window.electronAPI.updateAutomationState({
    sections: automationState.sections,
    history: automationState.history,
    nextBatchNumber: automationState.nextBatchNumber,
    activeGeminiChatUrl: null,
    completedPromptLabels: []
  });

  const responsesCardList = document.getElementById('responses-card-list');
  const responsesStats = document.getElementById('responses-stats');
  const responsesStatus = document.getElementById('responses-status');

  if (responsesCardList) {
    responsesCardList.innerHTML = '<p class="empty-state">No parsed prompts found in history.</p>';
  }
  if (responsesStats) {
    responsesStats.textContent = '0 prompts found';
  }
  if (responsesStatus) {
    responsesStatus.textContent = 'Cleared';
  }

  appendAutomationLog('🧹 Cleared saved ChatGPT responses');
}


function openExtractionPanel() {
  showChatExtraction();
  setExtractionStatus('idle', 'Ready');
}

function getFlattenedScripts() {
  const scripts = [];

  groupsState.forEach(group => {
    group.sections.forEach((section, sectionIndex) => {
      section.subsections.forEach((subsection, subsectionIndex) => {
        if (subsection.script && subsection.script.trim().length > 0) {
          scripts.push({
            scriptName: subsection.name,
            script: subsection.script,
            sectionName: section.name,
            groupName: group.name,
            subsectionName: subsection.name,
            sectionIndex: sectionIndex,
            subsectionIndex: subsectionIndex,
            batchNumber: scripts.length + 1
          });
        }
      });
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

    // Only extract prompts that start with X.Y (script numbering)
    if (/^\d+\.\d+\s/.test(block)) {
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
    addGroup(name);
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

  // Highlighting verification and completion
  if (message.includes('✅ All prompts verified')) {
    line.style.color = '#10b981'; // Success Green
    line.style.fontWeight = 'bold';
  } else if (message.includes('⚠️ Verification Alert')) {
    line.style.color = '#f59e0b'; // Warning Amber
    line.style.fontWeight = 'bold';
  } else if (message.includes('🎯 Found') && message.includes('Skipped')) {
    line.style.color = '#3b82f6'; // Info Blue
    line.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
    line.style.padding = '4px 8px';
    line.style.borderRadius = '4px';
    line.style.margin = '4px 0';
  }

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
  window.electronAPI.onDownloadComplete((data) => {
    setRunning(false);
    if (!statusPill) return;

    if (data && data.success) {
      statusPill.textContent = 'Finished';
      statusPill.className = 'status-pill success'; // Ensure class naming consistency
    } else {
      statusPill.textContent = 'Failed';
      statusPill.className = 'status-pill error';
    }
  });
}

// --- Aspect Ratio Selector Logic ---
let selectedAspectRatio = '--ar 1:1'; // Default

const ratioButtons = document.querySelectorAll('.ratio-btn');
ratioButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Update UI
    ratioButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update state
    selectedAspectRatio = btn.dataset.ratio;
    appendAutomationLog(`📐 Aspect ratio set to: ${selectedAspectRatio === '1:1' ? 'Square (1:1)' : selectedAspectRatio}`);
  });
});

if (runChatgptBtn) {
  runChatgptBtn.addEventListener('click', () => triggerAutomation('chatgpt'));
}

if (runGeminiBtn) {
  runGeminiBtn.addEventListener('click', () => {
    const enableParallel = document.getElementById('enable-parallel-cb')?.checked || false;
    triggerAutomation('gemini', {
      aspectRatio: selectedAspectRatio,
      enableParallel: enableParallel
    });
  });
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
// --- Prompt Review Modal & Card Logic ---

const promptReviewModal = document.getElementById('prompt-review-modal');
const promptCardList = document.getElementById('prompt-card-list');
const closeReviewBtn = document.getElementById('close-review-btn');
const savePromptsBtn = document.getElementById('save-prompts-btn');
const deleteAllPromptsBtn = document.getElementById('delete-all-prompts-btn');
const reviewStatus = document.getElementById('review-status');
const reviewStats = document.getElementById('review-stats');

let currentReviewPrompts = []; // Array of { id, text, originalText }

if (closeReviewBtn) {
  closeReviewBtn.addEventListener('click', () => {
    promptReviewModal.style.display = 'none';
  });
}

if (extractPromptsBtn) {
  extractPromptsBtn.addEventListener('click', async () => {
    const chatUrl = chatUrlInput.value.trim();
    if (!chatUrl) {
      alert('Please enter a ChatGPT chat URL');
      return;
    }

    if (!window.electronAPI?.extractPromptsFromChat) return;

    setExtractionStatus('running', 'Extracting...');
    extractPromptsBtn.disabled = true;

    try {
      // 1. Extract raw prompts string array
      const rawPrompts = await window.electronAPI.extractPromptsFromChat(chatUrl);

      if (!rawPrompts || rawPrompts.length === 0) {
        setExtractionStatus('error', 'No prompts found');
        alert('No prompts were found in that chat. Please check the URL and try again.');
        extractPromptsBtn.disabled = false;
        return;
      }

      setExtractionStatus('success', `Found ${rawPrompts.length} prompts`);

      // 2. Open Review Modal instead of auto-saving
      openPromptReviewModal(rawPrompts);

    } catch (error) {
      console.error(error);
      if (error.message && error.message.includes('BROWSER_MISSING')) {
        setExtractionStatus('error', 'Browsers missing');
        appendAutomationLog('❌ Browser engines are missing! Installation is required for the first run.', Date.now(), true);

        const repairId = `repair-extract-${Date.now()}`;
        appendAutomationLog(`🛠️ <button id="${repairId}" class="primary mini" style="padding: 4px 12px; font-size: 11px; margin-top: 8px;">Install Browsers Now</button>`, Date.now(), false);

        setTimeout(() => {
          const btn = document.getElementById(repairId);
          if (btn) {
            btn.onclick = async () => {
              btn.disabled = true;
              btn.textContent = 'Installing...';
              const result = await window.electronAPI.repairBrowsers();
              if (result.success) {
                appendAutomationLog('✅ Fixed! You can now try extracting again.');
                btn.textContent = 'Fixed!';
              } else {
                btn.textContent = 'Failed';
                btn.disabled = false;
              }
            };
          }
        }, 100);
      } else {
        setExtractionStatus('error', 'Extraction failed');
        alert(`Error extracting prompts: ${error.message}`);
      }
    } finally {
      extractPromptsBtn.disabled = false;
    }
  });
}

function openPromptReviewModal(rawPrompts) {
  currentReviewPrompts = rawPrompts.map((text, index) => ({
    id: `prompt-${Date.now()}-${index}`,
    text: text,
    originalText: text
  }));

  renderPromptCards();
  updateReviewStats();

  if (promptReviewModal) {
    promptReviewModal.style.display = 'flex';
  }
}

function renderPromptCards() {
  if (!promptCardList) return;
  promptCardList.innerHTML = '';

  if (currentReviewPrompts.length === 0) {
    promptCardList.innerHTML = '<p class="empty-state">No prompts extracted.</p>';
    return;
  }

  currentReviewPrompts.forEach((promptItem, index) => {
    const card = document.createElement('div');
    card.className = 'prompt-card';
    card.dataset.id = promptItem.id;

    const header = document.createElement('div');
    header.className = 'card-header';

    // Attempt to extract prompt number for display
    const match = promptItem.text.match(/^(\d+\.\d+)/);
    const titleText = match ? `Prompt ${match[1]}` : `Prompt ${index + 1}`;

    header.innerHTML = `
      <div class="card-title">
        <i data-lucide="hash"></i>
        <span>${titleText}</span>
      </div>
      <div class="card-actions">
        <button class="delete-card-btn" title="Delete prompt">
          <i data-lucide="x"></i>
        </button>
      </div>
    `;

    const textarea = document.createElement('textarea');
    textarea.className = 'card-textarea';
    textarea.value = promptItem.text;
    textarea.addEventListener('input', (e) => {
      promptItem.text = e.target.value; // Live update state
      adjustTextareaHeight(textarea);
    });

    // Delete handler
    const deleteBtn = header.querySelector('.delete-card-btn');
    deleteBtn.addEventListener('click', () => {
      card.classList.add('deleted');
      setTimeout(() => {
        currentReviewPrompts = currentReviewPrompts.filter(p => p.id !== promptItem.id);
        renderPromptCards(); // Re-render to update indices if needed
        updateReviewStats();
      }, 200);
    });

    card.appendChild(header);
    card.appendChild(textarea);
    promptCardList.appendChild(card);

    // Adjust height initially
    requestAnimationFrame(() => adjustTextareaHeight(textarea));
  });

  if (window.lucide) window.lucide.createIcons();
}

function adjustTextareaHeight(el) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}

function updateReviewStats() {
  if (reviewStats) {
    reviewStats.textContent = `${currentReviewPrompts.length} prompts selected`;
  }
}

if (deleteAllPromptsBtn) {
  deleteAllPromptsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete ALL extracted prompts?')) {
      currentReviewPrompts = [];
      renderPromptCards();
      updateReviewStats();
    }
  });
}

if (savePromptsBtn) {
  savePromptsBtn.addEventListener('click', () => {
    // 1. Find or create "ChatGPT Imports" group
    let group = groupsState.find(g => g.name === 'ChatGPT Imports');
    if (!group) {
      addGroup('ChatGPT Imports');
      group = groupsState[groupsState.length - 1];
    }

    // 2. Create a new section
    const sectionName = `Imported Batch ${new Date().toLocaleTimeString()}`;
    addSection(group.id, sectionName);

    // Get the newly created section
    const newSection = group.sections[group.sections.length - 1];
    if (newSection) {
      // 3. Add all prompts as subsections
      currentReviewPrompts.forEach(p => {
        const match = p.text.match(/^(\d+\.\d+)/);
        const subName = match ? `Prompt ${match[1]}` : `Script Part`;

        const subsection = {
          id: createId('sub'),
          name: subName,
          script: p.text
        };
        newSection.subsections.push(subsection);
      });

      // 4. Save and Render
      queueStateSave();
      renderSections();
      promptReviewModal.style.display = 'none';
      appendAutomationLog(`✅ Imported ${currentReviewPrompts.length} prompts to "${group.name} > ${newSection.name}"`);
    }
  });
}

// --- OneNote UI Handlers ---
if (onenoteHubBtn) {
  onenoteHubBtn.addEventListener('click', async () => {
    onenoteModal.style.display = 'flex';

    // Auto-fill and Auto-login check
    const savedClientId = localStorage.getItem('onenote_client_id');
    if (savedClientId) {
      onenoteClientIdInput.value = savedClientId;
      onenoteStatus.textContent = "Checking for existing session...";

      try {
        const res = await window.electronAPI.oneNoteCheckAuth({ clientId: savedClientId, redirectUri: 'http://localhost:3000' });
        if (res.success) {
          console.log("Auto-login successful");
          onenoteLoginView.style.display = 'none';
          onenotePagesView.style.display = 'block';
          await loadOneNoteContent();
          return;
        }
      } catch (e) {
        console.log("Auto-login failed:", e);
      }
      onenoteStatus.textContent = "Ready";
    }
  });
}

if (closeOnenoteBtn) {
  closeOnenoteBtn.addEventListener('click', () => {
    onenoteModal.style.display = 'none';
  });
}

if (onenoteLoginBtn) {
  onenoteLoginBtn.addEventListener('click', async () => {
    const clientId = onenoteClientIdInput.value.trim();
    if (!clientId) {
      alert('Please provide your Azure Client ID.');
      return;
    }

    onenoteLoginBtn.disabled = true;
    onenoteLoginBtn.textContent = 'Authenticating...';

    try {
      localStorage.setItem('onenote_client_id', clientId);
      // For now, Redirect URI is hardcoded to localhost:3000 in backend
      const res = await window.electronAPI.oneNoteLogin({ clientId, redirectUri: 'http://localhost:3000' });
      if (res.success) {
        onenoteLoginView.style.display = 'none';
        onenotePagesView.style.display = 'block';
        await loadOneNoteContent();
      } else {
        alert(`Login failed: ${res.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      onenoteLoginBtn.disabled = false;
      onenoteLoginBtn.textContent = 'Sign in with Microsoft';
    }
  });
}

async function loadOneNoteContent(parentId = null, parentType = 'root', parentName = 'Notebooks') {
  onenoteContentList.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Fetching ${parentType === 'root' ? 'notebooks' : 'content'}...</p>
    </div>
  `;
  onenoteStatus.textContent = 'Fetching content...';
  onenoteBackBtn.disabled = oneNoteHistory.length === 0;

  try {
    let res;
    if (parentType === 'root') {
      res = await window.electronAPI.oneNoteGetNotebooks();
    } else if (parentType === 'section') {
      res = await window.electronAPI.oneNoteGetPages({ sectionId: parentId });
    } else {
      res = await window.electronAPI.oneNoteGetChildren({ parentId, parentType });
    }

    if (res.success) {
      renderOneNoteExplorer(res, parentType);
      updateOneNoteBreadcrumbs();
      onenoteStatus.textContent = 'Ready';
    } else {
      onenoteContentList.innerHTML = `<p class="error-state">Error: ${res.error}</p>`;
      onenoteStatus.textContent = 'Error';
    }
  } catch (err) {
    onenoteContentList.innerHTML = `<p class="error-state">Failed: ${err.message}</p>`;
    onenoteStatus.textContent = 'Failed';
  }
}

function renderOneNoteExplorer(data, parentType) {
  onenoteContentList.innerHTML = '';
  const items = [];

  if (parentType === 'root') {
    data.notebooks?.forEach(n => items.push({ ...n, type: 'notebook', name: n.displayName || 'Untitled Notebook' }));
  } else if (parentType === 'section') {
    data.pages?.forEach(p => items.push({ ...p, type: 'page', name: p.title || 'Untitled Page' }));
  } else {
    data.sectionGroups?.forEach(sg => items.push({ ...sg, type: 'sectionGroup', name: sg.displayName || 'Untitled Group' }));
    data.sections?.forEach(s => items.push({ ...s, type: 'section', name: s.displayName || 'Untitled Section' }));
  }

  const filteredItems = items.filter(i =>
    !oneNoteSearchQuery || i.name.toLowerCase().includes(oneNoteSearchQuery.toLowerCase())
  );

  if (filteredItems.length === 0) {
    onenoteContentList.innerHTML = '<p class="empty-state">No items found.</p>';
  }

  // Add Sync Button for Containers (Notebook/SectionGroup)
  if (currentOneNoteParent && (currentOneNoteParent.type === 'notebook' || currentOneNoteParent.type === 'sectionGroup')) {
    const syncContainer = document.createElement('div');
    syncContainer.className = 'explorer-item sync-action';
    syncContainer.style.background = 'rgba(100, 200, 255, 0.1)';
    syncContainer.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
    syncContainer.innerHTML = `
        <div class="sync-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding: 0 10px;">
          <div style="display: flex; align-items: center; flex: 1;">
            <div class="icon" style="margin-right: 12px;">
              <i data-lucide="download-cloud" style="color: #64b5f6; width: 20px; height: 20px;"></i>
            </div>
            <div class="info" style="flex: 1;">
              <div class="name" style="color: #64b5f6; font-size: 1.1em; font-weight: 600; margin-bottom: 4px; display: block;">Download Complete Notebook</div>
              <div class="meta" style="color: #888; font-size: 0.85em;">Fetch entire notebook with all sections, groups, and pages in one mega-batch request</div>
            </div>
          </div>
          <div class="sync-controls">
            <button id="minimize-sync-btn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; font-weight: 500; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <i data-lucide="minus" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        </div>
      `;
    
    // Set proper container styling
    syncContainer.style.position = 'relative';
    syncContainer.style.padding = '15px';
    syncContainer.style.display = 'flex';
    syncContainer.style.flexDirection = 'column';
    syncContainer.style.gap = '15px';

    // Add progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-section';
    
    const progressBar = document.createElement('div');
    progressBar.style.width = '100%';
    progressBar.style.height = '6px';
    progressBar.style.backgroundColor = '#333';
    progressBar.style.borderRadius = '3px';
    progressBar.style.overflow = 'hidden';
    
    const progressFill = document.createElement('div');
    progressFill.id = 'onenote-progress-fill';
    progressFill.style.width = '0%';
    progressFill.style.height = '100%';
    progressFill.style.backgroundColor = '#64b5f6';
    progressFill.style.transition = 'width 0.3s ease';
    progressFill.style.borderRadius = '3px';
    
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);
    
    // Add progress text
    const progressText = document.createElement('div');
    progressText.id = 'onenote-progress-text';
    progressText.style.fontSize = '0.8em';
    progressText.style.color = '#888';
    progressText.style.marginTop = '5px';
    progressText.textContent = 'Ready to sync';
    
    progressContainer.appendChild(progressText);
    
    // Add scrollable log area - SEPARATE and CLEAN
    const logContainer = document.createElement('div');
    logContainer.className = 'log-section';
    logContainer.style.borderTop = '2px solid rgba(100, 200, 255, 0.2)';
    logContainer.style.paddingTop = '15px';
    logContainer.style.marginTop = '10px';
    
    const logHeader = document.createElement('div');
    logHeader.style.display = 'flex';
    logHeader.style.justifyContent = 'space-between';
    logHeader.style.alignItems = 'center';
    logHeader.style.marginBottom = '10px';
    
    const logTitle = document.createElement('div');
    logTitle.style.fontSize = '1em';
    logTitle.style.fontWeight = 'bold';
    logTitle.style.color = '#64b5f6';
    logTitle.textContent = '📋 Sync Progress Log';
    
    const clearLogBtn = document.createElement('button');
    clearLogBtn.style.background = '#ff4444';
    clearLogBtn.style.border = 'none';
    clearLogBtn.style.color = 'white';
    clearLogBtn.style.padding = '6px 12px';
    clearLogBtn.style.borderRadius = '4px';
    clearLogBtn.style.fontSize = '0.8em';
    clearLogBtn.style.cursor = 'pointer';
    clearLogBtn.textContent = 'Clear Log';
    
    clearLogBtn.addEventListener('click', () => {
      const logArea = document.getElementById('onenote-sync-log');
      if (logArea) {
        logArea.textContent = '';
        logArea.scrollTop = 0;
      }
    });
    
    logHeader.appendChild(logTitle);
    logHeader.appendChild(clearLogBtn);
    logContainer.appendChild(logHeader);
    
    const logArea = document.createElement('div');
    logArea.id = 'onenote-sync-log';
    logArea.style.height = '200px';
    logArea.style.overflowY = 'auto';
    logArea.style.backgroundColor = '#0a0a0a';
    logArea.style.border = '1px solid #333';
    logArea.style.borderRadius = '8px';
    logArea.style.padding = '15px';
    logArea.style.fontSize = '0.85em';
    logArea.style.color = '#e0e0e0';
    logArea.style.fontFamily = 'Consolas, "Courier New", monospace';
    logArea.style.whiteSpace = 'pre-wrap';
    logArea.style.lineHeight = '1.5';
    logArea.style.marginBottom = '5px';
    logArea.textContent = 'Ready to start sync...';
    
    logContainer.appendChild(logArea);
    
    syncContainer.appendChild(progressContainer);
    syncContainer.appendChild(logContainer);
    
    // Add minimize functionality
    const minimizeBtn = syncContainer.querySelector('#minimize-sync-btn');
    let isMinimized = false;
    
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isMinimized = !isMinimized;
        
        if (isMinimized) {
          // Minimize: hide progress and log, show minimal status
          progressContainer.style.display = 'none';
          logContainer.style.display = 'none';
          syncContainer.querySelector('.sync-header').style.marginBottom = '0';
          
          // Create minimized status
          const minimizedStatus = document.createElement('div');
          minimizedStatus.id = 'minimized-status';
          minimizedStatus.style.padding = '15px';
          minimizedStatus.style.fontSize = '0.9em';
          minimizedStatus.style.background = 'rgba(100, 200, 255, 0.1)';
          minimizedStatus.style.borderRadius = '8px';
          minimizedStatus.innerHTML = `
            <div style="color: #64b5f6; font-weight: 500; margin-bottom: 5px;">
              <i data-lucide="download" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 8px;"></i>
              Downloading Notebook...
            </div>
            <div id="minimized-progress" style="color: #888; font-size: 0.8em;">
              Preparing mega-batch request...
            </div>
          `;
          syncContainer.appendChild(minimizedStatus);
          
          minimizeBtn.innerHTML = '<i data-lucide="maximize2" style="width: 14px; height: 14px;"></i>';
        } else {
          // Restore
          progressContainer.style.display = 'block';
          logContainer.style.display = 'block';
          syncContainer.querySelector('.sync-header').style.marginBottom = '15px';
          
          const minimizedStatus = syncContainer.querySelector('#minimized-status');
          if (minimizedStatus) minimizedStatus.remove();
          
          minimizeBtn.innerHTML = '<i data-lucide="minus" style="width: 14px; height: 14px;"></i>';
        }
        
        if (window.lucide) window.lucide.createIcons();
      });
    }
    syncContainer.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Import entire notebook "${currentOneNoteParent.name}" with all sections and pages? This will fetch the complete hierarchy at once.`)) {
        onenoteStatus.textContent = "Starting complete notebook sync...";
        syncContainer.style.opacity = '0.5';
        syncContainer.style.pointerEvents = 'none';
        
        // Show progress elements
        const progressFill = document.getElementById('onenote-progress-fill');
        const progressText = document.getElementById('onenote-progress-text');
        const logArea = document.getElementById('onenote-sync-log');
        if (progressFill) progressFill.style.width = '0%';
        if (progressText) progressText.textContent = 'Initializing complete sync...';
        if (logArea) logArea.textContent = '';

        try {
          // Use complete notebook sync instead of hierarchical sync
          const res = await window.electronAPI.oneNoteSyncCompleteNotebook({
            notebookId: currentOneNoteParent.id,
            notebookName: currentOneNoteParent.name
          });

          if (res.success) {
            if (progressText) progressText.textContent = 'Complete notebook sync finished successfully!';
            if (progressFill) progressFill.style.width = '100%';
            appendAutomationLog(`✅ Successfully imported complete notebook "${currentOneNoteParent.name}"!`);
            if (res.progress) {
              appendAutomationLog(`📊 Sync Summary: ${res.progress.processedSections}/${res.progress.totalSections} sections, ${res.progress.processedPages}/${res.progress.totalPages} pages, ${res.progress.totalSectionGroups} section groups`);
              if (res.progress.errors.length > 0) {
                appendAutomationLog(`⚠️ ${res.progress.errors.length} errors occurred during sync`);
                res.progress.errors.forEach(error => appendAutomationLog(`   ${error}`));
              }
            }
            await hydrateAutomationState(); // Refresh sidebar
          } else {
            if (progressText) progressText.textContent = 'Complete notebook sync failed!';
            if (progressFill) progressFill.style.width = '0%';
            appendAutomationLog(`❌ Import failed: ${res.error}`, Date.now(), true);
            alert("Import failed: " + res.error);
          }
        } catch (err) {
          if (progressText) progressText.textContent = 'Complete notebook sync error!';
          if (progressFill) progressFill.style.width = '0%';
          appendAutomationLog(`❌ Sync error: ${err.message}`, Date.now(), true);
          alert("Sync error: " + err.message);
        }
        onenoteStatus.textContent = "Ready";
        syncContainer.style.opacity = '1';
        syncContainer.style.pointerEvents = 'all';
      }
    });
    onenoteContentList.prepend(syncContainer);
  }

  if (filteredItems.length === 0) return;

  filteredItems.forEach(item => {
    const el = document.createElement('div');
    el.className = `explorer-item ${item.type}`;

    let icon = 'folder';
    if (item.type === 'notebook') icon = 'book';
    if (item.type === 'sectionGroup') icon = 'library';
    if (item.type === 'section') icon = 'file-text';
    if (item.type === 'page') icon = 'file';

    el.innerHTML = `
      <div class="icon"><i data-lucide="${icon}"></i></div>
      <div class="info">
        <span class="name">${item.name}</span>
        <span class="meta">${item.type.replace(/([A-Z])/g, ' $1')}</span>
      </div>
    `;

    el.addEventListener('click', () => {
      if (item.type === 'page') {
        syncOneNotePage(item.id);
      } else {
        oneNoteHistory.push(currentOneNoteParent || { id: null, type: 'root', name: 'Notebooks' });
        currentOneNoteParent = { id: item.id, type: item.type, name: item.name };
        loadOneNoteContent(item.id, item.type, item.name);
      }
    });

    onenoteContentList.appendChild(el);
  });

  if (window.lucide) window.lucide.createIcons();
}

function updateOneNoteBreadcrumbs() {
  onenoteBreadcrumbs.innerHTML = '';

  const root = document.createElement('span');
  root.className = 'breadcrumb-item clickable';
  root.textContent = 'Notebooks';
  root.addEventListener('click', () => {
    oneNoteHistory = [];
    currentOneNoteParent = null;
    loadOneNoteContent();
  });
  onenoteBreadcrumbs.appendChild(root);

  if (currentOneNoteParent && currentOneNoteParent.type !== 'root') {
    const item = document.createElement('span');
    item.className = 'breadcrumb-item active';
    item.textContent = currentOneNoteParent.name;
    onenoteBreadcrumbs.appendChild(item);
  }
}

async function syncOneNotePage(pageId) {
  onenoteStatus.textContent = 'Syncing...';
  const res = await window.electronAPI.oneNoteSyncPage({ pageId });
  if (res.success) {
    appendAutomationLog(`✅ Synced OneNote page into new section.`);
    onenoteModal.style.display = 'none';
    await hydrateAutomationState();
  } else {
    alert(`Sync failed: ${res.error}`);
    onenoteStatus.textContent = 'Sync failed';
  }
}

if (onenoteBackBtn) {
  onenoteBackBtn.addEventListener('click', () => {
    const last = oneNoteHistory.pop();
    if (last) {
      currentOneNoteParent = last.id ? last : null;
      loadOneNoteContent(last.id, last.type, last.name);
    }
  });
}

if (onenoteSearchInput) {
  onenoteSearchInput.addEventListener('input', (e) => {
    oneNoteSearchQuery = e.target.value;
    // We already have the data, so just re-render
    // But we need to keep the data... for now let's just re-fetch
    // Or we could store the last result. For simplicity, let's just re-fetch
    // loadOneNoteContent(currentOneNoteParent?.id, currentOneNoteParent?.type, currentOneNoteParent?.name);
  });
}

if (onenoteRefreshBtn) {
  onenoteRefreshBtn.addEventListener('click', () => {
    loadOneNoteContent(currentOneNoteParent?.id, currentOneNoteParent?.type, currentOneNoteParent?.name);
  });
}

// --- Engine Manager UI Handlers ---
if (engineSettingsBtn) {
  engineSettingsBtn.addEventListener('click', () => {
    engineModal.style.display = 'flex';
    renderEngineList();
  });
}

if (closeEngineBtn) {
  closeEngineBtn.addEventListener('click', () => {
    engineModal.style.display = 'none';
  });
}

function renderEngineList() {
  if (!engineList) return;
  engineList.innerHTML = '';

  const profiles = automationState.engineProfiles || [];
  if (profiles.length === 0) {
    engineList.innerHTML = '<p class="empty-state">No engines configured. Add one below.</p>';
    return;
  }

  profiles.forEach(p => {
    const item = document.createElement('div');
    item.className = `engine-item ${p.active ? 'active' : ''}`;
    item.innerHTML = `
      <div class="engine-info">
        <span class="engine-name">${p.name}</span>
        <span class="engine-status">${p.active ? 'Ready for parallelization' : 'Disabled'}</span>
      </div>
      <div class="engine-actions">
        <button class="ghost toggle-engine-btn">${p.active ? 'Disable' : 'Enable'}</button>
        <button class="ghost danger delete-engine-btn">✕</button>
      </div>
    `;

    item.querySelector('.toggle-engine-btn').addEventListener('click', () => toggleEngine(p.id));
    item.querySelector('.delete-engine-btn').addEventListener('click', () => deleteEngine(p.id));
    engineList.appendChild(item);
  });
}

async function toggleEngine(id) {
  const profile = automationState.engineProfiles.find(p => p.id === id);
  if (profile) {
    profile.active = !profile.active;
    await queueStateSave();
    renderEngineList();
  }
}

async function deleteEngine(id) {
  const profiles = automationState.engineProfiles || [];
  if (profiles.length <= 1) {
    alert('At least one engine profile is required.');
    return;
  }
  automationState.engineProfiles = profiles.filter(p => p.id !== id);
  await queueStateSave();
  renderEngineList();
}

if (addEngineBtn) {
  addEngineBtn.addEventListener('click', async () => {
    const name = prompt('Enter a label for this Gemini account:', `Gemini Account ${automationState.engineProfiles.length + 1}`);
    if (name) {
      automationState.engineProfiles.push({
        id: createId('p'),
        name: name,
        active: true,
        chatUrl: null,
        completed: []
      });
      await queueStateSave();
      renderEngineList();
    }
  });
}

// --- OneNote Sync Progress Listener ---
if (window.electronAPI?.onOneNoteSyncProgress) {
  window.electronAPI.onOneNoteSyncProgress((progress) => {
    // Update status text
    if (onenoteStatus) {
      onenoteStatus.textContent = progress.message || 'Syncing...';
    }
    
    // Update progress bar and text
    const progressFill = document.getElementById('onenote-progress-fill');
    const progressText = document.getElementById('onenote-progress-text');
    const logArea = document.getElementById('onenote-sync-log');
    const minimizedProgress = document.getElementById('minimized-progress');
    
    // Calculate overall progress
    let overallProgress = 0;
    if (progress.totalPages > 0 || progress.totalSections > 0) {
      const pageProgress = progress.totalPages > 0 ? (progress.processedPages / progress.totalPages) : 0;
      const sectionProgress = progress.totalSections > 0 ? (progress.processedSections / progress.totalSections) : 0;
      const sectionGroupProgress = progress.totalSectionGroups > 0 ? (progress.processedSectionGroups / progress.totalSectionGroups) : 0;
      overallProgress = Math.round(((pageProgress + sectionProgress + sectionGroupProgress) / 3) * 100);
    }
    
    if (progressFill) {
      progressFill.style.width = `${Math.max(0, Math.min(100, overallProgress))}%`;
    }
    
    if (progressText) {
      if (progress.status === 'completed') {
        progressText.textContent = `✅ Complete! ${progress.processedSections}/${progress.totalSections} sections, ${progress.processedPages}/${progress.totalPages} pages`;
      } else if (progress.status === 'error') {
        progressText.textContent = '❌ Sync failed';
      } else {
        progressText.textContent = `${overallProgress}% - ${progress.currentSection || progress.currentSectionGroup || 'Initializing...'}`;
      }
    }
    
    // Update minimized status if visible
    if (minimizedProgress) {
      if (progress.status === 'completed') {
        minimizedProgress.textContent = `✅ Complete! ${overallProgress}%`;
      } else if (progress.status === 'error') {
        minimizedProgress.textContent = '❌ Failed';
      } else {
        minimizedProgress.textContent = `${overallProgress}% - ${progress.currentSection || progress.currentSectionGroup || 'Processing...'}`;
      }
    }
    
    // Add to scrollable log
    if (logArea && progress.message) {
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = `[${timestamp}] ${progress.message}\n`;
      logArea.textContent += logEntry;
      logArea.scrollTop = logArea.scrollHeight;
      
      // Limit log size to prevent memory issues
      const lines = logArea.textContent.split('\n');
      if (lines.length > 500) {
        logArea.textContent = lines.slice(-400).join('\n');
      }
    }
    
    // Also log to automation log for history
    appendAutomationLog(`🔄 OneNote Sync: ${progress.message}`);
    
    // Show progress percentages if available
    if (progress.totalPages > 0) {
      const pageProgress = Math.round((progress.processedPages / progress.totalPages) * 100);
      const sectionProgress = Math.round((progress.processedSections / progress.totalSections) * 100);
      appendAutomationLog(`📈 Progress: ${sectionProgress}% sections, ${pageProgress}% pages`);
    }
    
    // Handle completion
    if (progress.status === 'completed') {
      appendAutomationLog(`🎉 OneNote sync completed successfully!`);
      appendAutomationLog(`💾 Data saved to local onenote-data directory`);
    } else if (progress.status === 'error') {
      appendAutomationLog(`❌ OneNote sync error: ${progress.message}`, Date.now(), true);
    }
  });
}
