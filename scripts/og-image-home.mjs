// Generates the OpenGraph social-preview image for the Home page.
// Run: node scripts/og-image-home.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const src = path.join(repoRoot, 'Website Media', 'HOme metadata', 'A97A5437.jpg');
const outDir = path.join(repoRoot, 'public', 'og');
const out = path.join(outDir, 'home.jpg');

fs.mkdirSync(outDir, { recursive: true });

await sharp(src)
  .resize(1200, 630, { fit: 'cover', position: 'center' })
  .jpeg({ quality: 82, mozjpeg: true, progressive: true })
  .toFile(out);

const { size } = fs.statSync(out);
console.log(`Wrote ${out} (${(size / 1024).toFixed(1)} KB)`);
