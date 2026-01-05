const fs = require('fs');
const path = require('path');

const size = 512; // square icon size (meets macOS >=512x512 requirement)
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

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    setPixel(x, y, bg);
  }
}

const shaftTop = Math.round(size * 0.18);
const shaftBottom = Math.round(size * 0.72);
const centerX = Math.floor(size / 2);

for (let y = shaftTop; y <= shaftBottom; y++) {
  for (let x = centerX - 2; x <= centerX + 2; x++) {
    setPixel(x, y, accent);
  }
}

const headHeight = Math.round(size * 0.18);
for (let i = 0; i < headHeight; i++) {
  const y = shaftTop - i;
  for (let spread = -i; spread <= i; spread++) {
    setPixel(centerX + spread, y, accent);
  }
}

const baseY = Math.round(size * 0.78);
for (let x = Math.round(size * 0.2); x <= Math.round(size * 0.8); x++) {
  for (let y = baseY; y < baseY + 4; y++) {
    setPixel(x, y, accent);
  }
}

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
console.log(`Generated ${outPath}`);
