const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');
const { createCanvas } = require('canvas');

async function generateIcon() {
  // Create a canvas for drawing
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  
  // Set background
  ctx.fillStyle = '#080c1a';
  ctx.fillRect(0, 0, 256, 256);
  
  // Draw accent color (down arrow)
  ctx.fillStyle = '#6fffe9';
  
  const shaftTop = Math.round(256 * 0.18);
  const shaftBottom = Math.round(256 * 0.72);
  const centerX = 128;
  
  // Draw arrow shaft
  ctx.fillRect(centerX - 2, shaftTop, 5, shaftBottom - shaftTop + 1);
  
  // Draw arrow head
  const headHeight = Math.round(256 * 0.18);
  for (let i = 0; i < headHeight; i++) {
    const y = shaftTop - i;
    ctx.fillRect(centerX - i, y, i * 2 + 1, 1);
  }
  
  // Draw base
  const baseY = Math.round(256 * 0.78);
  ctx.fillRect(Math.round(256 * 0.2), baseY, Math.round(256 * 0.6), 4);
  
  // Convert canvas to PNG buffer
  const pngBuffer = canvas.toBuffer('image/png');
  
  // Convert PNG to ICO
  const icoBuffer = await pngToIco(pngBuffer);
  
  // Ensure build directory exists
  const buildDir = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // Write ICO file
  const iconPath = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(iconPath, icoBuffer);
  console.log(`Generated ${iconPath}`);
  
  // Also create a PNG version for macOS
  const pngPath = path.join(buildDir, 'icon.png');
  fs.writeFileSync(pngPath, pngBuffer);
  console.log(`Generated ${pngPath}`);
}

generateIcon().catch(console.error);
