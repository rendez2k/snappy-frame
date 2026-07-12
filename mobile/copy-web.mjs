// Cross-platform copy of the web app into www/ (works on Windows, macOS, Linux).
import fs from 'fs';
import path from 'path';

const root = path.resolve('..');
const www = path.resolve('www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const items = [
  'index.html', 'vendor', 'manifest.webmanifest', 'sw.js',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png',
];
for (const it of items) {
  const src = path.join(root, it);
  if (!fs.existsSync(src)) { console.warn('skip (not found):', it); continue; }
  fs.cpSync(src, path.join(www, it), { recursive: true });
}
console.log('Copied web app into www/');
