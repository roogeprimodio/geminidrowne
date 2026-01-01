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
    const hasInput = !!document.querySelector('input');
    const hasAnyInput = hasTextarea || hasContentEditable || hasInput;
    return { title, url, hasTextarea, hasContentEditable, hasInput, hasAnyInput };
  });
  
  log(`🔍 Page debug: ${JSON.stringify(pageDebug)}`);
  
  if (pageDebug.hasAnyInput) {
    log('✅ Already logged in to ChatGPT (input area detected)');
    return chatGPTPage;
  } else {
    log('❌ Not logged in to ChatGPT (no input area found)');
    throw new Error('Not logged in to ChatGPT. Please sign in first.');
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

async function submitMessageForGemini(page, message, messageLabel, log) {
  log(`📝 Submitting ${messageLabel}...`);
  
  try {
    // STEP 0: Check if page is still valid
    if (page.isClosed()) {
      throw new Error('Gemini page was closed');
    }
    
    // STEP 1: DOM Stability Check - Ensure page is ready
    await page.waitForTimeout(1000);
    
    // Verify we're on Gemini page
    const currentUrl = page.url();
    if (!currentUrl.includes('gemini.google.com')) {
      throw new Error('Not on Gemini page');
    }
    
    // STEP 2: Wait for Send button to be available (ensures previous request is complete)
    log('🔍 Waiting for Send button availability...');
    let sendButtonReady = false;
    
    for (let i = 0; i < 15; i++) {
      try {
        const sendButtonAvailable = await page.evaluate(() => {
          const sendSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            '[data-test-id*="send"]',
            '[data-testid*="send"]',
            'button[type="submit"]'
          ];
          
          return sendSelectors.some(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).some(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && 
                       style.display !== 'none' && 
                       style.visibility !== 'hidden' &&
                       !el.disabled;
              });
            } catch (e) {
              return false;
            }
          });
        });
        
        if (sendButtonAvailable) {
          sendButtonReady = true;
          log('✅ Send button is available - ready to submit');
          break;
        }
        
        if (i % 3 === 0) {
          log(`⏳ Still waiting for Send button... (${i + 1}/15)`);
        }
        
        await page.waitForTimeout(1000);
      } catch (e) {
        log(`⚡ Send button check failed: ${e.message}`);
        await page.waitForTimeout(1000);
      }
    }
    
    if (!sendButtonReady) {
      log('⚠️ Send button not ready, proceeding anyway...');
    }
    
    // STEP 3: Find and clear input area
    const inputSelectors = [
      'textarea[placeholder*="Enter a prompt here"]',
      'textarea[aria-label*="Enter a prompt"]',
      'textarea[aria-label*="prompt"]',
      'textarea[placeholder*="prompt"]',
      'textarea',
      'div[contenteditable="true"]',
      '[data-test-id*="prompt"]',
      '[data-testid*="prompt"]',
      '.prompt-textarea',
      '#prompt-textarea'
    ];

    let inputElement = null;
    let selectorUsed = '';

    for (const selector of inputSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            inputElement = element;
            selectorUsed = selector;
            break;
          }
        }
      } catch (e) {
        // Continue trying other selectors
      }
    }

    if (!inputElement) {
      throw new Error('Could not find Gemini input area');
    }

    log(`🎯 Found input using selector: ${selectorUsed}`);

    // STEP 4: Clear input completely (prevent ghost text)
    log('🧹 Clearing input area...');
    
    // Click to focus
    await inputElement.click();
    await page.waitForTimeout(500);
    
    // Clear using multiple methods
    try {
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(200);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
    } catch (e) {
      log('⚡ Keyboard clear failed, trying alternative...');
    }
    
    // Alternative clear method
    try {
      await inputElement.evaluate(el => el.value = '');
      await page.waitForTimeout(200);
    } catch (e) {
      log('⚡ Value clear failed, continuing...');
    }
    
    // Verify input is clear
    const isInputClear = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element && (!element.value || element.value.trim() === '');
    }, selectorUsed);
    
    if (!isInputClear) {
      log('⚠️ Input may not be completely clear, proceeding anyway...');
    }

    // STEP 5: Paste full prompt at once (faster and more reliable)
    log('📋 Pasting full prompt at once...');
    
    // Use clipboard to paste the entire text at once
    await page.evaluate((textToPaste) => {
      navigator.clipboard.writeText(textToPaste);
    }, message);
    
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500);

    // STEP 6: Submit with SINGLE Enter press and double-click prevention
    log('📤 Submitting message with single Enter...');
    
    // Wait a bit before submitting to prevent double-entry
    await page.waitForTimeout(1000);
    
    // Use Enter key instead of button to avoid double-click issues
    await page.keyboard.press('Enter');
    
    // Wait to ensure submission was processed
    await page.waitForTimeout(1500);
    
    // Verify submission was successful by checking for Stop button or generation indicators
    const clickVerified = await page.evaluate(() => {
      const stopSelectors = [
        'button[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        '[data-test-id*="stop"]',
        '[data-testid*="stop"]'
      ];
      
      return stopSelectors.some(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).some(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden';
          });
        } catch (e) {
          return false;
        }
      });
    });
    
    if (clickVerified) {
      log('✅ Submit verified - Stop button appeared');
    } else {
      log('⚠️ Submit could not be verified, but continuing...');
    }

    log(`✅ ${messageLabel} submitted successfully`);
    
  } catch (error) {
    log(`❌ Error submitting ${messageLabel}: ${error.message}`);
    throw error;
  }
}

async function extractResponseText(page) {
  try {
    // Method 1: Try to get the last assistant message
    const assistantSelector = '[data-message-author-role="assistant"]';
    const elements = await page.$$(assistantSelector);
    if (elements.length > 0) {
      const lastElement = elements[elements.length - 1];
      const text = await lastElement.innerText();
      if (text && text.trim().length > 20) {
        return text.trim();
      }
    }
    
    // Method 2: Try multiple content selectors
    const selectors = ['.markdown', '.prose', '.whitespace-pre-wrap'];
    for (const selector of selectors) {
      const elements = await page.$$(selector);
      if (elements.length > 0) {
        const lastElement = elements[elements.length - 1];
        const text = await lastElement.innerText();
        if (text && text.trim().length > 20) {
          return text.trim();
        }
      }
    }
    
    // Method 3: Get page content and find substantial text
    return await page.evaluate(() => {
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
  } catch (error) {
    return null;
  }
}

async function waitForChatGPTResponse(page, previousCount, log) {
  const assistantSelector = '[data-message-author-role="assistant"]';
  let responseDetected = false;
  let responseText = '';
  let startTime = Date.now();
  const maxWaitTime = 120000; // 2 minutes max wait
  
  // Multiple detection strategies
  const detectionStrategies = [
    // Strategy 1: Look for new assistant messages
    async () => {
      try {
        const elements = await page.$$(assistantSelector);
        return elements.length > previousCount;
      } catch (e) {
        return false;
      }
    },
    
    // Strategy 2: Check for typing indicators
    async () => {
      try {
        const typingIndicators = await page.$$('.result-thinking, .cursor-blink, [data-testid="thinking"]');
        return typingIndicators.length > 0;
      } catch (e) {
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
          '[role="alert"]'
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
  log('⏳ Waiting for Gemini to complete image generation...');
  let startTime = Date.now();
  const maxWaitTime = 300000; // 5 minutes max wait
  
  try {
    // Check if page is still valid
    if (page.isClosed()) {
      throw new Error('Gemini page was closed');
    }
    
    // STEP 0: DOM Stability Check - Ensure page is ready
    log('🔍 Checking DOM stability...');
    await page.waitForTimeout(2000); // Brief wait for DOM to settle
    
    // Verify URL is stable and page is ready
    const currentUrl = page.url();
    if (!currentUrl.includes('gemini.google.com')) {
      throw new Error('Not on Gemini page');
    }
    
    // STEP 1: Wait for "Working" State - Stop button appears
    log('🔍 Waiting for Gemini to start working (Stop button to appear)...');
    let stopButtonAppeared = false;
    let safetyFilterTriggered = false;
    
    // Wait up to 30 seconds for stop button to appear
    for (let i = 0; i < 30; i++) {
      try {
        // Check for safety filter trigger FIRST
        const safetyFilterDetected = await page.evaluate(() => {
          const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
          const lastMessage = messageContainers[messageContainers.length - 1];
          
          if (lastMessage) {
            const text = lastMessage.textContent || '';
            return text.includes('stopped this response') || 
                   text.includes('safety filter') ||
                   text.includes('content policy') ||
                   text.includes('unable to generate') ||
                   text.includes('cannot generate');
          }
          
          return false;
        });
        
        if (safetyFilterDetected) {
          safetyFilterTriggered = true;
          log('⚠️ Safety filter triggered - response was stopped');
          break;
        }
        
        // Look for the Stop button using exact Gemini patterns
        const stopButtonVisible = await page.evaluate(() => {
          // Exact Gemini stop button selectors based on your analysis
          const stopSelectors = [
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label="Stop generation"]',
            'button[aria-label="stop generation"]',
            '[data-test-id*="stop"]',
            '[data-testid*="stop"]',
            // Also look for button that changed from Send to Stop
            'button:not([aria-label*="Send"]):not([aria-label*="send"])'
          ];
          
          return stopSelectors.some(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).some(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && 
                       style.display !== 'none' && 
                       style.visibility !== 'hidden';
              });
            } catch (e) {
              return false;
            }
          });
        });
        
        if (stopButtonVisible) {
          stopButtonAppeared = true;
          log('🤖 Gemini is currently working - Stop button detected');
          break;
        }
        
        // Also check for "Generating images..." text
        const generatingTextVisible = await page.evaluate(() => {
          const elements = document.querySelectorAll('*');
          return Array.from(elements).some(el => {
            const text = el.textContent || '';
            return text.includes('Generating images') || 
                   text.includes('Generating') || 
                   text.includes('Processing') ||
                   text.includes('Working');
          });
        });
        
        if (generatingTextVisible) {
          stopButtonAppeared = true;
          log('🤖 Gemini is currently working - "Generating" text detected');
          break;
        }
        
        if (i % 5 === 0) {
          log(`⏳ Still waiting for Stop button to appear... (${i + 1}/30)`);
        }
        
        await page.waitForTimeout(1000);
      } catch (e) {
        log(`⚡ Stop button check failed: ${e.message}`);
        await page.waitForTimeout(1000);
      }
    }
    
    if (safetyFilterTriggered) {
      log('⚠️ Safety filter triggered - waiting before retry...');
      await page.waitForTimeout(5000); // Wait before retry
      throw new Error('Safety filter triggered - response was stopped');
    }
    
    if (!stopButtonAppeared) {
      log('⚠️ Stop button never appeared, waiting minimum time anyway...');
      await page.waitForTimeout(15000); // 15 seconds minimum
    }
    
    // STEP 2: Monitor "Working" State - Wait for Stop button to disappear
    log('⏳ Monitoring Gemini working state (waiting for Stop button to disappear)...');
    let stopButtonDisappeared = false;
    let noStopButtonCount = 0;
    const requiredNoStopButtonCount = 3; // Need 3 consecutive checks with no stop button
    
    while (!stopButtonDisappeared && (Date.now() - startTime) < maxWaitTime) {
      try {
        // Check for safety filter during generation
        const safetyFilterDuringGeneration = await page.evaluate(() => {
          const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
          const lastMessage = messageContainers[messageContainers.length - 1];
          
          if (lastMessage) {
            const text = lastMessage.textContent || '';
            return text.includes('stopped this response') || 
                   text.includes('safety filter') ||
                   text.includes('content policy');
          }
          
          return false;
        });
        
        if (safetyFilterDuringGeneration) {
          log('⚠️ Safety filter triggered during generation');
          throw new Error('Safety filter triggered during generation');
        }
        
        const stopButtonStillVisible = await page.evaluate(() => {
          const stopSelectors = [
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]',
            'button[aria-label="Stop generation"]',
            'button[aria-label="stop generation"]',
            '[data-test-id*="stop"]',
            '[data-testid*="stop"]'
          ];
          
          return stopSelectors.some(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).some(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && 
                       style.display !== 'none' && 
                       style.visibility !== 'hidden';
              });
            } catch (e) {
              return false;
            }
          });
        });
        
        if (!stopButtonStillVisible) {
          noStopButtonCount++;
          log(`✅ Stop button disappeared (${noStopButtonCount}/${requiredNoStopButtonCount})`);
          
          if (noStopButtonCount >= requiredNoStopButtonCount) {
            stopButtonDisappeared = true;
            log('✅ Stop button disappeared - generation finished');
          }
        } else {
          noStopButtonCount = 0; // Reset counter
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (elapsed % 10 === 0) {
            log(`⏳ Still working... (${elapsed}s elapsed)`);
          }
        }
        
        await page.waitForTimeout(2000); // Check every 2 seconds
        
      } catch (e) {
        log(`⚡ Working state check failed: ${e.message}`);
        await page.waitForTimeout(2000);
      }
    }
    
    if (!stopButtonDisappeared) {
      log('⚠️ Stop button never disappeared, proceeding anyway...');
    }
    
    // STEP 3: Verify "Finished" State - Send button returned and Image result appeared
    log('🔍 Verifying finished state (Send button returned and images generated)...');
    let sendButtonReturned = false;
    let imagesGenerated = false;
    let verificationCount = 0;
    const requiredVerificationCount = 3;
    
    while ((!sendButtonReturned || !imagesGenerated) && verificationCount < 10 && (Date.now() - startTime) < maxWaitTime) {
      try {
        // Final safety filter check
        const finalSafetyCheck = await page.evaluate(() => {
          const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
          const lastMessage = messageContainers[messageContainers.length - 1];
          
          if (lastMessage) {
            const text = lastMessage.textContent || '';
            return text.includes('stopped this response') || 
                   text.includes('safety filter') ||
                   text.includes('content policy');
          }
          
          return false;
        });
        
        if (finalSafetyCheck) {
          log('⚠️ Safety filter detected in final check');
          throw new Error('Safety filter triggered - response was stopped');
        }
        
        // Check for Send button (indicates finished state)
        const sendButtonVisible = await page.evaluate(() => {
          const sendSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            '[data-test-id*="send"]',
            '[data-testid*="send"]',
            'button[type="submit"]'
          ];
          
          return sendSelectors.some(selector => {
            try {
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).some(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && 
                       style.display !== 'none' && 
                       style.visibility !== 'hidden' &&
                       !el.disabled;
              });
            } catch (e) {
              return false;
            }
          });
        });
        
        // Check for generated images in the latest message
        const hasImages = await page.evaluate(() => {
          // Target the last message container specifically (as per your pro-tip)
          const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
          const lastMessage = messageContainers[messageContainers.length - 1];
          
          if (lastMessage) {
            const images = lastMessage.querySelectorAll('img');
            return Array.from(images).some(img => {
              const src = img.getAttribute('src');
              return src && (src.startsWith('blob:') || src.startsWith('http') || src.startsWith('data:'));
            });
          }
          
          // Fallback: look for any images with valid src
          const allImages = document.querySelectorAll('img');
          return Array.from(allImages).some(img => {
            const src = img.getAttribute('src');
            return src && (src.startsWith('blob:') || src.startsWith('http') || src.startsWith('data:'));
          });
        });
        
        if (sendButtonVisible) {
          sendButtonReturned = true;
          log('✅ Send button returned');
        }
        
        if (hasImages) {
          imagesGenerated = true;
          log('✅ Images generated successfully');
        }
        
        verificationCount++;
        
        if (sendButtonReturned && imagesGenerated) {
          log('✅ Both conditions met - generation complete');
          break;
        }
        
        if (verificationCount % 2 === 0) {
          log(`⏳ Verification check ${verificationCount}/10 - Send: ${sendButtonReturned}, Images: ${imagesGenerated}`);
        }
        
        await page.waitForTimeout(2000); // Check every 2 seconds
        
      } catch (e) {
        log(`⚡ Finished state check failed: ${e.message}`);
        await page.waitForTimeout(2000);
      }
    }
    
    // STEP 4: Final verification and safety wait
    log('🔍 Final verification...');
    
    // Check page is still valid
    if (page.isClosed()) {
      throw new Error('Gemini page was closed during processing');
    }
    
    // Final safety filter check
    const finalSafetyFilterCheck = await page.evaluate(() => {
      const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
      const lastMessage = messageContainers[messageContainers.length - 1];
      
      if (lastMessage) {
        const text = lastMessage.textContent || '';
        return text.includes('stopped this response') || 
               text.includes('safety filter') ||
               text.includes('content policy');
      }
      
      return false;
    });
    
    if (finalSafetyFilterCheck) {
      log('⚠️ Safety filter detected in final verification');
      throw new Error('Safety filter triggered - response was stopped');
    }
    
    // Final check for images in last message
    const finalImageCheck = await page.evaluate(() => {
      const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
      const lastMessage = messageContainers[messageContainers.length - 1];
      
      if (lastMessage) {
        const images = lastMessage.querySelectorAll('img');
        return images.length > 0;
      }
      
      return false;
    });
    
    if (!finalImageCheck) {
      log('⚠️ No images found in final check');
    }
    
    // Final safety wait
    log('🛡️ Final safety wait: 5 seconds...');
    await page.waitForTimeout(5000);
    
    const elapsedTime = Date.now() - startTime;
    log(`✅ Gemini image generation completed in ${Math.round(elapsedTime / 1000)}s`);
    
  } catch (error) {
    log(`❌ Error waiting for Gemini response: ${error.message}`);
    // Check if page was closed
    if (page.isClosed()) {
      throw new Error('Gemini page was closed during processing');
    }
    await page.waitForTimeout(5000);
    throw error;
  }
}

async function runGeminiReplay({ prompts, log }) {
  if (!prompts || prompts.length === 0) {
    throw new Error('No prompts available for Gemini replay.');
  }

  const geminiPage = await ensureGeminiSession(log);
  log(`🎯 Processing ${prompts.length} individual prompts through Gemini`);

  // Process each prompt one by one with proper waiting
  for (let i = 0; i < prompts.length; i++) {
    // Check if page is still valid before processing each prompt
    if (geminiPage.isClosed()) {
      throw new Error('Gemini page was closed during processing');
    }
    
    const prompt = prompts[i];
    log(`🔄 Processing Gemini prompt ${i + 1}/${prompts.length}: ${prompt.batchLabel}`);
    
    try {
      // Send the prompt directly to Gemini (already extracted from file)
      log(`🎨 Sending to Gemini: ${prompt.response.substring(0, 50)}...`);
      
      await submitMessageForGemini(geminiPage, prompt.response, prompt.batchLabel, log);
      log(`⏳ Waiting for Gemini to generate response...`);
      
      // Wait for Gemini response with better detection
      await waitForGeminiResponse(geminiPage);
      
      // Verify we actually got a response (text or image)
      const hasResponse = await geminiPage.evaluate(() => {
        const messageContainers = document.querySelectorAll('.message, .response, [data-message-id], [data-test-id*="conversation-turn"], mat-card');
        const lastMessage = messageContainers[messageContainers.length - 1];
        
        if (lastMessage) {
          const text = lastMessage.textContent || '';
          const images = lastMessage.querySelectorAll('img');
          const hasText = text.trim().length > 10;
          const hasImages = images.length > 0;
          
          // Check for safety filter messages
          const isSafetyFilter = text.includes('stopped this response') || 
                               text.includes('safety filter') ||
                               text.includes('content policy') ||
                               text.includes('unable to generate') ||
                               text.includes('cannot generate');
          
          return (hasText || hasImages) && !isSafetyFilter;
        }
        
        return false;
      });
      
      if (!hasResponse) {
        log('⚠️ No valid response received, waiting before continuing...');
        await geminiPage.waitForTimeout(5000);
      } else {
        log(`✅ Gemini completed response for ${prompt.batchLabel}`);
      }
      
      // MANDATORY delay between prompts to ensure completion
      if (i < prompts.length - 1) {
        log('⏸️ Extended delay before next prompt (ensuring image generation completion)...');
        await geminiPage.waitForTimeout(15000); // 15 seconds
        log('✅ Extended delay completed, ready for next prompt');
      }
      
    } catch (error) {
      log(`❌ Error processing ${prompt.batchLabel}: ${error.message}`);
      
      // Check if page was closed
      if (geminiPage.isClosed()) {
        throw new Error('Gemini page was closed during processing');
      }
      
      // Even on error, wait before continuing
      if (i < prompts.length - 1) {
        log('⏸️ Error delay before next prompt...');
        await geminiPage.waitForTimeout(15000);
      }
    }
  }

  log('✅ All Gemini prompts processed successfully.');
  log('🎉 Gemini replay finished! Window left open for manual review.');
}

// Helper function to extract prompts (same as in renderer.js)
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
  
  return prompts;
}

async function extractPromptsFromChat(chatUrl, log) {
  log(`🔗 Extracting prompts from ChatGPT chat: ${chatUrl}`);
  
  const { browser: chatGPTBrowser, page: chatGPTPage } = await launchFreshBrowser(
    { browser: chatGPTBrowser },
    'ChatGPT'
  );
  
  try {
    await chatGPTPage.goto(chatUrl, { waitUntil: 'domcontentloaded' });
    log('📍 Chat page loaded');
    
    // Wait for content to load
    await chatGPTPage.waitForTimeout(3000);
    
    // Extract all prompts from the entire chat (both user messages and any numbered content)
    const prompts = await chatGPTPage.evaluate(() => {
      const promptElements = [];
      
      // Look for all content that could be prompts
      const allMessages = document.querySelectorAll('[data-message-author-role="user"], .prose, .markdown, [data-message-author-role="assistant"]');
      
      allMessages.forEach((element, index) => {
        const text = element.innerText || element.textContent;
        if (text && text.trim().length > 10) {
          // Check if this looks like a prompt (has script-like content)
          const isPrompt = text.includes('script:') || 
                          text.includes('Video Title') || 
                          text.includes('YouTube') ||
                          text.includes('MCQs') ||
                          /^\d+\.\d+\s/.test(text.trim()) ||
                          (text.includes('Batch') && text.includes('script:'));
          
          if (isPrompt) {
            promptElements.push({
              index: index + 1,
              text: text.trim()
            });
          }
        }
      });
      
      return promptElements;
    });
    
    log(`📝 Found ${prompts.length} prompts in chat`);
    
    // Format prompts exactly as requested (preserve numbering and structure)
    const formattedPrompts = prompts.map(prompt => {
      // Check if prompt already has numbering (like "1.1", "2.1", etc.)
      const hasNumbering = /^\d+\.\d+\s/.test(prompt.text);
      
      if (hasNumbering) {
        return prompt.text; // Keep as-is if already numbered
      } else {
        // Add numbering if not present
        return `${prompt.index}.1 ${prompt.text}`;
      }
    });
    
    log('✅ Prompts extracted and formatted successfully');
    return formattedPrompts;
    
  } catch (error) {
    log(`❌ Error extracting prompts: ${error.message}`);
    throw new Error(`Failed to extract prompts: ${error.message}`);
  } finally {
    // Don't close the browser, leave it for user
    log('🔗 Chat window left open for reference');
  }
}

async function saveExtractedPrompts(prompts, log) {
  log('💾 Saving extracted prompts as new subsections...');
  
  // This would integrate with your automation store
  // For now, return the prompts to be handled by the UI
  const newSubsections = prompts.map((prompt, index) => ({
    scriptName: `Extracted Prompt ${index + 1}`,
    script: prompt,
    batchLabel: `Extracted ${index + 1}.1`,
    processed: false,
    response: null
  }));
  
  log(`✅ Created ${newSubsections.length} new subsections`);
  return newSubsections;
}

// Simple string similarity function (Levenshtein distance based)
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 100.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return ((longer.length - editDistance) / longer.length) * 100;
}

// Calculate Levenshtein distance
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Validate scripts for duplicates and empty content
async function validateScripts(scripts, log) {
  const validation = {
    duplicates: [],
    empty: [],
    total: scripts.length,
    valid: 0
  };
  
  // Check for empty scripts
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    if (!script.script || script.script.trim().length === 0) {
      validation.empty.push({
        scriptName: script.scriptName,
        index: i
      });
    }
  }
  
  // Check for duplicates
  for (let i = 0; i < scripts.length; i++) {
    for (let j = i + 1; j < scripts.length; j++) {
      const script1 = scripts[i];
      const script2 = scripts[j];
      
      // Skip if either is empty
      if (!script1.script || !script2.script || 
          script1.script.trim().length === 0 || 
          script2.script.trim().length === 0) {
        continue;
      }
      
      const similarity = calculateSimilarity(
        script1.script.toLowerCase().trim(),
        script2.script.toLowerCase().trim()
      );
      
      // Consider 70%+ as potential duplicate
      if (similarity >= 70) {
        validation.duplicates.push({
          scriptName: script2.scriptName,
          originalScriptName: script1.scriptName,
          percentage: Math.round(similarity),
          index: j,
          originalIndex: i
        });
      }
    }
  }
  
  validation.valid = validation.total - validation.empty.length;
  
  return validation;
}

async function runChatGPTBatch({ scripts, log, onResult }) {
  log(`📊 Processing ${scripts ? scripts.length : 0} scripts`);
  
  if (!scripts || scripts.length === 0) {
    throw new Error('No scripts are available for ChatGPT.');
  }

  // Pre-validation checks
  log('🔍 Running pre-validation checks...');
  const validation = await validateScripts(scripts, log);
  
  if (validation.duplicates.length > 0) {
    log(`⚠️ Found ${validation.duplicates.length} potential duplicates`);
    for (const dup of validation.duplicates) {
      log(`📋 Script "${dup.scriptName}" is ${dup.percentage}% similar to "${dup.originalScriptName}"`);
    }
  }
  
  if (validation.empty.length > 0) {
    log(`⚠️ Found ${validation.empty.length} empty scripts`);
    for (const empty of validation.empty) {
      log(`📋 Script "${empty.scriptName}" is empty`);
    }
  }

  // Filter out empty scripts
  const validScripts = scripts.filter(script => 
    script.script && script.script.trim().length > 0
  );

  log(`✅ ${validScripts.length} valid scripts ready for ChatGPT`);

  const page = await ensureChatGPTSession(log);
  const assistantSelector = '[data-message-author-role="assistant"]';

  log('📋 Injecting session base prompt.');
  
  // Find input area and inject base prompt
  const initialCount = await page.locator(assistantSelector).count();
  
  try {
    await submitMessage(page, BASE_PROMPT, 'base prompt', log);
    const baseResponse = await waitForChatGPTResponse(page, initialCount, log);
    log('🧠 Session memory primed.');
  } catch (error) {
    log(`❌ Error during base prompt processing: ${error.message}`);
    throw new Error(`Failed to process base prompt: ${error.message}`);
  }

  // Process each script sequentially in the same chat
  let processedCount = 0;
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    
    // Skip empty scripts
    if (!script.script || script.script.trim().length === 0) {
      log(`⏭️ Skipping ${script.scriptName} - empty content`);
      continue;
    }
    
    processedCount++;
    log(`🔄 Processing ${script.scriptName} (${processedCount}/${validScripts.length})`);
    
    try {
      const countBefore = await page.locator(assistantSelector).count();
      await submitMessage(page, script.script, script.scriptName, log);
      
      log(`⏳ Waiting for AI response...`);
      const response = await waitForChatGPTResponse(page, countBefore, log);
      
      log(`✅ Response received for ${script.scriptName}`);
      
      if (typeof onResult === 'function') {
        await onResult({ ...script, response });
      }
      
      // Longer pause between scripts to let ChatGPT process
      if (i < scripts.length - 1) {
        log(`⏸️ Waiting before next script...`);
        await page.waitForTimeout(5000); // 5 seconds instead of 2
      }
    } catch (error) {
      log(`❌ Error processing ${script.scriptName}: ${error.message}`);
    }
  }

  log('✅ All scripts processed successfully.');
  log('🎉 Ready for prompt extraction from chat.');
  
  // Return completion status for UI to handle
  return {
    success: true,
    completed: true,
    message: 'All scripts processed. Provide ChatGPT chat link for prompt extraction.',
    scriptsProcessed: scripts.length
  };
}

module.exports = {
  runChatGPTBatch,
  runGeminiReplay,
  extractPromptsFromChat,
  saveExtractedPrompts,
  BASE_PROMPT
};
