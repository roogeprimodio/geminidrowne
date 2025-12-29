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
    sections: [],
    history: [],
    nextBatchNumber: 1
  };
}

function loadAutomationState() {
  const filePath = getStatePath();
  try {
    const data = fs.readJsonSync(filePath);
    if (!data.nextBatchNumber || data.nextBatchNumber < 1) {
      data.nextBatchNumber = 1;
    }
    if (!Array.isArray(data.history)) {
      data.history = [];
    }
    if (!Array.isArray(data.sections)) {
      data.sections = [];
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
