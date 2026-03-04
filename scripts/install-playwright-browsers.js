const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const playwrightPackageRoot = path.dirname(require.resolve('playwright-core/package.json'));
const browsersDir = path.join(playwrightPackageRoot, '.local-browsers');
const playwrightBin = path.join(
  projectRoot,
  'node_modules',
  'playwright-core',
  'cli.js'
);

const spawnArgs = [playwrightBin, 'install', 'chromium'];
const cmd = 'node';

function hasChromium() {
  if (!fs.existsSync(browsersDir)) {
    return false;
  }
  return fs.readdirSync(browsersDir).some(entry => entry.startsWith('chromium-'));
}

if (hasChromium()) {
  console.log('✅ Playwright Chromium browser already present.');
  process.exit(0);
}

console.log('⬇️  Downloading Playwright Chromium browser into the project (bundled with the app)...');
const env = {
  ...process.env,
  // Force Playwright to download into our local directory instead of a global cache
  PLAYWRIGHT_BROWSERS_PATH: browsersDir
};

if (!fs.existsSync(playwrightBin)) {
  console.error(`❌ Could not locate Playwright CLI at ${playwrightBin}. Did you run "npm install"?`);
  process.exit(1);
}

// Download chromium. Playwright natively manages the matching minimal ffmpeg binary for it.
const result = spawnSync(cmd, spawnArgs, {
  stdio: 'inherit',
  env
});

if (result.status !== 0) {
  if (result.error) {
    console.error('\n❌ Failed to download Chromium via Playwright:', result.error);
  } else {
    console.error(`\n❌ Playwright install exited with status ${result.status}.`);
  }
  process.exit(result.status ?? 1);
}

if (hasChromium()) {
  console.log('✅ Chromium downloaded and will be bundled with the installer.');
} else {
  console.warn('⚠️ Chromium download finished but files were not detected. Please rerun the script.');
}
