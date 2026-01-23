const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

// Configuration
const CHATGPT_URL = 'https://chatgpt.com/';
const GEMINI_URL = 'https://gemini.google.com/app';

let browserInstance = null;
let pageInstance = null;

async function launchBrowser(log, label) {
  if (pageInstance && !pageInstance.isClosed()) {
    try {
      await pageInstance.evaluate(() => 1);
      log(`♻️ Reusing existing browser for ${label}...`);
      return { browser: browserInstance, page: pageInstance };
    } catch (e) {
      log(`⚠️ Browser unresponsive, relaunching...`);
      try { await browserInstance.close(); } catch (err) { }
    }
  }

  const userDataDir = path.join(app.getPath('userData'), 'browser-profiles', label.toLowerCase());
  await fs.ensureDir(userDataDir);

  log(`🚀 Launching ${label} browser...`);
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
    viewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  browserInstance = browser;
  pageInstance = page;

  return { browser, page };
}

async function runAutomation(event, payload, localDB) {
  // Unwrap payload if it comes from the standard preload wrapper { stage, options }
  let params = payload;
  if (payload.stage && payload.options) {
    params = { ...payload.options, mode: payload.stage };
  }

  const { mode, page, pageId, basePrompt, extractedScript } = params;
  const log = (msg) => event.sender.send('automation-log', msg);

  try {
    if (mode === 'chatgpt') {
      await runChatGPTFlow(log, basePrompt, extractedScript, pageId, localDB);
    } else if (mode === 'gemini') {
      await runGeminiFlow(log, pageId, localDB, page);
    }
    log('✅ Automation Task Complete');
    event.sender.send('automation-state', 'idle');
  } catch (error) {
    log(`❌ Error: ${error.message}`);
    event.sender.send('automation-state', 'error');
    console.error(error);
  }
}

// --- ChatGPT Flow ---

async function runChatGPTFlow(log, basePrompt, script, pageId, localDB) {
  log('🤖 Starting ChatGPT Flow...');

  const { page } = await launchBrowser(log, 'ChatGPT');
  await page.goto(CHATGPT_URL);

  // Check login
  try {
    await page.waitForSelector('#prompt-textarea', { timeout: 10000 });
  } catch (e) {
    log('⚠️ Please log in to ChatGPT manually. Waiting 2 minutes...');
    await page.waitForSelector('#prompt-textarea', { timeout: 120000 });
  }

  // 1. Send Base Prompt
  log('📝 Sending Base Prompt...');
  await sendToChatGPT(page, basePrompt);
  await waitForChatGPTResponse(page, log);

  // 2. Send Script
  log('📜 Sending Script for extraction...');
  await sendToChatGPT(page, script);
  await waitForChatGPTResponse(page, log);

  // 3. Extract Prompts
  log('🔍 Extracting generated prompts...');
  const prompts = await extractPromptsFromPage(page);

  if (prompts.length === 0) {
    log('⚠️ No prompts found usually matching pattern "1.1 Prompt Text". Check output.');
  } else {
    log(`✅ Found ${prompts.length} prompts. Saving to database...`);
    let savedCount = 0;
    for (const p of prompts) {
      if (p && p.trim().length > 5) {
        try {
          localDB.addPrompt(pageId, p.trim());
          savedCount++;
        } catch (e) {
          console.error('Failed to save prompt:', e);
        }
      }
    }
    log(`💾 Saved ${savedCount} prompts to database.`);
  }
}

async function sendToChatGPT(page, text) {
  const selector = '#prompt-textarea';
  await page.fill(selector, text);
  await page.press(selector, 'Enter');
}

async function waitForChatGPTResponse(page, log) {
  log('⏳ Waiting for response...');
  await page.waitForTimeout(3000);
  // Wait until the "Stop generating" button is GONE
  try {
    await page.waitForSelector('[data-testid="stop-button"]', { state: 'detached', timeout: 120000 });
  } catch (e) { }
  await page.waitForTimeout(1000);
}

async function extractPromptsFromPage(page) {
  return await page.evaluate(() => {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length === 0) return [];

    const lastMessage = messages[messages.length - 1];

    const codeBlocks = Array.from(lastMessage.querySelectorAll('code'));
    if (codeBlocks.length > 0) {
      return codeBlocks.map(block => block.innerText);
    }

    const text = lastMessage.innerText;
    const matches = text.match(/^\d+\.\d+\s+.+$/gm);
    return matches || [];
  });
}

// --- Gemini Flow ---

async function runGeminiFlow(log, pageId, localDB, pageContext) {
  log('🎨 Starting Gemini Image Generation Flow...');

  const saveRoot = localDB.getSetting('image_save_path');
  if (!saveRoot) {
    throw new Error('Please set "Image Save Location" in Settings first.');
  }

  const prompts = localDB.getPrompts(pageId).filter(p => !p.isSkipped);
  if (prompts.length === 0) {
    log('⚠️ No active prompts found for this page.');
    return;
  }
  log(`✨ Found ${prompts.length} active prompts to process.`);

  const hierarchyPath = localDB.getPageHierarchyPath(pageId);
  log(`📍 Hierarchy detected: ${hierarchyPath.join(' / ')}`);

  const sanitizedPath = hierarchyPath.map(part => part.replace(/[^a-z0-9]/gi, '_').substring(0, 50));
  const saveDir = path.join(saveRoot, ...sanitizedPath);

  await fs.ensureDir(saveDir);
  log(`📂 Images will be saved to: ${saveDir}`);

  const { page } = await launchBrowser(log, 'Gemini');
  await page.goto(GEMINI_URL);

  try {
    await page.waitForSelector('.ql-editor, textarea', { timeout: 10000 });
  } catch (e) {
    log('⚠️ Please log in to Gemini manually. Waiting 2 minutes...');
    await page.waitForSelector('.ql-editor, textarea', { timeout: 120000 });
  }

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    let promptNum = (prompt.content.match(/^(\d+\.\d+)/) || [])[1];
    if (!promptNum) {
      promptNum = `p${i + 1}`;
    }

    const filename = `${promptNum}.png`;
    const filePath = path.join(saveDir, filename);

    if (await fs.pathExists(filePath)) {
      log(`⏭️ Skipping ${promptNum}, already exists.`);
      continue;
    }

    log(`🎨 [${i + 1}/${prompts.length}] Generating: ${promptNum}...`);

    try {
      await sendToGemini(page, prompt.content);
      await waitForGeminiGeneration(page);
      const imageSaved = await saveGeminiImage(page, filePath, log);

      if (imageSaved) {
        log(`✅ Saved: ${filename}`);
      } else {
        log(`❌ Failed to save image for ${promptNum}`);
      }
    } catch (err) {
      log(`❌ Prompt ${promptNum} failed: ${err.message}`);
    }

    await page.waitForTimeout(3000);
  }
}

async function sendToGemini(page, text) {
  const selector = '.ql-editor, textarea';
  await page.click(selector);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

async function waitForGeminiGeneration(page) {
  await page.waitForTimeout(3000);
  try {
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.some(img => img.width > 200 && img.height > 200);
    }, { timeout: 45000 });
  } catch (e) {
    throw new Error('Image generation timed out');
  }
}

async function saveGeminiImage(page, filePath, log) {
  return await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter(img => img.width > 300 && img.height > 300);

    if (imgs.length === 0) return false;

    const targetImg = imgs[imgs.length - 1];
    const src = targetImg.src;
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) { return null; }
  }).then(async (dataUrl) => {
    if (!dataUrl) return false;
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "").replace(/^data:image\/jpeg;base64,/, "");
    await fs.writeFile(filePath, base64Data, 'base64');
    return true;
  });
}

module.exports = { runAutomation };
