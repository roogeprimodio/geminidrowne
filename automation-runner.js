const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const CHATGPT_URL = 'https://chatgpt.com/';
const GEMINI_URL = 'https://gemini.google.com/app';

const BASE_PROMPT = `You are a current-affairs visual prompt writer with MEMORY across this session.

SESSION RULES (VERY IMPORTANT):

1. The FIRST script I provide = Batch 1 → numbering starts from 1.1
2. The SECOND script I provide = Batch 2 → numbering MUST start from 2.1
3. The THIRD script I provide = Batch 3 → numbering MUST start from 3.1
4. Continue incrementing batch numbers automatically for every new script.
5. NEVER ask me for the batch number — you must infer it from order.

DUPLICATE SAFETY CHECK (MANDATORY):


and always gimme in copyable block all per prompt 


6. Before generating prompts, ALWAYS compare the new script with ALL previous scripts from this session.
7. If the script is IDENTICAL or SUBSTANTIALLY THE SAME as a previous one:
   - STOP generation immediately
   - Notify me clearly:
     "⚠️ This script appears to be already used (matches Batch X). Please confirm or provide a new script."
   - Do NOT generate any prompts until I respond.

OUTPUT RULES (STRICT):

8. For each valid new script:
   - Generate ONE SINGLE BATCH
   - Use CONTINUOUS NUMBERING ONLY within that batch:
     Format: BATCHNUMBER.1, BATCHNUMBER.2, BATCHNUMBER.3 …
   - Each prompt must be in its OWN SEPARATE BLOCK
   - The numbering is PART of the prompt text

IMAGE CONTENT RULES (NON-NEGOTIABLE):

9. Ultra-realistic, news-documentary, editorial visuals only.
10. ABSOLUTELY NO TEXT inside images:
    - no words
    - no letters
    - no numbers
    - no banners
    - no signage
    - no logos
    - no watermarks
11. Ensure all people, flags, buildings, protests, or symbols contain NOTHING readable.

STYLE RULES:

12. Cinematic lighting, realistic textures, natural colors.
13. Exam-safe, factual, neutral visuals.
14. No fantasy, no illustration, no artistic abstraction.
15. No explanations, no headings, no commentary.

MANDATORY ENDING:

16. EVERY prompt must end with EXACTLY:
    aspect ratio 1:1

BEGIN CONDITION:

17. Start generating ONLY after receiving a new, non-duplicate script.`;

let chatGPTBrowser = null;
let chatGPTPage = null;
let geminiBrowser = null;
let geminiPage = null;

async function launchFreshBrowser(existing, label) {
  if (existing?.browser) {
    try {
      // Keep the browser instance but close non-essential pages
      const pages = await existing.browser.pages();
      for (const page of pages) {
        const url = page.url();
        // Only keep pages that are not new tabs and are relevant to our service
        if (!url.includes('newtab') && 
            !url.includes('chrome://') && 
            !url.includes('edge://') &&
            !url.includes('about:blank')) {
          // This might be our target page, keep it
          continue;
        }
        await page.close();
      }
      
      // Get the remaining pages and use the first non-blank one
      const remainingPages = await existing.browser.pages();
      if (remainingPages.length > 0) {
        const targetPage = remainingPages.find(p => 
          !p.url().includes('about:blank') && 
          !p.url().includes('newtab')
        ) || remainingPages[0];
        
        // Bring the target page to front
        await targetPage.bringToFront();
        return { browser: existing.browser, page: targetPage };
      }
      
      return existing;
    } catch (error) {
      console.warn(`Error reusing ${label} browser:`, error.message);
      await existing.browser.close();
    }
  }

  // Launch with persistent user data directory
  const userDataDir = path.join(app.getPath('userData'), 'browser-profiles', label.toLowerCase());
  await fs.ensureDir(userDataDir);

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 50,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    viewport: { width: 1200, height: 800 }
  });

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(120000); // 2 minute timeout
  return { browser, page };
}

async function ensureChatGPTSession(log) {
  ({ browser: chatGPTBrowser, page: chatGPTPage } = await launchFreshBrowser(
    { browser: chatGPTBrowser },
    'ChatGPT'
  ));
  log('🌐 Opening ChatGPT...');
  await chatGPTPage.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
  
  // Quick check if already logged in
  const currentUrl = chatGPTPage.url();
  log(`📍 Current URL after navigation: ${currentUrl}`);
  
  // Debug: Check what's actually on the page
  const pageDebug = await chatGPTPage.evaluate(() => {
    const title = document.title;
    const url = window.location.href;
    const hasTextarea = !!document.querySelector('textarea');
    const hasContentEditable = !!document.querySelector('[contenteditable="true"]');
    const hasInput = !!document.querySelector('input[type="text"]');
    const hasAnyInput = hasTextarea || hasContentEditable || hasInput;
    return { title, url, hasTextarea, hasContentEditable, hasInput, hasAnyInput };
  });
  
  log(`🔍 Page debug: ${JSON.stringify(pageDebug)}`);
  
  if (!currentUrl.includes('auth.openai.com') && !currentUrl.includes('login')) {
    // More permissive check - if we're not on auth pages and have any input, assume logged in
    if (pageDebug.hasAnyInput) {
      log('✅ Already logged in to ChatGPT (input area detected)');
      return chatGPTPage;
    }
    
    // Even if no input found, if we're on chatgpt.com domain, try to proceed
    if (currentUrl.includes('chatgpt.com') || currentUrl.includes('chat.openai.com')) {
      log('⚠️ On ChatGPT domain but no input detected, proceeding anyway...');
      return chatGPTPage;
    }
  }
  
  log('ℹ️ Login required, please sign in to ChatGPT...');
  
  // Wait longer for login (5 minutes)
  const loginTimeout = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();
  
  while (Date.now() - startTime < loginTimeout) {
    try {
      const currentUrl = chatGPTPage.url();
      
      // Check if we're still in auth flow
      if (currentUrl.includes('auth.openai.com') || currentUrl.includes('login')) {
        log('ℹ️ Still in authentication flow, waiting...');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      // Check if we're on the actual chat interface
      const isChatInterface = await chatGPTPage.evaluate(() => {
        const textarea = document.querySelector('textarea');
        return textarea && textarea.offsetParent !== null && 
               !window.location.href.includes('auth.openai.com');
      });
      
      if (isChatInterface) {
        log('✅ Successfully loaded ChatGPT interface');
        return chatGPTPage;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  throw new Error('Login timeout. Please log in and try again.');
}

async function ensureGeminiSession(log) {
  ({ browser: geminiBrowser, page: geminiPage } = await launchFreshBrowser(
    { browser: geminiBrowser },
    'Gemini'
  ));
  log('🌐 Opening Gemini...');
  await geminiPage.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
  
  // Quick check if already logged in
  const currentUrl = geminiPage.url();
  log(`📍 Current URL after navigation: ${currentUrl}`);
  
  // Debug: Check what's actually on the page
  const pageDebug = await geminiPage.evaluate(() => {
    const title = document.title;
    const url = window.location.href;
    const hasTextarea = !!document.querySelector('textarea');
    const hasContentEditable = !!document.querySelector('[contenteditable="true"]');
    const hasInput = !!document.querySelector('input[type="text"]');
    const hasAnyInput = hasTextarea || hasContentEditable || hasInput;
    return { title, url, hasTextarea, hasContentEditable, hasInput, hasAnyInput };
  });
  
  log(`🔍 Page debug: ${JSON.stringify(pageDebug)}`);
  
  if (!currentUrl.includes('accounts.google.com') && !currentUrl.includes('login')) {
    // More permissive check - if we're not on auth pages and have any input, assume logged in
    if (pageDebug.hasAnyInput) {
      log('✅ Already logged in to Gemini (input area detected)');
      return geminiPage;
    }
    
    // Even if no input found, if we're on gemini domain, try to proceed
    if (currentUrl.includes('gemini.google.com')) {
      log('⚠️ On Gemini domain but no input detected, proceeding anyway...');
      return geminiPage;
    }
  }
  
  log('ℹ️ Login required, please sign in to Gemini...');
  
  // Wait longer for login (5 minutes)
  const loginTimeout = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();
  
  while (Date.now() - startTime < loginTimeout) {
    try {
      const currentUrl = geminiPage.url();
      
      // Check if we're still in auth flow
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('login')) {
        log('ℹ️ Still in authentication flow, waiting...');
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      // Check if we're on the actual chat interface
      const isChatInterface = await geminiPage.evaluate(() => {
        const textarea = document.querySelector('textarea');
        const contenteditable = document.querySelector('[contenteditable="true"]');
        const element = textarea || contenteditable;
        return element && element.offsetParent !== null && 
               !window.location.href.includes('accounts.google.com');
      });
      
      if (isChatInterface) {
        log('✅ Successfully loaded Gemini interface');
        return geminiPage;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  throw new Error('Login timeout. Please log in and try again.');
}

async function submitMessage(page, text, label, log) {
  log('🔍 Searching for input area...');
  
  // Debug: log current URL
  const currentUrl = page.url();
  log(`📍 Current page: ${currentUrl}`);
  
  // Ensure we're not on login page
  if (currentUrl.includes('auth.openai.com') || currentUrl.includes('login')) {
    throw new Error('Still on login page. Please complete authentication first.');
  }
  
  // Use the same robust detection as runChatGPTBatch
  const inputElements = await page.evaluate(() => {
    const elements = [];
    const selectors = ['textarea', '[contenteditable="true"]', 'div[role="textbox"]'];
    
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        elements.push({
          selector,
          visible: rect.width > 0 && rect.height > 0,
          enabled: !el.disabled,
          display: style.display,
          opacity: style.opacity,
          offsetParent: !!el.offsetParent,
          rect: { width: rect.width, height: rect.height },
          id: el.id,
          className: el.className
        });
      });
    });
    
    return elements;
  });
  
  log(`🔍 Found ${inputElements.length} potential input elements: ${JSON.stringify(inputElements)}`);
  
  // Find the best candidate
  const bestElement = inputElements.find(el => 
    el.visible && el.enabled && el.display !== 'none' && el.opacity > 0
  );
  
  if (!bestElement) {
    throw new Error('Could not find any usable input area. Please ensure ChatGPT interface is fully loaded.');
  }
  
  // Build selector for the best element
  let targetSelector = bestElement.selector;
  if (bestElement.id) {
    targetSelector = `#${bestElement.id}`;
  } else if (bestElement.className) {
    const firstClass = bestElement.className.split(' ')[0];
    targetSelector = `.${firstClass}`;
  }
  
  log(`✅ Using input area: ${targetSelector}`);
  
  const target = await page.$(targetSelector);
  if (!target) {
    throw new Error(`Failed to locate element with selector: ${targetSelector}`);
  }
  
  // Focus and interact
  await target.focus();
  await page.waitForTimeout(300);
  await target.click();
  await page.waitForTimeout(300);
  
  // Clear any existing text and paste the entire text at once
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  
  // Use clipboard to paste the entire text (much faster for long prompts)
  await page.evaluate((textToPaste) => {
    navigator.clipboard.writeText(textToPaste);
  }, text);
  
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  
  // Send the message
  await page.keyboard.press('Enter');
  log(`✉️ Sent ${label}. Waiting for response...`);
}

async function waitForChatGPTResponse(page, previousCount, log) {
  const assistantSelector = '[data-message-author-role="assistant"]';
  let responseDetected = false;
  let responseText = '';
  let startTime = Date.now();
  const maxWaitTime = 180000; // 3 minutes max wait
  
  log('⏳ Waiting for AI response...');
  
  // Multiple detection strategies running in parallel
  const detectionStrategies = [
    // Strategy 1: Look for typing/stop indicators
    async () => {
      try {
        // Look for any typing indicators
        const typingSelectors = [
          '[data-testid="stop-button"]',
          'button[aria-label*="Stop"]',
          'button[aria-label*="stop"]',
          '.result-thinking',
          '.streaming',
          '[data-message-generation-status]',
          '.animate-pulse'
        ];
        
        for (const selector of typingSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              const isVisible = await element.isVisible();
              if (isVisible) {
                log(`🤖 AI typing detected via: ${selector}`);
                // Wait for it to disappear (response complete)
                await page.waitForSelector(selector, { state: 'detached', timeout: maxWaitTime });
                log('✅ AI finished typing');
                return true;
              }
            }
          } catch (e) {
            // Continue trying other selectors
          }
        }
      } catch (e) {
        log('⚡ No typing indicators found');
      }
      return false;
    },
    
    // Strategy 2: Monitor DOM changes for new messages
    async () => {
      try {
        const initialCount = await page.evaluate(() => {
          return document.querySelectorAll('[data-message-author-role="assistant"], .markdown, .prose, .whitespace-pre-wrap').length;
        });
        
        // Wait for new content to appear
        await page.waitForFunction(
          (initialCount) => {
            const currentCount = document.querySelectorAll('[data-message-author-role="assistant"], .markdown, .prose, .whitespace-pre-wrap').length;
            return currentCount > initialCount;
          },
          initialCount,
          { timeout: maxWaitTime }
        );
        
        log('📝 New message content detected');
        return true;
      } catch (e) {
        log('⚡ DOM change detection failed');
        return false;
      }
    },
    
    // Strategy 3: Check for network activity completion
    async () => {
      try {
        // Wait for network to be idle
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        log('🌐 Network activity completed');
        return true;
      } catch (e) {
        log('⚡ Network check failed');
        return false;
      }
    }
  ];
  
  // Run detection strategies with timeout
  while (Date.now() - startTime < maxWaitTime && !responseDetected) {
    try {
      // Check if any strategy detected completion
      for (let i = 0; i < detectionStrategies.length; i++) {
        try {
          const detected = await detectionStrategies[i]();
          if (detected) {
            responseDetected = true;
            break;
          }
        } catch (e) {
          // Strategy failed, continue with others
        }
      }
      
      if (responseDetected) break;
      
      // Brief pause before retrying
      await page.waitForTimeout(1000);
      
      // Check for error messages or policy violations
      const errorCheck = await page.evaluate(() => {
        const errorSelectors = [
          '[data-testid="error"]',
          '.error-message',
          '.warning',
          '[role="alert"]',
          '.prose p:contains("unable")',
          '.prose p:contains("cannot")',
          '.prose p:contains("policy")'
        ];
        
        for (const selector of errorSelectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            return element.innerText || element.textContent;
          }
        }
        return null;
      });
      
      if (errorCheck) {
        log(`⚠️ Detected error/policy message: ${errorCheck.substring(0, 100)}...`);
        throw new Error(`ChatGPT error: ${errorCheck}`);
      }
      
    } catch (e) {
      if (e.message.includes('ChatGPT error')) {
        throw e; // Re-throw ChatGPT errors
      }
      log(`⚡ Detection attempt failed: ${e.message}`);
    }
  }
  
  // Extract response text using multiple methods
  log('🔍 Extracting response text...');
  
  const extractionMethods = [
    // Method 1: Standard assistant selector
    async () => {
      try {
        const elements = await page.$$(assistantSelector);
        if (elements.length > previousCount) {
          const lastElement = elements[elements.length - 1];
          return await lastElement.innerText();
        }
      } catch (e) {
        // Continue to next method
      }
      return null;
    },
    
    // Method 2: Multiple content selectors
    async () => {
      const selectors = ['.markdown', '.prose', '.whitespace-pre-wrap', '[data-message-author-role]'];
      for (const selector of selectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            const lastElement = elements[elements.length - 1];
            const text = await lastElement.innerText();
            if (text && text.trim().length > 20) {
              return text;
            }
          }
        } catch (e) {
          // Continue trying
        }
      }
      return null;
    },
    
    // Method 3: Page content extraction
    async () => {
      try {
        return await page.evaluate(() => {
          // Get the last substantial text content
          const allElements = document.querySelectorAll('*');
          let lastSubstantialText = '';
          
          for (const element of allElements) {
            const text = element.innerText || element.textContent;
            if (text && text.trim().length > 50) {
              lastSubstantialText = text.trim();
            }
          }
          
          return lastSubstantialText;
        });
      } catch (e) {
        return null;
      }
    }
  ];
  
  // Try extraction methods
  for (const method of extractionMethods) {
    try {
      const text = await method();
      if (text && text.trim().length > 0) {
        responseText = text.trim();
        log('📝 Response extracted successfully');
        break;
      }
    } catch (e) {
      log(`⚡ Extraction method failed: ${e.message}`);
    }
  }
  
  // Final wait to ensure rendering is complete
  await page.waitForTimeout(2000);
  
  if (!responseText) {
    log('⚠️ Could not extract response text, but continuing...');
    responseText = 'Response captured but text extraction failed';
  }
  
  const elapsedTime = Date.now() - startTime;
  log(`✅ Response captured in ${Math.round(elapsedTime / 1000)}s`);
  
  return responseText;
}

async function waitForGeminiResponse(page) {
  await page.waitForTimeout(1500);
  try {
    await page.waitForSelector('button[aria-label="Stop"]', { state: 'attached', timeout: 1000 });
    await page.waitForSelector('button[aria-label="Stop"]', { state: 'detached', timeout: 90000 });
  } catch (_) {
    // ignore if stop button never appeared
  }
  await page.waitForTimeout(1200);
}

async function runChatGPTBatch({ scripts, log, onResult }) {
  log(`📊 Received ${scripts ? scripts.length : 0} scripts to process`);
  
  if (!scripts || scripts.length === 0) {
    throw new Error('No scripts are available for ChatGPT.');
  }
  
  // Debug: Log script details
  scripts.forEach((script, index) => {
    log(`📝 Script ${index + 1}: "${script.scriptName}" - ${script.script ? script.script.length : 0} characters`);
  });

  const page = await ensureChatGPTSession(log);
  const assistantSelector = '[data-message-author-role="assistant"]';

  log('📋 Injecting session base prompt.');
  
  // Robust input area detection with multiple attempts
  let inputFound = false;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (!inputFound && attempts < maxAttempts) {
    try {
      attempts++;
      log(`🔍 Attempt ${attempts}/${maxAttempts} to find input area...`);
      
      // Wait a bit for page to stabilize
      await page.waitForTimeout(2000);
      
      // Try to find any input element that's actually usable
      const inputElements = await page.evaluate(() => {
        const elements = [];
        const selectors = ['textarea', '[contenteditable="true"]', 'div[role="textbox"]'];
        
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            elements.push({
              selector,
              visible: rect.width > 0 && rect.height > 0,
              enabled: !el.disabled,
              display: style.display,
              opacity: style.opacity,
              offsetParent: !!el.offsetParent,
              rect: { width: rect.width, height: rect.height }
            });
          });
        });
        
        return elements;
      });
      
      log(`🔍 Found ${inputElements.length} potential input elements: ${JSON.stringify(inputElements)}`);
      
      // Find the best candidate
      const bestElement = inputElements.find(el => 
        el.visible && el.enabled && el.display !== 'none' && el.opacity > 0
      );
      
      if (bestElement) {
        inputFound = true;
        log(`✅ Found usable input: ${bestElement.selector}`);
        break;
      }
      
      if (attempts < maxAttempts) {
        log(`⏳ No usable input found, retrying in 3 seconds...`);
        await page.waitForTimeout(3000);
      }
    } catch (error) {
      log(`⚠️ Error during input detection attempt ${attempts}: ${error.message}`);
      if (attempts < maxAttempts) {
        await page.waitForTimeout(3000);
      }
    }
  }
  
  if (!inputFound) {
    throw new Error('Could not find any usable input area after multiple attempts. Please ensure ChatGPT interface is fully loaded.');
  }
  
  const initialCount = await page.locator(assistantSelector).count();
  
  try {
    await submitMessage(page, BASE_PROMPT, 'base prompt', log);
    const baseResponse = await waitForChatGPTResponse(page, initialCount, log);
    log('🧠 Session memory primed.');
    log(`📝 Base response length: ${baseResponse.length} characters`);
  } catch (error) {
    log(`❌ Error during base prompt processing: ${error.message}`);
    throw new Error(`Failed to process base prompt: ${error.message}`);
  }

  // Process each script sequentially
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    log(`🔄 Processing script ${i + 1}/${scripts.length}: ${script.scriptName}`);
    
    try {
      const countBefore = await page.locator(assistantSelector).count();
      await submitMessage(page, script.script, script.batchLabel, log);
      
      log(`⏳ Waiting for AI response to ${script.batchLabel}...`);
      const response = await waitForChatGPTResponse(page, countBefore, log);
      
      log(`✅ Received response for ${script.batchLabel} (${response.length} characters)`);
      
      if (typeof onResult === 'function') {
        await onResult({ ...script, response });
      }
      
      // Brief pause between scripts to avoid overwhelming the AI
      if (i < scripts.length - 1) {
        log('⏸️ Brief pause before next script...');
        await page.waitForTimeout(2000);
      }
    } catch (error) {
      log(`❌ Error processing script ${script.scriptName}: ${error.message}`);
      throw new Error(`Failed to process script "${script.scriptName}": ${error.message}`);
    }
  }

  log('✅ ChatGPT batch finished. Window left open for review.');
}

async function runGeminiReplay({ prompts, log }) {
  if (!prompts || prompts.length === 0) {
    throw new Error('No prompts available for Gemini replay.');
  }

  const page = await ensureGeminiSession(log);

  for (const prompt of prompts) {
    await submitMessage(page, prompt.response, prompt.batchLabel, log);
    await waitForGeminiResponse(page);
  }

  log('✅ Gemini replay finished. Window left open for manual review.');
}

module.exports = {
  runChatGPTBatch,
  runGeminiReplay,
  BASE_PROMPT
};
