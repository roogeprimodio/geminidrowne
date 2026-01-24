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
      // Pass params as the options object (contains aspectRatio etc)
      await runGeminiFlow(log, pageId, localDB, page, params);
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
  try {
    if (isStopped) throw new Error('Stopped by user');
    await page.goto(CHATGPT_URL);

    // Check login
    try {
      await page.waitForSelector('#prompt-textarea', { timeout: 10000 });
    } catch (e) {
      log('⚠️ Please log in to ChatGPT manually. Waiting 2 minutes...');
      await page.waitForSelector('#prompt-textarea', { timeout: 120000 });
    }

    if (isStopped) throw new Error('Stopped by user');

    // 1. Send Base Prompt
    if (basePrompt) {
      log('📝 Sending Custom Base Prompt from settings...');
      await sendToChatGPT(page, basePrompt);
    } else {
      log('📝 Sending Default Base Prompt...');
      await sendToChatGPT(page, "Extract image prompts from the following script. Format clearly as a numbered list like 1.1, 1.2 etc.");
    }
    await waitForChatGPTResponse(page, log);

    if (isStopped) throw new Error('Stopped by user');
    if (page.isClosed()) throw new Error('Browser was closed');

    // 2. Send Script
    log('📜 Sending Script for extraction...');
    await sendToChatGPT(page, script);
    await waitForChatGPTResponse(page, log);

    if (isStopped) throw new Error('Stopped by user');
    if (page.isClosed()) throw new Error('Browser was closed');

    // 3. Extract Prompts
    log('🔍 Extracting generated prompts...');
    const prompts = await extractPromptsFromPage(page);

    if (prompts.length === 0) {
      log('⚠️ No prompts found. ChatGPT might be using a different format.');
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

      // Notify renderer to refresh UI
      const { BrowserWindow } = require('electron');
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send('prompts-updated', { pageId });
    }
  } catch (err) {
    if (isStopped) log('🛑 Automation stopped.');
    else log(`❌ ChatGPT Flow failed: ${err.message}`);
    throw err;
  }
}

async function sendToChatGPT(page, text) {
  if (isStopped) throw new Error('Stopped by user');
  const selector = '#prompt-textarea';
  await page.waitForSelector(selector);
  await page.fill(selector, text);
  await page.keyboard.press('Enter');
}

async function waitForChatGPTResponse(page, log) {
  log('⏳ Waiting for response...');
  // Brief wait to let the generation start
  await page.waitForTimeout(2000);

  // Wait until the "Stop generating" button is GONE, or "Send message" button reappears
  try {
    // Specifically wait for the stop button to disappear if it appears
    await page.waitForSelector('[data-testid="stop-button"]', { state: 'detached', timeout: 180000 });
  } catch (e) {
    // Just a fallback
  }

  // Double check the send button is back
  try {
    await page.waitForSelector('[data-testid="send-button"]', { timeout: 5000 });
  } catch (e) { }

  await page.waitForTimeout(1000);
}

async function extractPromptsFromPage(page) {
  return await page.evaluate(() => {
    // Look for all assistant messages
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length === 0) return [];

    // Get the last one
    const lastMessage = messages[messages.length - 1];

    // Try finding code blocks first
    const codeBlocks = Array.from(lastMessage.querySelectorAll('code, pre code'));
    if (codeBlocks.length > 0) {
      let results = [];
      codeBlocks.forEach(block => {
        const text = block.innerText;
        // If it looks like a list of prompts, split it
        if (text.includes('\n')) {
          const lines = text.split('\n').filter(l => l.trim().length > 10);
          results.push(...lines);
        } else {
          results.push(text);
        }
      });
      if (results.length > 0) return results;
    }

    // Try finding numbered list patterns in plain text
    const text = lastMessage.innerText;
    // Matches patterns like "1.1 Prompt text" or "1. Prompt text" or just prompts separated by lines
    const regex = /^\d+(?:\.\d+)?\s+.+$/gm;
    const matches = text.match(regex);
    if (matches) return matches;

    // Fallback: splitting by lines if they look like prompts (long enough)
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 20 && !l.includes('ChatGPT') && !l.includes('Image Prompt'));
  });
}

// --- Gemini Flow ---

// Control flags
let isPaused = false;
let isStopped = false;

function setAutomationControl(action) {
  if (action === 'pause') isPaused = true;
  if (action === 'resume') isPaused = false;
  if (action === 'stop') isStopped = true;
}

async function runGeminiFlow(log, pageId, localDB, pageContext, options = {}) {
  log('🎨 Starting Gemini Image Generation Flow (Batch Mode)...');
  isPaused = false;
  isStopped = false;

  const saveRoot = localDB.getSetting('image_save_path');
  if (!saveRoot) {
    throw new Error('Please set "Image Save Location" in Settings first.');
  }

  const prompts = localDB.getPrompts(pageId).filter(p => !p.isSkipped);
  if (prompts.length === 0) {
    log('⚠️ No active prompts found for this page.');
    return;
  }

  // Apply Aspect Ratio if selected
  const aspectRatio = options.aspectRatio;
  if (aspectRatio) {
    log(`📐 Aspect Ratio set to: ${aspectRatio}`);
  }

  log(`✨ Found ${prompts.length} active prompts. Starting Batch Generation...`);

  const hierarchyPath = localDB.getPageHierarchyPath(pageId);
  log(`📍 Hierarchy detected: ${hierarchyPath.join(' / ')}`);

  const sanitizedPath = hierarchyPath.map(part => part.replace(/[^a-z0-9 ]/gi, '_').substring(0, 50));
  const saveDir = path.join(saveRoot, ...sanitizedPath);

  await fs.ensureDir(saveDir);
  log(`📂 Images will be saved to: ${saveDir}`);

  // Open Folder Button can be triggered from UI using this path

  const { page } = await launchBrowser(log, 'Gemini');
  await page.goto(GEMINI_URL);

  try {
    await page.waitForSelector('.ql-editor, textarea', { timeout: 10000 });
  } catch (e) {
    log('⚠️ Please log in to Gemini manually. Waiting 2 minutes...');
    await page.waitForSelector('.ql-editor, textarea', { timeout: 120000 });
  }

  // Initial wait for Gemini to settle
  log('⏳ Waiting 10 seconds for Gemini to initialize...');
  await page.waitForTimeout(10000);

  // --- PHASE 1: GENERATION LOOP ---
  log('🚀 Phase 1: Generating all images...');

  for (let i = 0; i < prompts.length; i++) {
    if (isStopped) { log('🛑 Automation Stopped by user.'); break; }
    while (isPaused) {
      if (isStopped) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    const prompt = prompts[i];
    log(`[${i + 1}/${prompts.length}] Sending prompt: "${prompt.content.substring(0, 30)}..."`);

    let finalPromptText = prompt.content;
    if (aspectRatio) {
      finalPromptText += ` --ar ${aspectRatio}`;
    }

    try {
      await sendToGemini(page, finalPromptText);
      // Wait for generation processing to finish (Send button active again)
      await waitForGeminiGeneration(page, log);
      log(`✅ Generation ${i + 1} completed.`);
    } catch (err) {
      log(`❌ Generation ${i + 1} failed: ${err.message}`);
    }

    // Cooling down
    if (i < prompts.length - 1) {
      log('⏳ fast cool-down (3s)...');
      await page.waitForTimeout(3000);
    }
  }

  if (isStopped) return;

  // --- PHASE 2: SAVING LOOP ---
  log('💾 Phase 2: Saving all generated images...');
  // Wait a moment for last images to fully render high-res versions
  await page.waitForTimeout(5000);

  // We process all images now
  await saveAllBatchedImages(page, prompts, saveDir, log, pageId, options);
}

async function saveAllBatchedImages(page, prompts, saveDir, log, pageId, options) {
  let savedCount = 0;

  for (let i = 0; i < prompts.length; i++) {
    if (isStopped) break;
    const prompt = prompts[i];

    // Construct filename: Prompt Text (Cleaned)
    // User requested "same as prompt name"
    const safeFilename = prompt.content
      .replace(/[^a-z0-9 \-\.]/gi, '') // Allow alphanumeric, spaces, dashes, dots
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);

    const filename = `${safeFilename}.png`;
    const filePath = path.join(saveDir, filename);

    log(`🔍 Finding image for: "${safeFilename.substring(0, 20)}..."`);

    // Find image for this prompt
    const saved = await page.evaluate(async ({ searchText }) => {
      const normalize = t => t.replace(/\s+/g, ' ').trim();
      const target = normalize(searchText);

      // Search for the prompt bubble in the chat
      // xpath is often robust for "contains"
      const xpath = `//*[contains(text(), "${target.substring(0, 20).replace(/"/g, '')}")]`;
      const iterator = document.evaluate(xpath, document.body, null, XPathResult.ANY_TYPE, null);
      let node = iterator.iterateNext();
      let promptContainer = null;

      // Find the User Query bubble
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Verify context (e.g. check parent classes if possible, but text match is strong signal)
          if (normalize(node.innerText).includes(target)) {
            promptContainer = node;
            break;
          }
        }
        node = iterator.iterateNext();
      }

      if (!promptContainer) return { error: 'Prompt text not found in chat' };

      // 1. Try finding detailed image container first (more robust)
      // Gemini usually wraps generated images in specific containers or with specific attributes
      // Strategy: Look for images that are large enough and are *visually* near the prompt or in the latest response block.

      const allImages = Array.from(document.querySelectorAll('img[src^="https"]'))
        .filter(img => {
          const rect = img.getBoundingClientRect();
          // Filter out tiny icons/avatars. Generated images are usually substantial.
          return rect.width > 200 && rect.height > 200;
        });

      // Filter images that appear AFTER this prompt in the DOM
      const imagesAfter = allImages.filter(img => {
        return (promptContainer.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      if (imagesAfter.length === 0) {
        // Fallback: If we can't find it "after" (nesting issues), look for the very last large image added to the DOM
        if (allImages.length > 0) {
          return { src: allImages[allImages.length - 1].src };
        }
        return { error: 'No images found after prompt' };
      }

      // The FIRST large image after the prompt is likely the one.
      return { src: imagesAfter[0].src };

    }, { searchText: prompt.content });

    if (saved && saved.src) {
      try {
        const response = await page.request.get(saved.src, {
          headers: {
            'Referer': 'https://gemini.google.com/',
            'User-Agent': await page.evaluate(() => navigator.userAgent)
          }
        });

        if (response.ok()) {
          const buffer = await response.body();
          // Overwrite is default behavior (matches user request)
          await fs.writeFile(filePath, buffer);
          log(`✅ Saved: ${filename}`);

          const win = require('electron').BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send('automation-asset-created', {
              pageId, promptId: prompt.id, filePath, filename
            });
          }
          savedCount++;
        } else {
          log(`❌ Download failed: ${response.status()}`);
        }
      } catch (e) {
        log(`❌ Save error: ${e.message}`);
      }
    } else {
      log(`⚠️ Skipped: ${saved?.error || 'Image not found'}`);
    }

    await page.waitForTimeout(1000);
  }

  log(`🏁 Batch Complete. Saved ${savedCount}/${prompts.length} images.`);
}

async function sendToGemini(page, text) {
  const selector = '.ql-editor, textarea';
  await page.waitForSelector(selector);

  // Clear existing text first
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.innerText = '';
  }, selector);

  await page.waitForTimeout(500);

  // Type properly to ensure events fire
  await page.type(selector, text, { delay: 10 });
  await page.waitForTimeout(1000);

  // Click Send
  const sendButton = await page.$('button[aria-label*="Send"], button[class*="send"]');
  if (sendButton) {
    // Check if button is disabled (empty text?)
    const isDisabled = await sendButton.evaluate(btn => btn.disabled);
    if (isDisabled) throw new Error('Send button is disabled. Text might not have been typed correctly.');

    await sendButton.click();
  } else {
    await page.focus(selector);
    await page.keyboard.press('Enter');
  }

  // Verify submission: Input should clear or Send button should change state
  await page.waitForTimeout(2000);
  const inputContent = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText || el.value : '';
  }, selector);

  if (inputContent.length > 5 && inputContent.includes(text.substring(0, 5))) {
    // If text is still there, it didn't send. Try Enter key fallback.
    await page.focus(selector);
    await page.keyboard.press('Enter');
  }
}

async function waitForGeminiGeneration(page, log) {
  log('⏳ Monitoring generation status...');

  // Phase 1: Detect Start (Active Generation)
  // We look for the "Stop response" button or the absence of the Send button.
  try {
    await page.waitForFunction(() => {
      const stopBtn = document.querySelector('button[aria-label*="Stop response"]');
      const sendBtn = document.querySelector('button[aria-label*="Send"], button[class*="send"]');
      // Start confirmed if: We see a Stop button OR Send button is gone/hidden/disabled
      return !!stopBtn || !sendBtn || sendBtn.disabled;
    }, { timeout: 10000 });
    // log('⚡ Generation started (UI State changed)...');
  } catch (e) {
    log('⚠️ Warning: UI didn\'t change state quickly. Prompt might have been ignored.');
  }

  // Phase 2: Wait for Completion
  // Wait until "Stop" is GONE and "Send" is BACK and ENABLED
  try {
    await page.waitForFunction(() => {
      const stopBtn = document.querySelector('button[aria-label*="Stop response"]');
      const sendBtn = document.querySelector('button[aria-label*="Send"], button[class*="send"]');

      // Complete when: No Stop button AND Send button exists AND Send button is enabled
      const isstopped = !stopBtn;
      const isready = sendBtn && !sendBtn.disabled;

      return isstopped && isready;
    }, { timeout: 120000, polling: 1000 }); // 2 min timeout
  } catch (e) {
    throw new Error('Generation timed out (2 mins limit). System stuck?');
  }

  // Phase 3: Verify Success (Error Detection)
  // Check the last model message for error text
  const errorCheck = await page.evaluate(() => {
    const modelMsgs = document.querySelectorAll('.model-response-text, .message-content'); // Adjust based on Gemini classes
    if (modelMsgs.length === 0) return null;

    const lastMsg = modelMsgs[modelMsgs.length - 1];
    const text = lastMsg.innerText.toLowerCase();

    const errorPhrases = [
      "i can't create images",
      "i cannot create images",
      "unable to generate",
      "policy violation",
      "safety guidelines",
      "prohibited"
    ];

    for (const phrase of errorPhrases) {
      if (text.includes(phrase)) return phrase;
    }
    return null;
  });

  if (errorCheck) {
    throw new Error(`Gemini refused request: detected "${errorCheck}"`);
  }

  // Phase 4: Valid Output Check
  // Ensure an image actually appeared? 
  // Maybe optional, as "I can't" check covers most failures.
}

module.exports = { runAutomation, setAutomationControl };
