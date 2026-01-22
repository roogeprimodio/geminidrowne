const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const STATE_FILENAME = 'automation-state.json';

function getStatePath() {
  const userData = app.getPath('userData');
  return path.join(userData, STATE_FILENAME);
}

function getDefaultState() {
  return {
    sectionGroups: [
      {
        id: 'group-default',
        name: 'Default Account',
        sections: []
      }
    ],
    history: [],
    nextBatchNumber: 1,
    activeGeminiChatUrl: null,
    completedPromptLabels: [],
    engineProfiles: [
      { id: 'p1', name: 'Gemini Account 1', active: true, chatUrl: null, completed: [] }
    ]
  };
}

function loadAutomationState() {
  const filePath = getStatePath();
  try {
    const data = fs.readJsonSync(filePath);

    // Migration logic for old 'sections' structure
    if (data.sections && !data.sectionGroups) {
      data.sectionGroups = [
        {
          id: 'group-migrated',
          name: 'Migrated Section Store',
          sections: data.sections
        }
      ];
      delete data.sections;
    }

    // Ensure core fields exist
    if (!data.sectionGroups || !Array.isArray(data.sectionGroups)) {
      data.sectionGroups = getDefaultState().sectionGroups;
    }

    if (!data.nextBatchNumber || data.nextBatchNumber < 1) {
      data.nextBatchNumber = 1;
    }
    if (!Array.isArray(data.history)) {
      data.history = [];
    }
    return data;
  } catch (error) {
    const defaults = getDefaultState();
    fs.outputJsonSync(filePath, defaults, { spaces: 2 });
    return defaults;
  }
}

function saveAutomationState(state) {
  const filePath = getStatePath();
  fs.outputJsonSync(filePath, state, { spaces: 2 });
}

module.exports = {
  loadAutomationState,
  saveAutomationState,
  getDefaultState
};
