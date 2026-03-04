const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const sharp = require('sharp');

/**
 * Server-side HTML → plain text extractor.
 * Node.js has no DOMParser, so we use regex-based tag stripping.
 */
function extractScriptTextFromHTML(html) {
  if (!html) return '';
  if (!html.includes('<')) return html.trim(); // Already plain text
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(br|p|div|tr|td|th|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

  log(`🚀 Launching ${label} using local system browser...`);

  // Try launching with Chrome, fallback to Edge
  const channels = ['chrome', 'msedge'];
  let browser = null;

  // Determine bundled executable path if packaged
  let bundledExecutablePath = null;
  if (app.isPackaged) {
    const browsersDir = path.join(process.resourcesPath, 'playwright-browsers');
    try {
      if (fs.existsSync(browsersDir)) {
        // Find the chromium directory inside playwright-browsers
        const entries = fs.readdirSync(browsersDir);
        const chromiumDir = entries.find(e => e.startsWith('chromium-'));
        if (chromiumDir) {
          bundledExecutablePath = path.join(
            browsersDir,
            chromiumDir,
            'chrome-win',
            'chrome.exe'
          );
        }
      }
    } catch (e) {
      log(`⚠️ Failed to resolve bundled executable: ${e.message}`);
    }
  }

  if (bundledExecutablePath && fs.existsSync(bundledExecutablePath)) {
    try {
      log(`📦 Launching bundled Chromium from: ${bundledExecutablePath}`);
      browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: bundledExecutablePath,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--disable-infobars',
          '--disable-dev-shm-usage',
          '--no-default-browser-check',
        ],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });
      log(`✅ Successfully connected to bundled local browser.`);
    } catch (err) {
      log(`❌ Failed to launch bundled browser: ${err.message}`);
      browser = null;
    }
  }

  // Fallback to system browsers if bundled fails or we are in dev mode
  if (!browser) {
    for (const channel of channels) {
      try {
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          channel: channel,
          args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
          viewport: { width: 1280, height: 800 }
        });
        log(`✅ Successfully connected to local browser (${channel}).`);
        break;
      } catch (err) {
        log(`ℹ️ System browser channel '${channel}' not found or failed to launch.`);
      }
    }
  }

  if (!browser) {
    throw new Error(`Critical Error: No supported system browser found. Please install Google Chrome or Microsoft Edge.`);
  }

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  browserInstance = browser;
  pageInstance = page;

  return { browser, page };
}

let isStopped = false; // Global flag to allow abortion

async function runAutomation(event, payload, localDB) {
  let params = payload;
  if (payload.stage && payload.options) {
    params = { ...payload.options, mode: payload.stage };
  }

  const { mode, page, pageId, basePrompt, extractedScript, pages, skipIfHasPrompts } = params;
  const log = (msg) => event.sender.send('automation-log', msg);
  const emitProgress = (data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('automation-batch-progress', data);
    }
  };
  isStopped = false;

  try {
    const pagesToProcess = pages || [{ id: pageId, content: extractedScript || page?.content }];

    if (pagesToProcess.length === 0) {
      log('⚠️ No pages to process.');
      event.sender.send('automation-state', 'idle');
      emitProgress({ status: 'idle', current: 0, total: 0 });
      return;
    }

    log(`🚀 Starting batch processing: over ${pagesToProcess.length} pages...`);
    emitProgress({ status: 'starting', current: 0, total: pagesToProcess.length });

    // We only launch browser once per batch
    const { page: browserPage } = await launchBrowser(log, mode === 'chatgpt' ? 'ChatGPT' : 'Gemini');

    for (let i = 0; i < pagesToProcess.length; i++) {
      if (isStopped) {
        log('🛑 Automation stopped by user.');
        break;
      }

      const currentPage = pagesToProcess[i];
      const pId = currentPage.id || currentPage.pageId;

      if (mode === 'chatgpt') {
        // runChatGPTFlow handles all pages in a single ChatGPT session
        await runChatGPTFlow(log, basePrompt, pagesToProcess, localDB, browserPage, emitProgress, { skipIfHasPrompts });
        break;
      } else if (mode === 'gemini') {
        emitProgress({
          status: 'running',
          current: i + 1,
          total: pagesToProcess.length,
          pageId: pId,
          pageTitle: currentPage.title || 'Untitled',
          sectionName: currentPage.sectionName || '',
        });
        log(`\n--- Processing Page ${i + 1} of ${pagesToProcess.length} ---`);
        await runGeminiFlow(log, pId, localDB, browserPage, params);
      } else if (mode === 'gemini-retry') {
        emitProgress({
          status: 'running',
          current: i + 1,
          total: pagesToProcess.length,
          pageId: pId,
          pageTitle: currentPage.title || 'Untitled',
          sectionName: currentPage.sectionName || '',
        });
        log(`\n--- Retry Page ${i + 1} of ${pagesToProcess.length} ---`);
        await runGeminiRetryFlow(log, pId, localDB, browserPage, params);
      }
    }

    if (isStopped) {
      log('🛑 Automation Task Stopped by user');
      event.sender.send('automation-state', 'idle');
      emitProgress({ status: 'stopped', current: 0, total: pagesToProcess.length });
      return;
    }

    log('✅ Automation Task Complete');
    event.sender.send('automation-state', 'idle');
    emitProgress({ status: 'done', current: pagesToProcess.length, total: pagesToProcess.length });
  } catch (error) {
    log(`❌ Error: ${error.message}`);
    event.sender.send('automation-state', 'error');
    emitProgress({ status: 'error', message: error.message });
    console.error(error);
  }
}

// --- ChatGPT Flow ---

async function runChatGPTFlow(log, basePrompt, pagesToProcess, localDB, browserPage, emitProgress, opts = {}) {
  log(`🤖 Starting ChatGPT Batch Flow for ${pagesToProcess.length} pages...`);
  const { skipIfHasPrompts = false } = opts;

  const page = browserPage;
  isPaused = false;
  isStopped = false;

  let skippedCount = 0;
  let processedCount = 0;

  try {
    if (isStopped) throw new Error('Stopped by user');
    await page.goto(CHATGPT_URL);

    try {
      await page.waitForSelector('#prompt-textarea', { timeout: 10000 });
    } catch (e) {
      log('⚠️ Please log in to ChatGPT manually. Waiting 2 minutes...');
      await page.waitForSelector('#prompt-textarea', { timeout: 120000 });
    }

    if (isStopped) throw new Error('Stopped by user');

    // 1. Send Base Prompt (Once for the entire batch)
    // Append a strict constraint so ChatGPT only says OK and does NOT generate prompts yet
    const BASE_PROMPT_SUFFIX = '\n\nIMPORTANT: Just reply with exactly "OK understood." — do NOT generate any prompts now. I will send you scripts one by one after this.';

    if (basePrompt) {
      log('📝 Sending Custom Base Prompt (with OK constraint)...');
      await sendToChatGPT(page, basePrompt + BASE_PROMPT_SUFFIX);
    } else {
      log('📝 Sending Default Base Prompt...');
      await sendToChatGPT(page, 'You will help me extract image generation prompts from news video scripts. I will send you one script at a time. For each script, reply with ONLY a clean numbered list of image prompts, nothing else.' + BASE_PROMPT_SUFFIX);
    }
    await waitForChatGPTResponse(page, log);

    if (isStopped) throw new Error('Stopped by user');
    if (page.isClosed()) throw new Error('Browser was closed');

    // 2. Loop through all pages and feed scripts sequentially
    for (let i = 0; i < pagesToProcess.length; i++) {
      if (isStopped) break;
      while (isPaused) {
        if (isStopped) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      if (isStopped) break;

      const currentPage = pagesToProcess[i];
      let script = currentPage.content;
      const pageId = currentPage.id || currentPage.pageId;
      const pageTitle = currentPage.title || `Page ${i + 1}`;
      const sectionName = currentPage.sectionName || '';
      const isMarkedSkip = currentPage.isSkipped === true;

      // Emit live progress
      if (emitProgress) emitProgress({
        status: 'running',
        current: i + 1,
        total: pagesToProcess.length,
        pageId,
        pageTitle,
        sectionName,
        skippedCount,
        processedCount,
      });

      // Skip: page explicitly marked as skipped
      if (isMarkedSkip) {
        log(`⏭️ [${i + 1}/${pagesToProcess.length}] Skipping "${pageTitle}" — marked as skip.`);
        skippedCount++;
        continue;
      }

      // Skip check: page already has prompts saved in DB
      if (skipIfHasPrompts && localDB) {
        const existingCount = localDB.getPromptCount ? localDB.getPromptCount(pageId) : 0;
        if (existingCount > 0) {
          log(`⏭️ [${i + 1}/${pagesToProcess.length}] Skipping "${pageTitle}" — already has ${existingCount} prompts.`);
          skippedCount++;
          continue;
        }
      }

      // --- Content Resolution ---
      // If passed content is empty or is the 'No script found' error string, try DB fallback
      const isContentBad = !script || script.trim().length < 10 ||
        script.startsWith('No script found') ||
        script.startsWith('Failed to load');

      if (isContentBad && localDB) {
        log(`🔍 [${i + 1}] Content missing/invalid for "${pageTitle}", loading from DB...`);
        try {
          const fullPage = localDB.getPage ? localDB.getPage(pageId) : null;
          if (fullPage && fullPage.content) {
            // Pull content from DB and extract clean text server-side
            script = extractScriptTextFromHTML(fullPage.content);
            log(`   ↳ DB fallback loaded (${script.length} chars after extraction)`);
          }
        } catch (dbErr) {
          log(`   ↳ ⚠️ DB fallback failed: ${dbErr.message}`);
        }
      } else if (script && script.includes('<')) {
        // Content looks like raw HTML (not pre-extracted) — extract it now
        script = extractScriptTextFromHTML(script);
      }

      // Final check after all fallbacks
      if (!script || script.trim().length < 20) {
        log(`⚠️ [${i + 1}/${pagesToProcess.length}] Script content empty after all fallbacks — skipping.`);
        skippedCount++;
        continue;
      }

      // Capture current message count BEFORE sending so we only read the NEW response
      const preCount = await page.evaluate(() =>
        document.querySelectorAll('[data-message-author-role="assistant"]').length
      );

      log(`\n[${i + 1}/${pagesToProcess.length}] 📜 Sending Script for "${pageTitle}" (${script.length} chars)...`);
      await sendToChatGPT(page, script);
      await waitForChatGPTResponse(page, log);

      if (isStopped) throw new Error('Stopped by user');
      if (page.isClosed()) throw new Error('Browser was closed');

      // 3. Extract Prompts — only from the NEW response, ignoring old chat history
      log(`🔍 Extracting prompts for "${pageTitle}" (was ${preCount} messages before)...`);
      const prompts = await extractNewPromptsFromPage(page, preCount);

      if (prompts.length === 0) {
        log('⚠️ No prompts found for this page. Moving to next.');
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
        processedCount++;

        // Notify renderer to refresh UI
        const { BrowserWindow } = require('electron');
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('prompts-updated', { pageId });
      }

      // Small cooldown between scripts
      await page.waitForTimeout(1000); // reduced from 2000ms
    }

    log(`\n📊 Summary: ${processedCount} processed, ${skippedCount} skipped out of ${pagesToProcess.length} total.`);
  } catch (err) {
    if (isStopped) log('🛑 Automation stopped.');
    else log(`❌ ChatGPT Flow failed: ${err.message}`);
    throw err;
  }
}

async function sendToChatGPT(page, text) {
  if (isStopped) throw new Error('Stopped by user');
  const selector = '#prompt-textarea';

  await page.waitForSelector(selector, { state: 'visible' });

  // Clear existing content
  await page.click(selector);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);

  // Primary: CDP Input.insertText — injects text directly, no clipboard hijacking.
  // User can copy/paste their own things freely while this runs.
  let injected = false;
  try {
    const client = await page.context().newCDPSession(page);
    await page.click(selector);
    await client.send('Input.insertText', { text });
    await client.detach();
    await page.waitForTimeout(300);
    injected = true;
  } catch (cdpErr) {
    console.warn('[sendToChatGPT] CDP insertText failed:', cdpErr.message);
  }

  // Verify text landed
  const afterCDP = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }, selector);

  if (!injected || afterCDP.length < 5) {
    // Fallback 1: execCommand insertText (no clipboard either)
    await page.evaluate((sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, txt);
    }, selector, text);
    await page.waitForTimeout(400);

    const afterExec = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? (el.innerText || el.textContent || '').trim() : '';
    }, selector);

    if (afterExec.length < 5) {
      // Fallback 2: keyboard.type — slow but always works
      console.warn('[sendToChatGPT] execCommand failed. Using keyboard.type (slow).');
      await page.click(selector);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(text, { delay: 2 }); // no cap — long scripts must not be silently truncated
      await page.waitForTimeout(300);
    }
  }

  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
}

async function waitForChatGPTResponse(page, log) {
  log('⏳ Monitoring ChatGPT response status...');
  await page.waitForTimeout(2000);

  try {
    log('   ↳ Phase 1: Waiting for generation to finish... (checking for Stop button disappearance)');
    // Specifically wait for the stop button to disappear if it appears
    await page.waitForSelector('[data-testid="stop-button"]', { state: 'detached', timeout: 90000 }); // reduced from 180s — fail faster on stuck pages
  } catch (e) {
    log('   ↳ ⚠️ Stop button check timed out or didn\'t appear.');
  }

  log('   ↳ Phase 2: Verifying UI is ready for next prompt...');
  try {
    // Wait until the send button exists and is NOT disabled
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-testid="send-button"]');
      return btn && !btn.disabled;
    }, { timeout: 30000 });
    log('   ↳ ✅ Response fully received.');
  } catch (e) {
    log('   ↳ ⚠️ Send button still inactive after 30s. Proceeding with caution...');
  }

  await page.waitForTimeout(1000);
}

/**
 * Extracts prompts ONLY from messages added after `previousCount`.
 * This prevents re-reading old chat history from a previous session.
 */
async function extractNewPromptsFromPage(page, previousCount = 0) {
  return await page.evaluate((prevCount) => {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    // Slice to only NEW messages added since we started this script
    const newMessages = Array.from(messages).slice(prevCount);
    if (newMessages.length === 0) return [];

    // Use the last of the new messages (in case ChatGPT sends multiple in sequence)
    const lastMessage = newMessages[newMessages.length - 1];

    // Try finding code blocks first
    const codeBlocks = Array.from(lastMessage.querySelectorAll('code, pre code'));
    if (codeBlocks.length > 0) {
      let results = [];
      codeBlocks.forEach(block => {
        const text = block.innerText;
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
    const regex = /^\d+(?:\.\d+)?[.)\s]+.+$/gm;
    const matches = text.match(regex);
    if (matches) return matches;

    // Fallback: split by lines if they look like prompts (long enough)
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 20 && !l.includes('ChatGPT') && !l.includes('Image Prompt'));
  }, previousCount);
}

// Legacy alias kept for safety (not used in main flow anymore)
async function extractPromptsFromPage(page) {
  return extractNewPromptsFromPage(page, 0);
}

// --- Gemini Flow ---

// Control flags
let isPaused = false;
// isStopped is already declared globally, so no redeclaration here.
// Set to true when Phase 2 detects a stuck send button after image generation.
// The main loop checks this after each save and reloads the page to unblock the UI.
let geminiNeedsRefresh = false;

// Reloads the current Gemini page if the send button was left stuck after generation.
// page.reload() preserves the chat URL so conversation history is fully restored.
async function refreshGeminiIfNeeded(page, log) {
  if (!geminiNeedsRefresh) return;
  geminiNeedsRefresh = false;
  log('🔄 Refreshing Gemini page to reset stuck UI state...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  try {
    await page.waitForFunction(() => {
      const editor = document.querySelector('.ql-editor, textarea');
      const sendBtn = document.querySelector(
        'button[aria-label*="Send"], button[aria-label="Send message"], button[class*="send"]'
      );
      return editor && sendBtn && !sendBtn.disabled;
    }, { timeout: 20000 });
    log('✅ Gemini UI ready after page refresh.');
  } catch (e) {
    log('⚠️ Gemini UI slow after refresh — waiting 3s more.');
    await page.waitForTimeout(3000);
  }
}

function setAutomationControl(action) {
  if (action === 'pause') {
    isPaused = true;
    console.log("Automation PAUSED");
  } else if (action === 'resume' || action === 'start') {
    isPaused = false;
    isStopped = false;
    console.log("Automation RESUMED/STARTED");
  } else if (action === 'stop' || action === 'abort') {
    isStopped = true;
    isPaused = false; // break out of pause loops
    console.log("Automation STOPPED");
  }
}

async function runGeminiFlow(log, pageId, localDB, page, options = {}) {
  log('🎨 Starting Gemini Image Generation Flow (Batch Mode)...');
  isPaused = false;
  isStopped = false;
  geminiNeedsRefresh = false;

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

  // Resume from checkpoint if a previous run was interrupted
  let startIndex = 0;
  try {
    const checkpoint = localDB.getSetting(`gemini_checkpoint_${pageId}`);
    if (checkpoint !== null && checkpoint !== '') {
      const parsed = parseInt(checkpoint);
      if (!isNaN(parsed) && parsed + 1 < prompts.length) {
        startIndex = parsed + 1;
        log(`🔄 Resuming from checkpoint: starting at prompt ${startIndex + 1}/${prompts.length}`);
      }
    }
  } catch (e) { /* non-critical */ }

  const hierarchyPath = localDB.getPageHierarchyPath(pageId);
  log(`📍 Hierarchy detected: ${hierarchyPath.join(' / ')}`);

  const sanitizedPath = hierarchyPath.map(part => part.replace(/[^a-z0-9 ]/gi, '_').substring(0, 50));
  const saveDir = path.join(saveRoot, ...sanitizedPath);

  await fs.ensureDir(saveDir);
  log(`📂 Images will be saved to: ${saveDir}`);

  // Open Folder Button can be triggered from UI using this path

  await page.goto(GEMINI_URL);

  try {
    await page.waitForSelector('.ql-editor, textarea', { timeout: 10000 });
  } catch (e) {
    log('⚠️ Please log in to Gemini manually. Waiting 2 minutes...');
    await page.waitForSelector('.ql-editor, textarea', { timeout: 120000 });
  }

  // Wait for Gemini UI to be interactive (avoids hardcoded 10s sleep)
  log('⏳ Waiting for Gemini to be ready...');
  try {
    await page.waitForFunction(() => {
      const editor = document.querySelector('.ql-editor, textarea');
      const sendBtn = document.querySelector('button[aria-label*="Send"], button[class*="send"]');
      return editor && sendBtn && !sendBtn.disabled;
    }, { timeout: 15000 });
    log('✅ Gemini is ready.');
  } catch (e) {
    log('⚠️ Gemini UI not ready in 15s — proceeding with 2s fallback wait.');
    await page.waitForTimeout(2000);
  }

  // --- PHASE 1: GENERATION LOOP ---
  log('🚀 Phase 1: Generating all images...');

  for (let i = startIndex; i < prompts.length; i++) {
    if (isStopped) { log('🛑 Automation Stopped by user.'); break; }
    let success = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!success && attempts < maxAttempts) {
      if (isStopped) { log('🛑 Automation Stopped by user.'); break; }
      while (isPaused) {
        if (isStopped) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      if (isStopped) break;

      attempts++;
      const prompt = prompts[i];
      let finalPromptText = prompt.content;
      if (aspectRatio) {
        finalPromptText += ` --ar ${aspectRatio}`;
      }

      log(`[${i + 1}/${prompts.length}] Sending prompt (Attempt ${attempts}/${maxAttempts}): "${prompt.content.substring(0, 30)}..."`);

      // Count large images currently in DOM — used to detect if THIS generation added a new one.
      // Prevents the fallback from mistakenly grabbing the previous prompt's image on failure.
      let imageCountBefore = 0;
      try {
        imageCountBefore = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img[src^="https"]'))
            .filter(img => { const r = img.getBoundingClientRect(); return r.width > 100 && r.height > 100; })
            .length
        );
      } catch (e) { /* non-critical, default 0 is safe */ }

      try {
        await sendToGemini(page, finalPromptText);
        // Wait for generation processing to finish (Send button active again)
        await waitForGeminiGeneration(page, log);
        success = true;
        log(`✅ Generation ${i + 1} completed successfully.`);
        log(`💾 Saving image for prompt ${i + 1}/${prompts.length}...`);
        await page.waitForTimeout(1000); // reduced from 2000ms
        await saveAllBatchedImages(page, [prompt], saveDir, log, pageId, options, imageCountBefore);
        // Save checkpoint so a crash can resume from here
        try { localDB.saveSetting(`gemini_checkpoint_${pageId}`, String(i)); } catch (e) { /* non-critical */ }
      } catch (err) {
        log(`⚠️ Generation ${i + 1} attempt ${attempts} failed: ${err.message}`);

        // Before retrying — check if image was actually generated despite the detection error.
        // This is the primary cause of double-feeds: image IS in Gemini but Phase 3/4
        // threw a false-positive, so we try to save it now before deciding to re-send.
        const safeFilenameCheck = prompt.content
          .replace(/[^a-z0-9 \-\.]/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 100);
        const checkPath = path.join(saveDir, `${safeFilenameCheck}_${prompt.id}.jpg`);

        if (!fs.existsSync(checkPath)) {
          log(`🔍 Checking if image was actually generated despite error...`);
          try {
            await page.waitForTimeout(800);
            // Pass imageCountBefore so the fallback only saves if a NEW image appeared
            await saveAllBatchedImages(page, [prompt], saveDir, log, pageId, options, imageCountBefore);
          } catch (saveErr) { /* non-critical */ }
        }

        if (fs.existsSync(checkPath)) {
          // Image is on disk — detection was a false positive, no retry needed
          success = true;
          log(`✅ Image confirmed on disk. Skipping retry (false-positive detection).`);
          try { localDB.saveSetting(`gemini_checkpoint_${pageId}`, String(i)); } catch (e) { /* non-critical */ }
        } else {
          // Genuine failure — try rephrase on first refusal, otherwise retry
          if (err.message.includes('Gemini refused request') && attempts === 1) {
            log(`🔄 Prompt refused by policy. Asking Gemini to rephrase and generate...`);
            try {
              const rephraseRequest = `The previous image request was declined due to content policy. Please create a safe, neutral, news-appropriate alternative for: "${prompt.content.substring(0, 150)}" and generate the image.`;
              // Count again before rephrase attempt — previous attempt may have changed DOM
              let imageCountBeforeRephrase = imageCountBefore;
              try {
                imageCountBeforeRephrase = await page.evaluate(() =>
                  Array.from(document.querySelectorAll('img[src^="https"]'))
                    .filter(img => { const r = img.getBoundingClientRect(); return r.width > 100 && r.height > 100; })
                    .length
                );
              } catch (e) { /* use previous count as fallback */ }
              await sendToGemini(page, rephraseRequest);
              await waitForGeminiGeneration(page, log);
              success = true;
              log(`✅ Rephrased generation ${i + 1} completed successfully.`);
              await page.waitForTimeout(1000);
              await saveAllBatchedImages(page, [prompt], saveDir, log, pageId, options, imageCountBeforeRephrase);
              try { localDB.saveSetting(`gemini_checkpoint_${pageId}`, String(i)); } catch (e) { /* non-critical */ }
            } catch (rephraseErr) {
              log(`❌ Rephrase also failed: ${rephraseErr.message}`);
            }
          }

          if (!success) {
            if (attempts < maxAttempts) {
              // If the send button was stuck, refresh BEFORE the next attempt so the UI is ready.
              // Without this, all retry attempts would fire into a broken/stuck Gemini UI.
              await refreshGeminiIfNeeded(page, log);
              log(`⏳ Waiting 5s before retrying...`);
              await page.waitForTimeout(5000);
            } else {
              log(`❌ Generation ${i + 1} failed after ${maxAttempts} attempts. Moving to next prompt.`);
            }
          }
        }
      }
    }

    // Between prompts: reload page if send button was stuck, otherwise normal cooldown
    if (i < prompts.length - 1) {
      if (geminiNeedsRefresh) {
        await refreshGeminiIfNeeded(page, log); // reload resets stuck UI; includes its own wait
      } else {
        log('⏳ fast cool-down (2s)...');
        await page.waitForTimeout(2000);
      }
    }
  }

  if (isStopped) return;

  // Clear checkpoint — batch completed successfully
  try { localDB.saveSetting(`gemini_checkpoint_${pageId}`, ''); } catch (e) { /* non-critical */ }
  log('✅ All prompts processed. Images were saved incrementally.');
}

async function saveAllBatchedImages(page, prompts, saveDir, log, pageId, options, imageCountBefore = 0) {
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
      .trim()
      .substring(0, 100);

    const filename = `${safeFilename}_${prompt.id}.jpg`;
    const filePath = path.join(saveDir, filename);

    log(`🔍 Finding image for: "${safeFilename.substring(0, 20)}..."`);

    // Find image for this prompt
    const saved = await page.evaluate(async ({ searchText, imagesBefore }) => {
      const normalize = t => t.replace(/\s+/g, ' ').trim();
      const target = normalize(searchText);

      // Search for the prompt bubble — strip chars that break XPath string literals
      const xpathSafe = target.substring(0, 40).replace(/["'\\<>]/g, '');
      const xpath = `//*[contains(text(), "${xpathSafe}")]`;
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

      // Build the large-image list FIRST — used both in the fallback and normal path below.
      const allImages = Array.from(document.querySelectorAll('img[src^="https"]'))
        .filter(img => {
          const rect = img.getBoundingClientRect();
          return rect.width > 100 && rect.height > 100; // lowered from 200 — more robust
        });

      if (!promptContainer) {
        // XPath missed — only use the last image if a NEW one appeared since we sent this prompt.
        // allImages.length > imagesBefore means Gemini actually generated something new.
        // Without this guard, a failed generation would steal the previous prompt's image.
        if (allImages.length > imagesBefore) {
          return { src: allImages[allImages.length - 1].src, fallback: true };
        }
        return { error: 'No new image detected — generation likely failed for this prompt' };
      }

      // Filter images that appear AFTER this prompt in the DOM
      const imagesAfter = allImages.filter(img => {
        return (promptContainer.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING);
      });

      if (imagesAfter.length === 0) {
        // No image after this prompt — only use last image if the count grew (new image added)
        if (allImages.length > imagesBefore) {
          return { src: allImages[allImages.length - 1].src };
        }
        return { error: 'No new image found after prompt — generation likely failed' };
      }

      // The FIRST large image after the prompt is the one just generated.
      return { src: imagesAfter[0].src };

    }, { searchText: prompt.content, imagesBefore: imageCountBefore });

    if (saved && saved.src) {
      if (saved.fallback) log(`⚠️ XPath miss — using last-image fallback for: "${safeFilename.substring(0, 30)}..."`);
      try {
        const response = await page.request.get(saved.src, {
          timeout: 30000, // prevent hanging on slow/dead image URLs
          headers: {
            'Referer': 'https://gemini.google.com/',
            'User-Agent': await page.evaluate(() => navigator.userAgent)
          }
        });

        if (response.ok()) {
          const buffer = await response.body();

          // Convert to JPEG
          let jpgBuffer;
          try {
            jpgBuffer = await sharp(buffer)
              .jpeg({ quality: 95, mozjpeg: true })
              .toBuffer();
          } catch (e) {
            console.warn('Sharp conversion failed in batch mode, saving raw buffer as fallback', e);
            jpgBuffer = buffer;
          }

          // Overwrite is default behavior (matches user request)
          await fs.writeFile(filePath, jpgBuffer);
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

    await page.waitForTimeout(500); // reduced from 1000ms
  }

  log(`🏁 Batch Complete. Saved ${savedCount}/${prompts.length} images.`);
}

async function sendToGemini(page, text) {
  const selector = '.ql-editor, textarea';
  await page.waitForSelector(selector, { timeout: 15000 });

  // Clear existing text
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.innerText = '';
  }, selector);
  await page.waitForTimeout(200);

  // Primary: CDP Input.insertText — no clipboard, no typing delay
  let injected = false;
  try {
    const client = await page.context().newCDPSession(page);
    await page.click(selector);
    await client.send('Input.insertText', { text });
    await client.detach();
    await page.waitForTimeout(400);
    injected = true;
  } catch (cdpErr) {
    console.warn('[sendToGemini] CDP insertText failed:', cdpErr.message);
  }

  if (!injected) {
    // Fallback: type at 5ms/char (2x faster than original 10ms)
    await page.type(selector, text, { delay: 5 });
    await page.waitForTimeout(600);
  }

  // Click Send
  const sendButton = await page.$(
    'button[aria-label*="Send"], button[aria-label="Send message"], button[class*="send"], [data-testid="send-button"]'
  );
  if (sendButton) {
    const isDisabled = await sendButton.evaluate(btn => btn.disabled);
    if (isDisabled) throw new Error('Send button is disabled. Text might not have been injected correctly.');
    await sendButton.click();
  } else {
    await page.focus(selector);
    await page.keyboard.press('Enter');
  }

  // Verify submission
  await page.waitForTimeout(1500);
  const inputContent = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText || el.value : '';
  }, selector);

  if (inputContent.length > 5 && inputContent.includes(text.substring(0, 5))) {
    await page.focus(selector);
    await page.keyboard.press('Enter');
  }
}

async function waitForGeminiGeneration(page, log) {
  log('⏳ Monitoring generation status...');

  // Phase 1: Detect Start (Active Generation)
  try {
    log('   ↳ Phase 1: Waiting for generation to start...');
    await page.waitForFunction(() => {
      const stopBtn = document.querySelector('button[aria-label*="Stop response"]');
      const sendBtn = document.querySelector('button[aria-label*="Send"], button[class*="send"]');
      return !!stopBtn || !sendBtn || sendBtn.disabled;
    }, { timeout: 10000 });
  } catch (e) {
    log('⚠️ Warning: UI didn\'t change state quickly. Prompt might have been ignored.');
  }

  // Phase 2: Wait for Completion
  try {
    log('   ↳ Phase 2: Waiting for Gemini to finish generating (up to 2 mins)...');
    await page.waitForFunction(() => {
      const stopBtn = document.querySelector(
        'button[aria-label*="Stop response"], button[aria-label*="Stop generating"]'
      );
      const sendBtn = document.querySelector(
        'button[aria-label*="Send"], button[aria-label="Send message"], button[class*="send"]'
      );
      return !stopBtn && sendBtn && !sendBtn.disabled;
    }, { timeout: 120000, polling: 3000 }); // 3s polling — 3x fewer DOM queries
  } catch (e) {
    // Button didn't re-enable — but Gemini sometimes leaves it stuck after image generation.
    // Check if an image actually appeared in the DOM before throwing.
    log('   ↳ ⚠️ Send button stuck after 2 min. Checking if image was generated anyway...');
    await page.waitForTimeout(2000); // let DOM settle
    const imgCount = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src^="https"]'))
        .filter(img => { const r = img.getBoundingClientRect(); return r.width > 100 && r.height > 100; })
        .length
    );
    if (imgCount === 0) {
      throw new Error('Generation timed out and no image in DOM. Gemini appears stuck.');
    }
    log(`   ↳ ✅ Image found in DOM (${imgCount} large images). Button stuck but generation completed — continuing.`);
    geminiNeedsRefresh = true; // signal caller to reload page after saving this image
  }

  // Phase 3: Verify Success (Error Detection)
  log('   ↳ Phase 3: Checking for refusal/error messages...');
  const errorCheck = await page.evaluate(() => {
    const modelMsgs = document.querySelectorAll('.model-response-text, .message-content');
    if (modelMsgs.length === 0) return null;

    const lastMsg = modelMsgs[modelMsgs.length - 1];
    const text = lastMsg.innerText.toLowerCase();

    const errorPhrases = [
      "i can't create images",
      "i cannot create images",
      "i'm unable to create",
      "unable to generate an image",
      "can't generate images",
      "cannot generate images",
      "i'm not able to generate",
      // Rate limit phrases — triggers account rotation signal
      "you've reached your image generation limit",
      "your daily limit",
      "generation limit until",
      "image generation limit",
      "try again tomorrow",
      "reached your limit"
      // Removed false-positives: "content policy", "safety guidelines",
      // "policy violation", "prohibited", "you stopped this generation"
      // — these phrases appear in normal Gemini responses and caused double-feeds
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
  log('   ↳ Phase 4: Verifying image presence in DOM...');
  const imageCheck = await page.evaluate(() => {
    const allImages = Array.from(document.querySelectorAll('img[src^="https"]'))
      .filter(img => {
        const rect = img.getBoundingClientRect();
        return rect.width > 100 && rect.height > 100; // lowered from 200 — catches smaller previews too
      });
    return allImages.length > 0;
  });

  if (!imageCheck) {
    throw new Error('No images detected in DOM after generation. Gemini might have skipped or returned text only.');
  } else {
    log('   ↳ ✅ Image generation confirmed visually.');
  }
}
/**
 * Gemini Retry Flow — only generates images for prompts that don't have a file on disk.
 * Useful after a batch run where some images failed or the session was interrupted.
 */
async function runGeminiRetryFlow(log, pageId, localDB, page, options = {}) {
  log('🔁 Starting Gemini Retry Flow (failed/missing images only)...');
  geminiNeedsRefresh = false;

  const saveRoot = localDB.getSetting('image_save_path');
  if (!saveRoot) throw new Error('Please set "Image Save Location" in Settings first.');

  const allPrompts = localDB.getPrompts(pageId).filter(p => !p.isSkipped);
  if (allPrompts.length === 0) {
    log('⚠️ No active prompts found for this page.');
    return;
  }

  const hierarchyPath = localDB.getPageHierarchyPath(pageId);
  const sanitizedPath = hierarchyPath.map(part => part.replace(/[^a-z0-9 ]/gi, '_').substring(0, 50));
  const saveDir = path.join(saveRoot, ...sanitizedPath);
  await fs.ensureDir(saveDir);

  // Filter: only prompts with no file on disk
  const promptsToRetry = allPrompts.filter(prompt => {
    const safeFilename = prompt.content
      .replace(/[^a-z0-9 \-\.]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
    const filePath = path.join(saveDir, `${safeFilename}_${prompt.id}.jpg`);
    return !fs.existsSync(filePath);
  });

  if (promptsToRetry.length === 0) {
    log('✅ All prompts already have images. Nothing to retry!');
    return;
  }

  log(`🔄 Retrying ${promptsToRetry.length} of ${allPrompts.length} prompts (missing images)...`);
  log(`📂 Save directory: ${saveDir}`);

  await page.goto(GEMINI_URL);
  try {
    await page.waitForSelector('.ql-editor, textarea', { timeout: 10000 });
  } catch (e) {
    log('⚠️ Please log in to Gemini manually. Waiting 2 minutes...');
    await page.waitForSelector('.ql-editor, textarea', { timeout: 120000 });
  }

  // Wait for Gemini UI to be interactive (avoids hardcoded 10s sleep)
  log('⏳ Waiting for Gemini to be ready...');
  try {
    await page.waitForFunction(() => {
      const editor = document.querySelector('.ql-editor, textarea');
      const sendBtn = document.querySelector('button[aria-label*="Send"], button[class*="send"]');
      return editor && sendBtn && !sendBtn.disabled;
    }, { timeout: 15000 });
    log('✅ Gemini is ready.');
  } catch (e) {
    log('⚠️ Gemini UI not ready in 15s — proceeding with 2s fallback wait.');
    await page.waitForTimeout(2000);
  }

  // Generation loop — same as main Gemini flow
  const aspectRatio = options.aspectRatio;
  for (let i = 0; i < promptsToRetry.length; i++) {
    if (isStopped) { log('🛑 Stopped by user.'); break; }
    let success = false;
    let attempts = 0;
    while (!success && attempts < 3) {
      if (isStopped) break;
      while (isPaused) {
        if (isStopped) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      if (isStopped) break;
      attempts++;
      const prompt = promptsToRetry[i];
      let finalPromptText = prompt.content;
      if (aspectRatio) finalPromptText += ` --ar ${aspectRatio}`;
      log(`[${i + 1}/${promptsToRetry.length}] Retry attempt ${attempts}: "${prompt.content.substring(0, 30)}..."`);

      // Count images before sending so fallback won't grab the previous prompt's image on failure
      let imageCountBefore = 0;
      try {
        imageCountBefore = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img[src^="https"]'))
            .filter(img => { const r = img.getBoundingClientRect(); return r.width > 100 && r.height > 100; })
            .length
        );
      } catch (e) { /* non-critical */ }

      try {
        await sendToGemini(page, finalPromptText);
        await waitForGeminiGeneration(page, log);
        success = true;
        // Save immediately after each successful retry
        log(`💾 Saving retried image for prompt ${i + 1}/${promptsToRetry.length}...`);
        await page.waitForTimeout(1000); // reduced from 2000ms
        await saveAllBatchedImages(page, [promptsToRetry[i]], saveDir, log, pageId, options, imageCountBefore);
      } catch (err) {
        log(`⚠️ Retry attempt ${attempts} failed: ${err.message}`);

        // Same double-feed prevention as main flow: check disk before re-sending
        const retryPrompt = promptsToRetry[i];
        const safeFilenameCheck = retryPrompt.content
          .replace(/[^a-z0-9 \-\.]/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 100);
        const checkPath = path.join(saveDir, `${safeFilenameCheck}_${retryPrompt.id}.jpg`);
        if (!fs.existsSync(checkPath)) {
          try {
            await page.waitForTimeout(800);
            await saveAllBatchedImages(page, [retryPrompt], saveDir, log, pageId, options, imageCountBefore);
          } catch (saveErr) { /* non-critical */ }
        }
        if (fs.existsSync(checkPath)) {
          success = true;
          log(`✅ Image confirmed on disk despite error. Skipping retry.`);
        } else if (attempts < 3) {
          await page.waitForTimeout(5000);
        }
      }
    }
    if (i < promptsToRetry.length - 1) {
      if (geminiNeedsRefresh) {
        await refreshGeminiIfNeeded(page, log);
      } else {
        await page.waitForTimeout(2000);
      }
    }
  }

  if (isStopped) return;
  log('✅ Retry complete. Images saved incrementally.');
}

module.exports = { runAutomation, setAutomationControl };
