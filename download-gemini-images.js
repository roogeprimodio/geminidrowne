const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'gemini_images');

function createLogger(callback) {
  return message => {
    if (callback) {
      callback(message);
    }
    console.log(message);
  };
}

function createErrorLogger(callback) {
  return message => {
    if (callback) {
      callback(message);
    }
    console.error(message);
  };
}

async function ensureDirectoryExists(directory, log, logError) {
  try {
    await fs.ensureDir(directory);
    log(`✅ Output directory ready: ${directory}`);
  } catch (error) {
    logError(`❌ Failed to create directory: ${error.message}`);
    throw error;
  }
}

async function scrollPageToBottom(page, log) {
  log('🔄 Scrolling to load all content...');
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = 0;
      let consecutiveStops = 0;
      const maxConsecutiveStops = 5; // Wait for 5 stable scroll events (2.5 seconds total)

      const interval = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollTo(0, scrollHeight);
        const newHeight = document.body.scrollHeight;

        if (newHeight === lastHeight) {
          consecutiveStops++;
        } else {
          consecutiveStops = 0;
        }

        if (consecutiveStops >= maxConsecutiveStops) {
          console.log('✅ Finished scrolling.');
          clearInterval(interval);
          resolve();
        }

        lastHeight = newHeight;
      }, 500);
    });
  });
}

async function extractPromptsAndImages(page, log) {
  log('🔍 Extracting prompts and images from the chat...');

  return await page.evaluate(() => {
    const debug_logs = [];
    const results = [];

    const textSelectors = ['div', 'section', 'article', 'span', 'p', 'li'];
    const promptElements = [];

    textSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const text = (el.innerText || '').trim();
        if (!text) return;
        const match = text.match(/^(\d+\.\d+)\s+(.+)/s);
        if (match) {
          const rect = el.getBoundingClientRect();
          promptElements.push({
            number: match[1],
            text: match[2].trim(),
            top: rect.top,
            elementTextLength: text.length
          });
        }
      });
    });

    debug_logs.push(`[Debug] Found ${promptElements.length} prompt candidates.`);

    const imageElements = Array.from(document.querySelectorAll('img[src]'))
      .filter(img => img.src && !img.src.startsWith('data:'))
      .map(img => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.src.trim(),
          top: rect.top,
          height: rect.height
        };
      });

    debug_logs.push(`[Debug] Found ${imageElements.length} image nodes.`);

    if (promptElements.length === 0) {
      debug_logs.push('[Debug] No prompt candidates were detected. Dumping sample class names for analysis:');
      const classes = new Set();
      document.querySelectorAll('div').forEach(el => el.classList.forEach(cls => classes.add(cls)));
      debug_logs.push(...Array.from(classes).slice(0, 200));
      return { results, debug_logs };
    }

    const sortedPrompts = promptElements.sort((a, b) => a.top - b.top);
    const sortedImages = imageElements.sort((a, b) => a.top - b.top);

    sortedImages.forEach((image, index) => {
      const priorPrompts = sortedPrompts.filter(prompt => prompt.top <= image.top + 10);
      const associatedPrompt = priorPrompts[priorPrompts.length - 1];

      if (!associatedPrompt) {
        debug_logs.push(`[Debug] Image ${index + 1} (top=${image.top}) has no preceding prompt.`);
        return;
      }

      const folderName = `${associatedPrompt.number}_${associatedPrompt.text}`
        .replace(/[^\w\s.-]/g, ' ')
        .replace(/\s+/g, '_')
        .trim()
        .substring(0, 150);

      const promptImageCount = results.filter(r => r.promptText === associatedPrompt.text).length + 1;

      results.push({
        url: image.src,
        promptText: associatedPrompt.text,
        folderName,
        imageNumber: promptImageCount
      });
    });

    debug_logs.push(`[Debug] Associated ${results.length} images with prompts.`);
    return { results, debug_logs };
  });
}

async function downloadImage(imageData, log, baseDir = DEFAULT_OUTPUT_DIR) {
  const { url, promptText, folderName, imageNumber } = imageData;
  try {
    const safeFolderName = folderName.replace(/[^\w\s.-]/g, '_').replace(/\s+/g, '_');
    const folderPath = path.join(baseDir, safeFolderName);

    await fs.ensureDir(folderPath);

    const extension = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';
    // Use the folder name for the image file, adding an index if it's not the first image.
    const filenameBase = folderName.substring(0, 150);
    const filename = imageNumber > 1 ? `${filenameBase}_${imageNumber}${extension}` : `${filenameBase}${extension}`;
    const filePath = path.join(folderPath, filename);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));

    // Save the prompt as a text file if it doesn't exist
    const promptFilePath = path.join(folderPath, 'prompt.txt');
    if (!fs.existsSync(promptFilePath)) {
      await fs.writeFile(promptFilePath, promptText);
    }

    log(`✅ Downloaded: ${safeFolderName}/${filename}`);
    return true;
  } catch (error) {
    log(`❌ Error downloading ${url}: ${error.message}`);
    return false;
  }
}

async function promptForGeminiUrl() {
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question('🔗 Enter the Gemini share URL: ')).trim();
  rl.close();
  return answer;
}

async function runDownloader(geminiUrl, options = {}) {
  const log = createLogger(options.onLog);
  const logError = createErrorLogger(options.onError || options.onLog);
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;

  log(`🌐 Opening: ${geminiUrl}`);
  await ensureDirectoryExists(outputDir, log, logError);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      bypassCSP: true,
      permissions: ['clipboard-read', 'clipboard-write']
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    await context.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.google.com/'
    });

    const page = await context.newPage();

    await page.route('**/*', route => route.continue());

    log('🚀 Navigating to the chat...');

    try {
      await page.goto(geminiUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      // Check if we're on a login page or if there's an error
      const pageTitle = await page.title();
      const pageUrl = page.url();
      console.log(`📄 Page title: ${pageTitle}`);
      console.log(`🔗 Current URL: ${pageUrl}`);
      
      if (pageUrl.includes('accounts.google.com') || pageTitle.toLowerCase().includes('sign in')) {
        throw new Error('❌ Authentication required. Google Gemini requires you to be signed in to view this chat.');
      }
      
      // Handle potential cookie consent banners before waiting for content.
      try {
        console.log('👀 Looking for a cookie consent banner...');
        const acceptButton = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
        await acceptButton.click({ timeout: 5000 });
        console.log('✅ Clicked the consent button.');
        await page.waitForLoadState('domcontentloaded');
      } catch (e) {
        console.log('ℹ️ No cookie consent banner found or it was not clickable.');
      }

      // Wait for a stable element (like the footer) to ensure the page is loaded.
      console.log('⏳ Waiting for page to finish loading...');
      try {
        await page.waitForSelector('text="Your privacy & Gemini Apps"', { timeout: 60000 });
        console.log('✅ Page loaded. Giving chat content a moment to render...');
        // Add a final small wait for the dynamic content to render in.
        await page.waitForTimeout(5000);
      } catch (timeoutError) {
        console.error('❌ Timed out waiting for page to load. The page structure might have changed or there is a network issue.');
        await page.screenshot({ path: path.join(outputDir, 'timeout_error.png') });
        console.log('📸 A screenshot has been saved to timeout_error.png to help debug.');
        throw timeoutError; // Re-throw the error to stop the script.
      }

      // Take a screenshot for debugging
      await page.screenshot({ path: path.join(outputDir, 'page_screenshot.png') });
      console.log('📸 Took a screenshot of the page for debugging: page_screenshot.png');
      
    } catch (error) {
      console.error('❌ Error loading the page:', error.message);
      console.log('\n⚠️  NOTE: Google Gemini chats may require authentication or may not be accessible programmatically.');
      console.log('Please try the following:');
      console.log('1. Open the chat in your regular browser and make sure you\'re signed in');
      console.log('2. Check if the chat is set to public access');
      console.log('3. Try using the --browser flag: npx playwright install --with-deps');
      throw error;
    }
    
    // Scroll to load all lazy-loaded images
    console.log('🔄 Scrolling to load all content...');
    await scrollPageToBottom(page, log);
    
    // A final brief pause to ensure last images are rendered.
    console.log('⏳ Final wait for images to render...');
    await page.waitForTimeout(3000);
    console.log('✅ Ready to extract.');
    
    // Try to find any load more buttons and click them
    try {
      const loadMoreButton = await page.$('button:has-text("Load more"), button:has-text("Show more")');
      if (loadMoreButton) {
        console.log('🔘 Found "Load more" button, clicking...');
        await loadMoreButton.click();
        await page.waitForTimeout(2000);
        await scrollPageToBottom(page, log);
      }
    } catch (e) {
      console.log('ℹ️ No "Load more" button found or clickable');
    }
    
    // Extract prompts and images
    const { results: imageData, debug_logs } = await extractPromptsAndImages(page, log);
    console.log('--- Browser-side Debug Logs ---');
    debug_logs.forEach(log => console.log(log));
    console.log('-----------------------------');
    
    if (imageData.length === 0) {
      console.log('ℹ️ No images with prompts were successfully extracted. Check debug logs for details.');
      return;
    }
    
    console.log(`📸 Found ${imageData.length} images with prompts to download`);
    
    // Download each image
    let successCount = 0;
    for (let i = 0; i < imageData.length; i++) {
      const data = imageData[i];
      console.log(`⬇️  Downloading image ${i + 1}/${imageData.length}: ${data.folderName}`);
      const success = await downloadImage(data, log, outputDir);
      if (success) successCount++;
      
      // Be nice to the server
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`\n🎉 Download complete!`);
    console.log(`✅ Successfully downloaded ${successCount} out of ${imageData.length} images`);
    console.log(`📁 Images saved to: ${path.resolve(outputDir)}`);
    
  } catch (error) {
    logError('❌ An error occurred: ' + error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let geminiUrl = args[0];

  if (!geminiUrl) {
    geminiUrl = await promptForGeminiUrl();
    if (!geminiUrl) {
      console.error('❌ No Gemini chat URL provided. Exiting.');
      process.exit(1);
    }
  }

  await runDownloader(geminiUrl);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runDownloader
};