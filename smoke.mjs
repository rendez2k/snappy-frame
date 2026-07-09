import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'index.html');

// 1x1 red PNG data URL
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{ width:1280, height:800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(url, { waitUntil:'load' });
await page.waitForTimeout(500);

// html-to-image loaded?
const htiLoaded = await page.evaluate(() => typeof window.htmlToImage);
console.log('htmlToImage:', htiLoaded);

// simulate an image load through the app's loader
await page.evaluate(async (RED) => {
  const im = new Image();
  await new Promise(r => { im.onload = r; im.src = RED; });
  const shot = document.getElementById('shot');
  // drive via the same path the file input uses
  const inp = document.getElementById('fileInput');
  // Build a File and dispatch change
  const res = await fetch(RED); const blob = await res.blob();
  const file = new File([blob], 'red.png', { type:'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change'));
}, RED);
await page.waitForTimeout(400);

const hasImage = await page.evaluate(() => document.getElementById('empty').style.display === 'none');
console.log('image loaded / empty hidden:', hasImage);

// exercise a few controls
await page.evaluate(() => {
  document.getElementById('frameType').value='macos-dark';
  document.getElementById('frameType').dispatchEvent(new Event('change'));
  document.getElementById('aspect').value='16:9';
  document.getElementById('aspect').dispatchEvent(new Event('change'));
});
await page.waitForTimeout(300);

// try an export via html-to-image (may need network for the lib, already loaded)
let exportOk=false, exportErr='';
try {
  const blobLen = await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    const blob = await window.htmlToImage.toBlob(stage, { pixelRatio:1, width:stage.offsetWidth, height:stage.offsetHeight, style:{transform:'none'} });
    return blob ? blob.size : 0;
  });
  exportOk = blobLen > 0;
  console.log('export blob bytes:', blobLen);
} catch(e){ exportErr = e.message; }

console.log('exportOk:', exportOk, exportErr);
console.log('ERRORS:', errors.length ? errors : 'none');

await browser.close();
process.exit(errors.length || !hasImage ? 1 : 0);
