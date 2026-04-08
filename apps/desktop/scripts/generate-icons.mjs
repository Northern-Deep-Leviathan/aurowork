/**
 * Generate Tauri icon files from the Aurora Flame SVG design.
 * Uses sharp to render SVG → PNG at multiple sizes, plus ICO.
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "src-tauri", "icons");

// Aurora Flame SVG — matching the in-app logo design
// Uses terracotta #C4745B as the brand color on a transparent background
function flameSvg(size) {
  // Scale factor from the 32x32 viewBox
  const s = size / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <path d="M16 3C12.5 8 7 14 7 20a9 9 0 0 0 18 0c0-6-5.5-12-9-17Z" fill="#C4745B" opacity="0.25"/>
  <path d="M16 7C13.5 11 10 15.5 10 20a6 6 0 0 0 12 0c0-4.5-3.5-9-6-13Z" fill="#C4745B" opacity="0.55"/>
  <path d="M16 12C14.5 14.5 13 17 13 20a3 3 0 0 0 6 0c0-3-1.5-5.5-3-8Z" fill="#C4745B"/>
</svg>`;
}

// Rounded-square app icon SVG (macOS/Windows style with background)
function appIconSvg(size) {
  const r = Math.round(size * 0.22); // corner radius ~22%
  const pad = Math.round(size * 0.15); // padding for the flame inside
  const innerSize = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <rect width="${size}" height="${size}" rx="${r}" fill="#FAF9F6"/>
  <rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${r}" stroke="#E8E4DE" stroke-width="1" fill="none"/>
  <g transform="translate(${pad}, ${pad})">
    <svg width="${innerSize}" height="${innerSize}" viewBox="0 0 32 32" fill="none">
      <path d="M16 3C12.5 8 7 14 7 20a9 9 0 0 0 18 0c0-6-5.5-12-9-17Z" fill="#C4745B" opacity="0.25"/>
      <path d="M16 7C13.5 11 10 15.5 10 20a6 6 0 0 0 12 0c0-4.5-3.5-9-6-13Z" fill="#C4745B" opacity="0.55"/>
      <path d="M16 12C14.5 14.5 13 17 13 20a3 3 0 0 0 6 0c0-3-1.5-5.5-3-8Z" fill="#C4745B"/>
    </svg>
  </g>
</svg>`;
}

async function generatePng(svg, outputPath, size) {
  const buffer = Buffer.from(svg);
  await sharp(buffer)
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`  ✓ ${outputPath} (${size}x${size})`);
}

// Simple ICO file generator (single-image ICO)
function createIco(pngBuffers) {
  // ICO format: header + directory entries + image data
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;

  // Calculate offsets
  let offset = headerSize + dirSize;
  const entries = pngBuffers.map((buf, i) => {
    const size = [256, 128, 64, 48, 32, 16][i] || 32;
    const entry = {
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      offset,
      size: buf.length,
    };
    offset += buf.length;
    return entry;
  });

  const totalSize = offset;
  const ico = Buffer.alloc(totalSize);

  // Header
  ico.writeUInt16LE(0, 0);      // Reserved
  ico.writeUInt16LE(1, 2);      // Type: ICO
  ico.writeUInt16LE(numImages, 4); // Number of images

  // Directory entries
  entries.forEach((entry, i) => {
    const pos = headerSize + i * dirEntrySize;
    ico.writeUInt8(entry.width, pos);      // Width
    ico.writeUInt8(entry.height, pos + 1); // Height
    ico.writeUInt8(0, pos + 2);            // Color palette
    ico.writeUInt8(0, pos + 3);            // Reserved
    ico.writeUInt16LE(1, pos + 4);         // Color planes
    ico.writeUInt16LE(32, pos + 6);        // Bits per pixel
    ico.writeUInt32LE(entry.size, pos + 8); // Size of image data
    ico.writeUInt32LE(entry.offset, pos + 12); // Offset to image data
  });

  // Image data
  let writeOffset = headerSize + dirSize;
  pngBuffers.forEach((buf) => {
    buf.copy(ico, writeOffset);
    writeOffset += buf.length;
  });

  return ico;
}

async function main() {
  console.log("Generating AuroWork icons...\n");

  // Generate PNG files with app-icon style (rounded square with background)
  const sizes = [
    { name: "32x32.png", size: 32 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "icon.png", size: 512 },
  ];

  for (const { name, size } of sizes) {
    const svg = appIconSvg(size);
    await generatePng(svg, join(iconsDir, name), size);
  }

  // Generate ICO with multiple sizes
  console.log("\n  Generating icon.ico...");
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];
  for (const size of icoSizes) {
    const svg = appIconSvg(size);
    const buf = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }
  const icoBuffer = createIco(pngBuffers);
  writeFileSync(join(iconsDir, "icon.ico"), icoBuffer);
  console.log(`  ✓ ${join(iconsDir, "icon.ico")} (multi-size)`);

  // Generate dev icon (slightly different tint for dev builds)
  console.log("\n  Generating dev icons...");
  const devDir = join(iconsDir, "dev");
  mkdirSync(devDir, { recursive: true });

  for (const { name, size } of sizes) {
    // Dev icon uses a slightly different shade
    const svg = appIconSvg(size).replace(/#C4745B/g, "#D98B6E").replace(/#FAF9F6/g, "#1A1917").replace(/#E8E4DE/g, "#2E2B27");
    await generatePng(svg, join(devDir, name), size);
  }

  console.log("\n✅ All icons generated successfully!");
}

main().catch(console.error);
