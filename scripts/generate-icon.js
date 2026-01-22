const fs = require('fs');
const path = require('path');

const size = 256;
const bg = { r: 8, g: 12, b: 26, a: 255 };
const cyan = { r: 111, g: 255, b: 233, a: 255 };
const purple = { r: 127, g: 0, b: 255, a: 255 };

const pixelData = Buffer.alloc(size * size * 4);

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const destY = size - 1 - y;
  const offset = (destY * size + x) * 4;
  pixelData[offset] = color.b;
  pixelData[offset + 1] = color.g;
  pixelData[offset + 2] = color.r;
  pixelData[offset + 3] = color.a;
}

// Background
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    setPixel(x, y, bg);
  }
}

function drawCircle(cx, cy, radius, thickness, color) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (Math.abs(dist - radius) < thickness / 2) {
        setPixel(x, y, color);
      }
    }
  }
}

// Draw two interlocking circles (Gemini)
drawCircle(size * 0.4, size * 0.5, size * 0.25, 8, cyan);
drawCircle(size * 0.6, size * 0.5, size * 0.25, 8, purple);

// Draw 'G' shape (simplified)
const centerX = size / 2;
const centerY = size / 2;
const gRadius = size * 0.12;
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
    // Draw arc for G
    const angle = Math.atan2(y - centerY, x - centerX);
    if (Math.abs(dist - gRadius) < 4 && (angle < -0.4 || angle > 0.4)) {
      setPixel(x, y, cyan);
    }
    // Draw middle bar for G
    if (y >= centerY - 2 && y <= centerY + 2 && x >= centerX && x <= centerX + gRadius) {
      setPixel(x, y, cyan);
    }
  }
}

// BMP/ICO packaging...
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(1, 4);

const andMaskRowBytes = Math.ceil(size / 32) * 4;
const andMask = Buffer.alloc(andMaskRowBytes * size);

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);
bmpHeader.writeInt32LE(size, 4);
bmpHeader.writeInt32LE(size * 2, 8);
bmpHeader.writeUInt16LE(1, 12);
bmpHeader.writeUInt16LE(32, 14);
bmpHeader.writeUInt32LE(0, 16);
bmpHeader.writeUInt32LE(pixelData.length + andMask.length, 20);
bmpHeader.writeInt32LE(0, 24);
bmpHeader.writeInt32LE(0, 28);
bmpHeader.writeUInt32LE(0, 32);
bmpHeader.writeUInt32LE(0, 36);

const bytesInRes = bmpHeader.length + pixelData.length + andMask.length;
const entry = Buffer.alloc(16);
entry[0] = size;
entry[1] = size;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(bytesInRes, 8);
entry.writeUInt32LE(head.length + entry.length, 12);

const icoBuffer = Buffer.concat([head, entry, bmpHeader, pixelData, andMask]);
const outPath = path.join(__dirname, '..', 'build', 'icon.ico');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, icoBuffer);
console.log(`Generated premium redesigned icon at ${outPath}`);
