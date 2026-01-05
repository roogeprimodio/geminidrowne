const fs = require('fs');
const path = require('path');

// Create a simple 256x256 BMP icon (compatible with Windows NSIS)
const size = 256;
const bg = { r: 8, g: 12, b: 26, a: 255 };
const accent = { r: 111, g: 255, b: 233, a: 255 };

const pixelData = Buffer.alloc(size * size * 4);

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const destY = size - 1 - y; // BMP stores rows bottom-up
  const offset = (destY * size + x) * 4;
  pixelData[offset] = color.b;
  pixelData[offset + 1] = color.g;
  pixelData[offset + 2] = color.r;
  pixelData[offset + 3] = color.a;
}

// Fill background
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    setPixel(x, y, bg);
  }
}

// Draw a simple icon (down arrow)
const shaftTop = Math.round(size * 0.18);
const shaftBottom = Math.round(size * 0.72);
const centerX = Math.floor(size / 2);

// Draw arrow shaft
for (let y = shaftTop; y <= shaftBottom; y++) {
  for (let x = centerX - 2; x <= centerX + 2; x++) {
    setPixel(x, y, accent);
  }
}

// Draw arrow head
const headHeight = Math.round(size * 0.18);
for (let i = 0; i < headHeight; i++) {
  const y = shaftTop - i;
  for (let spread = -i; spread <= i; spread++) {
    setPixel(centerX + spread, y, accent);
  }
}

// Draw base
const baseY = Math.round(size * 0.78);
for (let x = Math.round(size * 0.2); x <= Math.round(size * 0.8); x++) {
  for (let y = baseY; y < baseY + 4; y++) {
    setPixel(x, y, accent);
  }
}

// BMP header (40 byte DIB header)
const header = Buffer.alloc(40);
header.writeUInt32LE(40, 0); // header size
header.writeInt32LE(size, 4); // width
header.writeInt32LE(size, 8); // height (positive for bottom-up)
header.writeUInt16LE(1, 12); // planes
header.writeUInt16LE(32, 14); // bits per pixel
header.writeUInt32LE(0, 16); // compression
header.writeUInt32LE(0, 20); // image size (0 for uncompressed)
header.writeInt32LE(0, 24); // X pixels per meter
header.writeInt32LE(0, 28); // Y pixels per meter
header.writeUInt32LE(0, 32); // colors used
header.writeUInt32LE(0, 36); // important colors

// BMP file header (14 bytes)
const fileHeader = Buffer.alloc(14);
fileHeader.write('BM', 0, 2); // signature
fileHeader.writeUInt32LE(14 + 40 + pixelData.length, 2); // file size
fileHeader.writeUInt32LE(0, 6); // reserved
fileHeader.writeUInt32LE(14 + 40, 10); // offset to pixel data

// Combine headers and pixel data
const bmpData = Buffer.concat([fileHeader, header, pixelData]);

// Ensure build directory exists
const buildDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Write BMP file as ICO (Windows NSIS accepts BMP as ICO)
const iconPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(iconPath, bmpData);
console.log(`Generated ${iconPath}`);
