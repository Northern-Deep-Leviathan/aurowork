/**
 * Generate Tauri icon files from the Aurora Flame SVG design.
 * Uses sharp to render SVG → PNG at multiple sizes, plus ICO.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "src-tauri", "icons");
const logoSourcePath = join(iconsDir, "logo-template.svg");
const webPublicDir = join(__dirname, "..", "..", "app", "public");

function logoImageHref() {
  const sourceSvg = readFileSync(logoSourcePath, "utf8");
  const match = sourceSvg.match(/xlink:href="([^"]+)"/);

  if (!match) {
    throw new Error(`Unable to find embedded image data in ${logoSourcePath}`);
  }

  return match[1].replace(/\s+/g, "");
}

const logoHref = logoImageHref();

// AuroWork mark — sourced from icons/logo-template.svg so generated icons match it.
function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 980 985" fill="none">
  <image width="980" height="985" x="0" y="0" xlink:href="${logoHref}"/>
</svg>`;
}

// Transparent-background variant (e.g. for in-app monochrome use)
function flameSvg(size) {
  return markSvg(size);
}

// App icon SVG — full-bleed circular mark (no rounded-square frame).
function appIconSvg(size) {
  return markSvg(size);
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

// ICNS file generator (Apple Icon Image format, PNG-based chunks).
// Spec: 8-byte header ("icns" + total BE size), then typed chunks
// (4-byte OSType + 4-byte BE size + PNG data). Modern macOS reads PNG payloads
// directly, so we don't need RGBA-encoded chunks. Works cross-platform —
// no `iconutil` required.
//
// chunks: array of { type: 4-char string, png: Buffer }
function createIcns(chunks) {
  const HEADER = 8;
  const CHUNK_HEADER = 8;
  let totalSize = HEADER;
  for (const { png } of chunks) totalSize += CHUNK_HEADER + png.length;

  const out = Buffer.alloc(totalSize);
  out.write("icns", 0, "ascii");
  out.writeUInt32BE(totalSize, 4);

  let offset = HEADER;
  for (const { type, png } of chunks) {
    out.write(type, offset, "ascii");
    out.writeUInt32BE(CHUNK_HEADER + png.length, offset + 4);
    png.copy(out, offset + CHUNK_HEADER);
    offset += CHUNK_HEADER + png.length;
  }
  return out;
}

// Map each ICNS chunk type to its rendered pixel size. Modern macOS readers
// pick from this set when displaying app icons across DPI/contexts.
const ICNS_CHUNKS = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 }, // 512@2x
  { type: "ic11", size: 32 },   // 16@2x
  { type: "ic12", size: 64 },   // 32@2x
  { type: "ic13", size: 256 },  // 128@2x
  { type: "ic14", size: 512 },  // 256@2x
];

async function buildIcnsFromSvg(svgFn) {
  const chunks = [];
  for (const { type, size } of ICNS_CHUNKS) {
    const png = await sharp(Buffer.from(svgFn(size)))
      .resize(size, size)
      .png()
      .toBuffer();
    chunks.push({ type, png });
  }
  return createIcns(chunks);
}

async function main() {
  console.log("Generating AuroWork icons...\n");

  // Generate PNG files with app-icon style
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

  // Generate ICNS (macOS) — both production and dev variants.
  console.log("\n  Generating icon.icns...");
  const icnsBuffer = await buildIcnsFromSvg(appIconSvg);
  writeFileSync(join(iconsDir, "icon.icns"), icnsBuffer);
  console.log(`  ✓ ${join(iconsDir, "icon.icns")} (multi-size)`);

  console.log("\n  Generating icon-dev.icns...");
  const icnsDevBuffer = await buildIcnsFromSvg(markSvg);
  writeFileSync(join(iconsDir, "icon-dev.icns"), icnsDevBuffer);
  console.log(`  ✓ ${join(iconsDir, "icon-dev.icns")} (multi-size)`);

  // Generate dev icons
  console.log("\n  Generating dev icons...");
  const devDir = join(iconsDir, "dev");
  mkdirSync(devDir, { recursive: true });

  for (const { name, size } of sizes) {
    const svg = markSvg(size);
    await generatePng(svg, join(devDir, name), size);
  }

  // Publish the canonical SVG + favicon PNGs to the web app's public dir so the
  // SolidJS <AuroWorkLogo> component and browser favicons stay in sync with
  // the desktop icon source of truth.
  console.log("\n  Publishing web assets to apps/app/public...");
  mkdirSync(webPublicDir, { recursive: true });
  copyFileSync(logoSourcePath, join(webPublicDir, "aurowork-logo.svg"));
  copyFileSync(logoSourcePath, join(webPublicDir, "aurowork-logo-square.svg"));
  console.log(`  ✓ ${join(webPublicDir, "aurowork-logo.svg")}`);
  console.log(`  ✓ ${join(webPublicDir, "aurowork-logo-square.svg")}`);

  const faviconSizes = [
    { name: "favicon-16x16.png", size: 16 },
    { name: "favicon-32x32.png", size: 32 },
    { name: "apple-touch-icon.png", size: 180 },
  ];
  for (const { name, size } of faviconSizes) {
    const svg = markSvg(size);
    await generatePng(svg, join(webPublicDir, name), size);
  }

  console.log("\n✅ All icons generated successfully!");
}

main().catch(console.error);
