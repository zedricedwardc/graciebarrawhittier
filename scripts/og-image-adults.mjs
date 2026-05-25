// One-off script: generate the OpenGraph social-preview image for the
// Adults Jiu-Jitsu page. Reads a source photo, center-crops to 1200x630,
// and writes a progressive mozjpeg to public/og/adults-jiu-jitsu.jpg.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const src = path.join(
  repoRoot,
  'Website Media',
  'Adults Classes',
  'METADATA',
  'A97A8903.jpg',
);
const out = path.join(repoRoot, 'public', 'og', 'adults-jiu-jitsu.jpg');

await sharp(src)
  .resize(1200, 630, { fit: 'cover', position: 'center' })
  .jpeg({ quality: 82, mozjpeg: true, progressive: true })
  .toFile(out);

console.log(`Wrote ${out}`);
