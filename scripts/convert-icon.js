/**
 * Icon conversion script
 * Takes the AI-generated icon PNG, resizes to all needed sizes,
 * saves PNGs for electron-builder, and creates a Windows ICO.
 *
 * Usage: node scripts/convert-icon.js
 */

const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');

const SRC_PNG = path.join(__dirname, '..', 'build', 'icon_source.png');
const BUILD_DIR = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

async function main() {
    if (!fs.existsSync(SRC_PNG)) {
        console.error('❌ Source PNG not found at:', SRC_PNG);
        console.error(
            '   Please copy your source icon to build/icon_source.png first.'
        );
        process.exit(1);
    }

    console.log('🎨 Converting icon to all required sizes...\n');

    const pngBuffers = [];

    for (const size of SIZES) {
        const outPath = path.join(BUILD_DIR, `icon_${size}.png`);
        const buf = await sharp(SRC_PNG)
            .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
            .png()
            .toBuffer();

        await fs.writeFile(outPath, buf);
        pngBuffers.push({ size, buf });
        console.log(`  ✅ ${size}x${size} → icon_${size}.png`);
    }

    // Save the primary 512px as icon.png (used by Linux and as source)
    const png512 = pngBuffers.find((p) => p.size === 512);
    await fs.writeFile(path.join(BUILD_DIR, 'icon.png'), png512.buf);
    console.log('  ✅ icon.png (512x512)');

    // Build a proper ICO file manually (BITMAPFILEHEADER + BITMAPINFOHEADER per entry)
    // ICO format: header + directory entries + PNG data blobs for each size
    const icoSizes = [16, 32, 48, 128, 256];
    const entries = pngBuffers.filter((p) => icoSizes.includes(p.size));

    const HEADER_SIZE = 6;
    const ENTRY_SIZE = 16;
    const directoryOffset = HEADER_SIZE + entries.length * ENTRY_SIZE;

    // Calculate offsets for each image
    let offset = directoryOffset;
    const entryMeta = entries.map(({ size, buf }) => {
        const meta = { size, buf, offset };
        offset += buf.length;
        return meta;
    });

    // Write ICO header
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: ICO
    header.writeUInt16LE(entries.length, 4); // count

    // Write directory entries
    const directory = Buffer.alloc(entries.length * ENTRY_SIZE);
    entryMeta.forEach(({ size, buf, offset: imgOffset }, i) => {
        const base = i * ENTRY_SIZE;
        directory.writeUInt8(size === 256 ? 0 : size, base + 0); // width (0 = 256)
        directory.writeUInt8(size === 256 ? 0 : size, base + 1); // height
        directory.writeUInt8(0, base + 2);                        // color count
        directory.writeUInt8(0, base + 3);                        // reserved
        directory.writeUInt16LE(1, base + 4);                     // color planes
        directory.writeUInt16LE(32, base + 6);                    // bit count
        directory.writeUInt32LE(buf.length, base + 8);            // bytes in resource
        directory.writeUInt32LE(imgOffset, base + 12);            // offset
    });

    const icoBuffer = Buffer.concat([
        header,
        directory,
        ...entryMeta.map((e) => e.buf),
    ]);

    const icoPath = path.join(BUILD_DIR, 'icon.ico');
    await fs.writeFile(icoPath, icoBuffer);
    console.log(`\n✅ icon.ico written (${(icoBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(`   Includes sizes: ${icoSizes.join(', ')}`);
    console.log('\n🎉 Done! Restart the app to see the new icon.');
}

main().catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
