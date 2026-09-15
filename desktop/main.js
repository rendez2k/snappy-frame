// Snappy Snap — rapid marquee screen capture (tray app).
// Hotkey → freeze the screen under the cursor → drag a rectangle → save to a
// folder + copy to clipboard (raw, no frame), or open it in Snappy Frame.
const { app, BrowserWindow, globalShortcut, desktopCapturer, screen, clipboard,
  nativeImage, Tray, Menu, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  hotkey: 'CommandOrControl+Shift+1',
  windowHotkey: 'CommandOrControl+Shift+2',        // grab the active window instantly (no marquee)
  markupHotkey: 'CommandOrControl+Shift+3',        // grab a region then open the mark-up editor
  batchHotkey: 'CommandOrControl+Shift+5',         // collect several region grabs, hand them over together
  termHotkey: 'CommandOrControl+Shift+4',          // grab the focused terminal's whole scrollback as text
  shelfHotkey: 'CommandOrControl+Shift+S',         // show/hide the session shelf
  barHotkey: 'CommandOrControl+Shift+Space',       // show/hide the floating capture bar
  barTimer: 0,                                     // 0 | 3 | 5 | 10 seconds before the bar captures
  barKeep: false,                                  // bring the capture bar back after each grab
  ocrHotkey: 'CommandOrControl+Shift+O',           // grab a region and copy its TEXT, not its pixels
  pinHotkey: 'CommandOrControl+Shift+P',           // grab a region and pin it on top of everything
  screenHotkey: 'CommandOrControl+Shift+6',        // the whole screen, no marquee
  allHotkey: '',                                   // every monitor stitched into one image (off by default)
  magnifier: true,                                 // pixel loupe while dragging the marquee
  adjustRegion: false,                             // hold the marquee after the drag so it can be nudged/resized
  namePattern: '',                                 // '' = the built-in naming; else a {token} template
  hideOwn: true,                                   // keep Snappy's own floating windows out of the shot
  ocrEngine: 'windows',                            // 'windows' (local, private) | 'claude' (cloud, best)
  anthropicKey: '',                                // BYOK for the Claude OCR engine
  ocrModel: 'claude-opus-5',                       // which Claude model reads the image
  shelf: true,                                     // collect this session's snaps in a draggable shelf
  shelfAutoShow: true,                             // pop the shelf up on each capture
  shelfPos: null,                                  // {x,y} the shelf was last dragged to
  shelfSize: 'sm',                                 // 'sm' | 'md' | 'lg' thumbnail size
  shelfLock: false,                                // pin it in place so it can't be dragged
  shelfHistory: true,                              // keep the shelf's contents across restarts
  terminalAsText: true,                            // window grabs of a terminal capture its text (masked) instead of pixels
  warnSecrets: true,                               // warn if a snipped terminal held something key-shaped
  saveFolder: path.join(app.getPath('pictures'), 'Snappy Snaps'),
  saveToFolder: true,
  copyToClipboard: true,
  defaultAction: 'save',                          // 'save' (raw/no frame) | 'beautify'
  beautifyUrl: 'https://snappy-frame.netlify.app',
  sendToInbox: false,                             // also upload each snap to the online inbox
  inboxCode: '',                                  // pairing code (snap_…) — get one at /inbox
  dailyFolders: true,                             // file each day's snaps into its own subfolder
  revealAfter: false,
  notify: true,
};
let settings = { ...DEFAULTS };

function loadSettings(){ try{ settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }; }catch(e){ settings = { ...DEFAULTS }; } }
function saveSettings(){ try{ fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive:true }); fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2)); }catch(e){ console.error(e); } }
function ensureFolder(){ try{ fs.mkdirSync(settings.saveFolder, { recursive:true }); }catch(e){} }

let shelfWin = null;
let tray = null, overlayWin = null, settingsWin = null, beautifyWin = null, annotatorWin = null, batchWin = null, barWin = null;
let barLaunched = false, barMode = 'region';       // was this grab started from the bar, and in which mode
const pending = new Map();                         // webContents.id -> { img (nativeImage), w, h }
const annPending = new Map();                      // annotator webContents.id -> { dataUrl, w, h }
const batch = [];
const shelf = [];                                  // this session's snaps: { file, thumb, name }                                  // collected region grabs (full-res dataURLs) awaiting hand-off
let captureMode = 'normal';                        // 'normal' | 'markup' | 'batch' | 'ocr' | 'pin' — what to do after the marquee
const pins = new Map();                            // webContents.id -> { win, image, pct, w, h }

// ---- capture flow --------------------------------------------------------
// The marquee overlay is built once and kept hidden between grabs, so a
// keypress only pays for the screen capture itself — not window creation,
// HTML load, and first-paint every single time (that overhead was the lag).
let overlayBusy = false;                           // a grab is already in flight
function ensureOverlay(){
  if(overlayWin) return;
  overlayWin = new BrowserWindow({
    width: 200, height: 200, frame:false, transparent:true, backgroundColor:'#00000000',
    alwaysOnTop:true, skipTaskbar:true, resizable:false, movable:false,
    hasShadow:false, fullscreenable:false, enableLargerThanScreen:true, show:false,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile('overlay.html');
  overlayWin.on('closed', () => { overlayWin = null; });
}
function hideOverlay(){
  overlayBusy = false;
  restoreOwnWindows();
  if(overlayWin && !overlayWin.isDestroyed()){
    overlayWin.webContents.send('overlay:clear');    // wipe the frozen shot while hidden, so it can never flash on the next grab
    overlayWin.hide();
  }
}

// Our own floating windows sit ON TOP of everything, so the shelf, the batch
// HUD and any pins were being captured INTO the next grab — a pinned reference
// baked into the screenshot you take next is never what you wanted. Hide them
// before the frame is taken and put them back when the grab is over. Hiding is
// hover-safe; it is SHOWING a window that dismisses tooltips and menus.
let stashed = [];
async function hideOwnWindows(){
  if(settings.hideOwn === false) return;
  const wins = [shelfWin, batchWin, ...[...pins.values()].map(p => p.win)];
  stashed = wins.filter(w => w && !w.isDestroyed() && w.isVisible());
  if(!stashed.length) return;                       // nothing on screen — don't pay the delay
  stashed.forEach(w => { try{ w.hide(); }catch(e){} });
  await new Promise(r => setTimeout(r, 110));       // let the compositor repaint without them
}
function restoreOwnWindows(){
  const list = stashed; stashed = [];
  list.forEach(w => { try{ if(!w.isDestroyed()) w.showInactive(); }catch(e){} });
}

let grabSeq = 0;
let readyResolve = null;                           // resolves when the renderer confirms the frozen frame is painted
ipcMain.on('overlay:ready', () => { if(readyResolve){ readyResolve(); readyResolve = null; } });

async function startCapture(mode){
  if(overlayBusy) return;                           // one marquee at a time
  overlayBusy = true;
  const seq = ++grabSeq;
  captureMode = ['markup','batch','ocr','pin'].includes(mode) ? mode : 'normal';
  try{
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const sf = display.scaleFactor || 1;
    const px = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };

    // The capture COMPLETES before the overlay appears. The moment any window —
    // even an inactive, fully transparent one — slides under the cursor, hover
    // UI (tooltips, hover menus, :hover styling) dismisses itself; so nothing
    // may be shown until the frame is safely in hand. This puts the capture
    // latency back on the critical path (~100–300ms before the marquee shows),
    // which is the accepted trade for hover-safe grabs.
    await hideOwnWindows();
    const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize: px });
    if(seq !== grabSeq){ return; }
    const displays = screen.getAllDisplays();
    const idx = displays.findIndex(d => d.id === display.id);
    const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[idx] || sources[0];
    if(!src){ overlayBusy = false; return; }
    const img = src.thumbnail;
    const size = img.getSize();

    ensureOverlay();
    if(overlayWin.webContents.isLoading()){          // only the very first grab waits for the page
      await new Promise(r => overlayWin.webContents.once('did-finish-load', r));
    }
    pending.set(overlayWin.webContents.id, { img, w:size.width, h:size.height });
    overlayWin.setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
    // JPEG preview (~10× smaller than a PNG dataURL) keeps encode + IPC + decode
    // quick. Wait until the renderer confirms the frozen frame is PAINTED before
    // showing, so the window appears already dimmed — no stale-image flash and
    // no live-transparent phase. Focus is safe now: the frame is captured.
    const ready = new Promise(r => { readyResolve = r; });
    overlayWin.webContents.send('overlay:show', { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64'),
      magnifier: settings.magnifier !== false, adjust: !!settings.adjustRegion });
    await Promise.race([ready, new Promise(r => setTimeout(r, 400))]);
    readyResolve = null;
    if(seq !== grabSeq){ return; }                   // superseded while waiting
    overlayWin.show(); overlayWin.focus();
  }catch(e){ console.error('startCapture failed', e); overlayBusy = false; }
}

ipcMain.on('overlay:cancel', (e) => { pending.delete(e.sender.id); hideOverlay(); returnBar(); });
ipcMain.on('overlay:commit', async (e, rect) => {
  hideOverlay();                                     // overlay vanishes the instant the drag ends
  const data = pending.get(e.sender.id);             // guaranteed set — the frame lands before the overlay is ever shown
  pending.delete(e.sender.id);
  if(!data || !rect) return;
  const full = data.img;
  const iw = data.w, ih = data.h;
  let cx = Math.round(rect.x * iw), cy = Math.round(rect.y * ih);
  let cw = Math.round(rect.w * iw), ch = Math.round(rect.h * ih);
  cx = Math.max(0, Math.min(cx, iw - 1)); cy = Math.max(0, Math.min(cy, ih - 1));
  cw = Math.max(1, Math.min(cw, iw - cx)); ch = Math.max(1, Math.min(ch, ih - cy));
  const crop = full.crop({ x:cx, y:cy, width:cw, height:ch });
  if(captureMode === 'ocr'){ await deliverOcr(crop); returnBar(); return; }
  if(captureMode === 'pin'){ openPin(crop); returnBar(); return; }
  if(captureMode === 'batch'){ addToBatch(crop.toDataURL()); returnBar(); return; }
  if(captureMode === 'markup'){ openAnnotator(crop.toDataURL()); return; }   // returns when the editor closes
  await handleResult(crop);
  returnBar();
  if(settings.warnSecrets !== false) warnIfSecretsOnScreen();   // async, never blocks the grab
});

function sanitizeName(s){ return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60); }

async function handleResult(image, ctx){
  // A command-line capture can override copy/save/folder for this one shot.
  const cli = cliOverride; cliOverride = null;
  const wantCopy = cli && cli.clipboard !== null && cli.clipboard !== undefined ? cli.clipboard
                 : (settings.copyToClipboard || (ctx && ctx.forceCopy));
  const wantSave = cli && cli.save !== null && cli.save !== undefined ? cli.save
                 : (settings.saveToFolder || (ctx && ctx.forceSave) || !!(cli && cli.dir));
  if(wantCopy){ try{ clipboard.writeImage(image); }catch(e){} }
  let savedPath = null;
  // forceSave: the user pressed Save on a pin, so honour that even when the
  // 'save every capture' setting is off.
  if(wantSave){
    ensureFolder();
    const n = nameParts();
    let dir = (cli && cli.dir) || settings.saveFolder, base;
    // window grabs know the app → file under <App>\; marquee grabs don't.
    const appDir = ctx && ctx.appName ? sanitizeName(ctx.appName) : '';
    if(appDir) dir = path.join(dir, appDir);
    const sz = (() => { try{ return image.getSize(); }catch(e){ return { width:0, height:0 }; } })();
    if(settings.namePattern){                      // a template wins over both built-in shapes
      if(settings.dailyFolders) dir = path.join(dir, n.day);
      base = applyNamePattern(settings.namePattern, { app: appDir, width: sz.width, height: sz.height });
    } else if(settings.dailyFolders){              // …\[App\]\YYYY-MM-DD\Snap 16.15.26.png
      dir = path.join(dir, n.day);
      base = `Snap ${n.time}`;
    } else {                                       // …\[App\]\Snap 29 Jul 2026 16.15.26.png
      base = `Snap ${n.readable} ${n.time}`;
    }
    try{ fs.mkdirSync(dir, { recursive:true }); }catch(e){}
    let p = path.join(dir, base + '.png'), i = 2;  // avoid clobbering same-second snaps
    while(fs.existsSync(p)){ p = path.join(dir, `${base} (${i}).png`); i++; }
    savedPath = p;
    try{ fs.writeFileSync(savedPath, image.toPNG()); }catch(e){ console.error('save failed', e); savedPath = null; }
  }
  // Everything captured this session lands on the shelf so it can be dragged
  // straight into another app. Dragging needs a real file, so a snap that was
  // not saved to the folder gets written to temp purely to be draggable.
  if(settings.shelf !== false){
    let f = savedPath;
    if(!f){
      try{
        const t = path.join(app.getPath('temp'), 'snappy-shelf');
        fs.mkdirSync(t, { recursive:true });
        f = path.join(t, 'Snap ' + Date.now() + '.png');
        fs.writeFileSync(f, image.toPNG());
      }catch(e){ f = null; }
    }
    if(f) addToShelf(f, image);
  }
  if(settings.defaultAction === 'beautify'){ openBeautify(image.toDataURL()); }
  let inboxOk = null;
  if(settings.sendToInbox && settings.inboxCode){ inboxOk = await sendToInbox(image); }
  if(settings.notify){ notify(savedPath, inboxOk); }
  if(settings.revealAfter && savedPath){ shell.showItemInFolder(savedPath); }
}

// Upload the snap to the online inbox (opt-in). Uses the same origin as the
// beautify URL, so pointing at a local build just works.
async function sendToInbox(image){
  try{
    const origin = new URL(settings.beautifyUrl).origin;
    const size = image.getSize();
    const res = await fetch(origin + '/.netlify/functions/inbox?op=put', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ code: settings.inboxCode, image: image.toDataURL(), source:'desktop', w:size.width, h:size.height }),
    });
    if(!res.ok){ console.error('inbox put failed', res.status, await res.text().catch(()=>'')); return false; }
    return true;
  }catch(e){ console.error('inbox send failed', e); return false; }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function nameParts(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return {
    day: `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`,          // 2026-07-29 (folder — sorts chronologically)
    time: `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`,       // 16.15.26 (dots — valid on Windows)
    readable: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,      // 29 Jul 2026 (day-first, month name)
  };
}

// A name template, so files can be called what you want them to be called.
// Tokens are {braced} rather than %-escapes: on Windows a path is full of
// percent signs from environment variables, and %H for hour next to %H for
// height is exactly the sort of collision that makes strftime patterns a
// support burden. Anything unrecognised is left alone, so a stray brace is
// harmless rather than silently eaten. Exported for the test harness.
const NAME_TOKENS = ['date','time','datetime','year','month','day','hour','minute','second','app','width','height','n'];
function applyNamePattern(pattern, ctx){
  const d = (ctx && ctx.now) || new Date(), p = n => String(n).padStart(2, '0');
  const map = {
    date:     `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`,
    time:     `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`,
    datetime: `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`,
    year: String(d.getFullYear()), month: p(d.getMonth()+1), day: p(d.getDate()),
    hour: p(d.getHours()), minute: p(d.getMinutes()), second: p(d.getSeconds()),
    app: (ctx && ctx.app) || '', width: String((ctx && ctx.width) || ''), height: String((ctx && ctx.height) || ''),
    n: String((ctx && ctx.n) || ''),
  };
  let out = String(pattern || '').replace(/\{(\w+)\}/g, (m, k) => {
    const v = map[k.toLowerCase()];
    return v === undefined ? m : v;                       // unknown token survives verbatim
  });
  // A template that resolves to nothing (e.g. "{app}" on a marquee grab) must
  // still produce a file, and one that collapses to spaces or dots must not
  // produce a hidden or path-traversing name.
  out = out.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 120);
  return out || 'Snap';
}

function notify(savedPath, inboxOk){
  const bits = [];
  if(savedPath) bits.push('Saved ' + path.basename(savedPath));
  if(settings.copyToClipboard) bits.push('copied to clipboard');
  if(inboxOk === true) bits.push('sent to inbox');
  else if(inboxOk === false) bits.push('inbox failed');
  try{ new Notification({ title:'Snappy Snap', body: bits.join(' · ') || 'Captured' }).show(); }catch(e){}
}

// ---- beautify (hand the crop to Snappy Frame, same protocol as the extension)
// Hand an image (or text) to a Snappy Frame window. The old version fired one
// postMessage 700ms after load and swallowed any failure, so a slow page or a
// large payload meant the user saw the app's autosaved PREVIOUS image and
// concluded their mark-up hadn't come across. Now: open with #handoff (the
// app skips its autosave restore), poll until the app says its listener is
// registered, post, and say so if it never lands.
async function deliverToBeautify(win, msg){
  const payload = JSON.stringify(msg);
  for(let i = 0; i < 50; i++){                       // up to ~10s
    if(!win || win.isDestroyed()) return;
    let ready = false;
    try{ ready = await win.webContents.executeJavaScript('!!window.__snappyReady', true); }catch(e){}
    if(ready){
      try{ await win.webContents.executeJavaScript('window.postMessage(' + payload + ', "*"); true', true); return; }
      catch(e){ console.error('beautify hand-off failed', e); }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  try{ new Notification({ title:'Snappy Snap — Beautify', body:"Snappy Frame didn't pick up the capture. Paste it in with Ctrl+V, or drag it from the shelf." }).show(); }catch(e){}
}
function openBeautify(dataUrl){
  beautifyWin = new BrowserWindow({ width:1240, height:840, title:'Snappy Frame', autoHideMenuBar:true });
  beautifyWin.loadURL(settings.beautifyUrl.replace(/#.*$/, '') + '#handoff');
  beautifyWin.webContents.once('did-finish-load', () => deliverToBeautify(beautifyWin, { type:'snappy-frame-image', dataUrl }));
  beautifyWin.on('closed', () => { beautifyWin = null; });
}
function openBeautifyText(text, title){
  const w = new BrowserWindow({ width:1240, height:840, title:'Snappy Frame', autoHideMenuBar:true });
  w.loadURL(settings.beautifyUrl.replace(/#.*$/, '') + '#handoff');
  w.webContents.once('did-finish-load', () => deliverToBeautify(w, { type:'snappy-frame-text', text, title }));
}
function openAnnotator(dataUrl){
  if(annotatorWin){ annotatorWin.focus(); return; }
  const img = nativeImage.createFromDataURL(dataUrl);
  const sz = img.getSize();
  const CHROME = 96, PADX = 40, MAXW = 1200, MAXH = 860;   // toolbar height + window padding
  const scale = Math.min(1, MAXW / sz.width, (MAXH - CHROME) / sz.height);
  const winW = Math.max(600, Math.round(sz.width * scale) + PADX);
  const winH = Math.min(MAXH, Math.round(sz.height * scale) + CHROME);
  annotatorWin = new BrowserWindow({
    width: winW, height: winH, title: 'Snappy Snap — Mark up',
    autoHideMenuBar: true, backgroundColor: '#1b1e28', minWidth: 480, minHeight: 320,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  annPending.set(annotatorWin.webContents.id, { dataUrl, w: sz.width, h: sz.height });
  annotatorWin.loadFile('annotator.html');
  annotatorWin.once('ready-to-show', () => annotatorWin.focus());
  annotatorWin.on('closed', () => { annotatorWin = null; });
}

ipcMain.handle('annotator:data', (e) => annPending.get(e.sender.id) || null);
ipcMain.on('annotator:cancel', (e) => { const w = BrowserWindow.fromWebContents(e.sender); annPending.delete(e.sender.id); if(w) w.close(); returnBar(); });
ipcMain.on('annotator:report', (e, msg) => {
  console.error('annotator report:', msg);
  try{ new Notification({ title:'Snappy Snap — Mark up', body: String(msg).slice(0, 200) }).show(); }catch(e2){}
});
ipcMain.on('annotator:done', async (e, payload) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  annPending.delete(e.sender.id);
  if(w) w.close();
  if(!payload || (!payload.bytes && !payload.dataUrl)) return;
  try{
    const img = payload.bytes ? nativeImage.createFromBuffer(Buffer.from(payload.bytes))
                              : nativeImage.createFromDataURL(payload.dataUrl);
    if(payload.action === 'beautify'){ try{ clipboard.writeImage(img); }catch(e2){} openBeautify(img.toDataURL()); returnBar(); return; }
    if(payload.action === 'pin'){ openPin(img); returnBar(); return; }
    if(payload.action === 'share'){ await shareAndCopy(img); returnBar(); return; }
    await handleResult(img, { markup: true, forceCopy: true });
    returnBar();
  }catch(err){
    console.error('annotator done failed', err);
    try{ new Notification({ title:'Snappy Snap — Mark up', body:'Copy failed: ' + String(err && err.message || err).slice(0, 160) }).show(); }catch(e2){}
  }
});

// ---- batch collector ------------------------------------------------------
// Gather several region grabs, then hand them over together — either as
// separate files opened in a folder (drag them all into a chat at full quality)
// or stitched into one image (one paste, but readability drops with count).
function addToBatch(dataUrl){
  batch.push({ dataUrl });
  openBatchHud();
  sendBatchUpdate();
}
function sendBatchUpdate(){
  if(batchWin && !batchWin.isDestroyed()){ batchWin.webContents.send('batch:update', batch.map((b, i) => ({ i, dataUrl: b.dataUrl }))); }
}
function openBatchHud(){
  if(batchWin && !batchWin.isDestroyed()){ return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 320, H = 300, M = 16;
  batchWin = new BrowserWindow({
    x: wa.x + wa.width - W - M, y: wa.y + wa.height - H - M, width: W, height: H,
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  batchWin.setAlwaysOnTop(true, 'screen-saver');
  batchWin.loadFile('batch.html');
  batchWin.once('ready-to-show', () => batchWin.show());
  batchWin.on('closed', () => { batchWin = null; });
}
function clearBatch(){ batch.length = 0; if(batchWin && !batchWin.isDestroyed()) batchWin.close(); }

ipcMain.on('batch:ready', () => sendBatchUpdate());
ipcMain.on('batch:action', async (e, msg) => {
  if(!msg) return;
  if(msg.name === 'clear'){ clearBatch(); return; }
  if(msg.name === 'save'){                        // one folder, one PNG per shot → drag them all in
    ensureFolder();
    const n = nameParts();
    let dir = settings.saveFolder;
    if(settings.dailyFolders) dir = path.join(dir, n.day);
    dir = path.join(dir, 'Batch ' + n.time);
    let d = dir, k = 2; while(fs.existsSync(d)){ d = `${dir} (${k})`; k++; } dir = d;
    try{ fs.mkdirSync(dir, { recursive:true }); }catch(e2){}
    const pad = String(batch.length).length;
    batch.forEach((b, i) => {
      const img = nativeImage.createFromDataURL(b.dataUrl);
      try{ fs.writeFileSync(path.join(dir, `Shot ${String(i+1).padStart(pad, '0')}.png`), img.toPNG()); }catch(e2){ console.error('batch save failed', e2); }
    });
    const count = batch.length;
    shell.openPath(dir);
    clearBatch();
    if(settings.notify){ try{ new Notification({ title:'Snappy Snap', body:`Saved ${count} shots — drag them into your chat` }).show(); }catch(e2){} }
    return;
  }
  if(msg.name === 'copy' && msg.dataUrl){          // renderer stitched them → clipboard (+ save the combined PNG)
    const img = nativeImage.createFromDataURL(msg.dataUrl);
    try{ clipboard.writeImage(img); }catch(e2){}
    let savedName = null;
    if(settings.saveToFolder){
      ensureFolder();
      const n = nameParts();
      let dir = settings.saveFolder;
      if(settings.dailyFolders) dir = path.join(dir, n.day);
      try{ fs.mkdirSync(dir, { recursive:true }); }catch(e2){}
      let p = path.join(dir, `Batch ${n.time}.png`), k = 2;
      while(fs.existsSync(p)){ p = path.join(dir, `Batch ${n.time} (${k}).png`); k++; }
      try{ fs.writeFileSync(p, img.toPNG()); savedName = path.basename(p); }catch(e2){ console.error('stitch save failed', e2); }
    }
    clearBatch();
    if(settings.notify){ try{ new Notification({ title:'Snappy Snap', body: savedName ? `Stitched ${savedName} · copied to clipboard` : 'Stitched image copied to clipboard' }).show(); }catch(e2){} }
    return;
  }
});

// ---- pinned shots --------------------------------------------------------
// A pin is a reference you keep in view while you work on something else — an
// error message, a design, a number you're copying. The whole image is the drag
// handle (nothing inside a pin needs its own drag), and each pin is independent
// so you can have several up at once.
function openPin(image){
  const size = image.getSize();
  if(!size.width || !size.height) return;
  const cur = screen.getCursorScreenPoint();
  const wa = (screen.getDisplayNearestPoint(cur) || screen.getPrimaryDisplay()).workArea;
  // Start at 1:1 but never larger than most of the screen — pinning a
  // full-screen grab at native size would cover the thing you pinned it for.
  const max = Math.min(1, (wa.width * 0.6) / size.width, (wa.height * 0.6) / size.height);
  const pct = Math.max(10, Math.round(max * 100));
  const w = Math.max(40, Math.round(size.width * pct / 100));
  const h = Math.max(30, Math.round(size.height * pct / 100));
  const win = new BrowserWindow({
    x: Math.round(Math.min(Math.max(cur.x - w / 2, wa.x + 8), wa.x + wa.width - w - 8)),
    y: Math.round(Math.min(Math.max(cur.y - h / 2, wa.y + 8), wa.y + wa.height - h - 8)),
    width: w, height: h,
    frame:false, transparent:true, backgroundColor:'#00000000', resizable:false, movable:true,
    alwaysOnTop:true, skipTaskbar:true, hasShadow:false, fullscreenable:false, show:false,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile('pin.html');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { for(const [k, v] of pins) if(v.win === win) pins.delete(k); refreshTrayMenu(); });
  pins.set(win.webContents.id, { win, image, pct, w: size.width, h: size.height });
  refreshTrayMenu();
}
function pinOf(e){ return pins.get(e.sender.id); }
// Pins accumulate — CleanShot learned to add this too.
function closeAllPins(){ for(const p of [...pins.values()]) { try{ if(!p.win.isDestroyed()) p.win.close(); }catch(e){} } }
ipcMain.on('pin:ready', (e) => {
  const p = pinOf(e); if(!p) return;
  e.sender.send('pin:data', { dataUrl: p.image.toDataURL(), w: p.w, h: p.h, pct: p.pct });
});
ipcMain.on('pin:close', (e) => { const p = pinOf(e); if(p && !p.win.isDestroyed()) p.win.close(); });
ipcMain.on('pin:copy',  (e) => { const p = pinOf(e); if(p) try{ clipboard.writeImage(p.image); }catch(e2){} });
ipcMain.on('pin:share', (e) => { const p = pinOf(e); if(p) shareAndCopy(p.image); });
ipcMain.on('pin:save', async (e) => {
  const p = pinOf(e); if(!p) return;
  try{ await handleResult(p.image, { forceSave: true }); }catch(e2){ console.error('pin save failed', e2); }
});
ipcMain.on('pin:scale', (e, delta) => {
  const p = pinOf(e); if(!p || p.win.isDestroyed()) return;
  p.pct = delta === 'reset' ? 100 : Math.max(10, Math.min(400, p.pct + delta));
  const b = p.win.getBounds();
  const w = Math.max(40, Math.round(p.w * p.pct / 100));
  const h = Math.max(30, Math.round(p.h * p.pct / 100));
  // Grow about the centre so the pin doesn't crawl across the screen as you zoom.
  p.win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2), width: w, height: h });
  e.sender.send('pin:scale', p.pct);
});

// ---- share links ---------------------------------------------------------
// Uploads the image to your inbox room and mints a public, unguessable link
// for that one image. The link lives 7 days, then it and the upload are
// deleted server-side. Same opt-in as the inbox: needs a pairing code, and it
// is an UPLOAD — the same caution as cloud OCR applies to anything sensitive.
async function shareImage(image){
  const code = (settings.inboxCode || '').trim();
  if(!code){
    try{ new Notification({ title:'Snappy Snap — Share link', body:'Sharing uses your online inbox. Get a code at snappy-frame.netlify.app/inbox and paste it into Settings.' }).show(); }catch(e){}
    return null;
  }
  const origin = new URL(settings.beautifyUrl).origin;
  const size = image.getSize();
  const res = await fetch(origin + '/.netlify/functions/inbox?op=share', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ code, image: image.toDataURL(), source:'desktop', w:size.width, h:size.height }),
  });
  const j = await res.json().catch(() => ({}));
  if(!res.ok || !j.url) throw new Error(j.error || ('upload failed (' + res.status + ')'));
  return j.url;
}
// Links you have minted, so they can be found and revoked later. Server-side a
// share is only addressable by its token, and the token is in the link you have
// already sent someone — so if the app doesn't remember it, "un-share that"
// becomes impossible. Kept local: it is a list of your own links, not a second
// copy of the images.
const SHARES_PATH = () => path.join(app.getPath('userData'), 'shares.json');
let shares = [];
function loadShares(){
  try{ const r = JSON.parse(fs.readFileSync(SHARES_PATH(), 'utf8')); if(Array.isArray(r)) shares = r; }catch(e){}
  pruneShares();
}
function saveShares(){ try{ fs.writeFileSync(SHARES_PATH(), JSON.stringify(shares.slice(0, 200))); }catch(e){} }
// A share is dead after 7 days whatever we think, so stop listing it.
const SHARE_TTL_MS = 7 * 24 * 3600 * 1000;
function pruneShares(){
  const cut = Date.now() - SHARE_TTL_MS;
  const before = shares.length;
  shares = shares.filter(x => x && x.url && (x.at || 0) > cut);
  if(shares.length !== before) saveShares();
}
function rememberShare(url, image){
  let thumb = '';
  try{ if(image) thumb = image.resize({ height: 64, quality: 'good' }).toDataURL(); }catch(e){}
  const token = (String(url).split('/s/')[1] || '').replace(/\.png$/, '');
  shares.unshift({ url, token, at: Date.now(), thumb });
  if(shares.length > 200) shares.length = 200;
  saveShares();
  if(sharesWin && !sharesWin.isDestroyed()) sharesWin.webContents.send('shares:list', sharesPayload());
}
function sharesPayload(){
  pruneShares();
  return shares.map(x => ({ url: x.url, thumb: x.thumb || '', at: x.at,
    daysLeft: Math.max(0, Math.ceil((x.at + SHARE_TTL_MS - Date.now()) / 86400000)) }));
}
async function revokeShare(url){
  const code = (settings.inboxCode || '').trim();
  const token = (String(url).split('/s/')[1] || '').replace(/\.png$/, '');
  if(!token) throw new Error('that link has no token');
  if(!code) throw new Error('needs your inbox code');
  const origin = new URL(settings.beautifyUrl).origin;
  const res = await fetch(origin + '/.netlify/functions/inbox?op=unshare', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ code, token }),
  });
  const j = await res.json().catch(() => ({}));
  // A link the server no longer has is already revoked as far as anyone
  // clicking it is concerned, so drop it from the list rather than erroring.
  if(!res.ok && res.status !== 404) throw new Error(j.error || ('revoke failed (' + res.status + ')'));
  shares = shares.filter(x => x.url !== url);
  saveShares();
}
let sharesWin = null;
function openShares(){
  if(sharesWin && !sharesWin.isDestroyed()){ sharesWin.show(); sharesWin.focus(); return; }
  sharesWin = new BrowserWindow({ width: 560, height: 620, title: 'Snappy Snap — Share links',
    autoHideMenuBar: true, backgroundColor: '#1b1e28', minWidth: 420, minHeight: 320,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  sharesWin.loadFile('shares.html');
  sharesWin.on('closed', () => { sharesWin = null; });
}
ipcMain.handle('shares:get', () => sharesPayload());
ipcMain.handle('shares:revoke', async (e, url) => {
  try{ await revokeShare(url); return { ok: true, list: sharesPayload() }; }
  catch(err){ return { ok: false, error: String(err && err.message || err), list: sharesPayload() }; }
});
ipcMain.on('shares:copy', (e, url) => { try{ clipboard.writeText(url); }catch(e2){} });
ipcMain.on('shares:open', (e, url) => { try{ shell.openExternal(url); }catch(e2){} });
ipcMain.on('shares:forget', (e, url) => { shares = shares.filter(x => x.url !== url); saveShares(); });

async function shareAndCopy(image){
  try{
    const url = await shareImage(image);
    if(!url) return;
    rememberShare(url, image);
    clipboard.writeText(url);
    try{ new Notification({ title:'Snappy Snap — Link copied', body: url + '\nAnyone with the link can view it. Expires in 7 days.' }).show(); }catch(e){}
  }catch(e){
    console.error('share failed', e);
    try{ new Notification({ title:'Snappy Snap — Share failed', body:String(e && e.message || e).slice(0, 180) }).show(); }catch(e2){}
  }
}

// ---- session shelf -------------------------------------------------------
// A slim always-on-top strip holding this session's snaps. Each thumbnail is a
// NATIVE file drag source (webContents.startDrag), so a snap can be dragged
// straight into Claude Desktop, Slack, an editor — anything that accepts a
// dropped file — with no save-locate-attach detour.
// The shelf used to die with the process, so yesterday's snaps were gone even
// though the FILES were still sitting in the save folder. Only the paths are
// persisted — thumbnails are regenerated from the files on load, which keeps the
// state file small and means a snap whose file was deleted simply drops out.
const HISTORY_PATH = () => path.join(app.getPath('userData'), 'history.json');
function saveHistory(){
  if(settings.shelfHistory === false) return;
  try{
    const rows = shelf.filter(s2 => s2.file).slice(0, 40).map(s2 => ({ file: s2.file, name: s2.name }));
    fs.writeFileSync(HISTORY_PATH(), JSON.stringify(rows));
  }catch(e){}
}
function loadHistory(){
  if(settings.shelfHistory === false) return;
  let rows = [];
  try{ rows = JSON.parse(fs.readFileSync(HISTORY_PATH(), 'utf8')); }catch(e){ return; }
  if(!Array.isArray(rows)) return;
  for(const r of rows){
    if(!r || !r.file) continue;
    try{ if(!fs.existsSync(r.file)) continue; }catch(e){ continue; }
    let thumb = '';
    try{
      const im = nativeImage.createFromPath(r.file);
      if(im.isEmpty()) continue;
      thumb = im.resize({ height: 168, quality: 'good' }).toDataURL();
    }catch(e){ continue; }
    shelf.push({ file: r.file, thumb, name: r.name || path.basename(r.file) });
    if(shelf.length >= 40) break;
  }
}
function addToShelf(file, image){
  let thumb = '';
  // Stored big enough for the largest shelf size — resizing UP a 96px thumb
  // just gave a blurry one, which defeats the point of making them larger.
  try{ thumb = image.resize({ height: 168, quality: 'good' }).toDataURL(); }catch(e){}
  shelf.unshift({ file, thumb, name: path.basename(file) });
  if(shelf.length > 40) shelf.length = 40;
  if(settings.shelfAutoShow !== false) openShelf(true);
  sendShelf();
  saveHistory();
}
function sendShelf(){
  if(shelfWin && !shelfWin.isDestroyed()){
    shelfWin.webContents.send('shelf:update', shelf.map((s2, i) => ({ i, thumb: s2.thumb, name: s2.name })));
  }
}
const SHELF_W = { sm: 140, md: 200, lg: 272 };
function shelfWidth(){ return SHELF_W[settings.shelfSize] || SHELF_W.sm; }
function sendShelfState(){
  if(shelfWin && !shelfWin.isDestroyed()){
    shelfWin.webContents.send('shelf:state', { size: settings.shelfSize || 'sm', locked: !!settings.shelfLock });
  }
}
function applyShelfLock(){
  // Belt and braces: the CSS drag region is what the user grabs, but
  // setMovable(false) also blocks any OS-level move.
  if(shelfWin && !shelfWin.isDestroyed()){
    try{ shelfWin.setMovable(!settings.shelfLock); }catch(e){}
  }
  sendShelfState();
}
// A saved position is only usable if a display still covers it — unplug the
// monitor it was parked on and the restored window would be stranded off-screen
// with no way to drag it back.
function validShelfPos(W, H){
  const p = settings.shelfPos;
  if(!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  const fits = screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return p.x + W > a.x + 24 && p.x < a.x + a.width - 24 &&
           p.y + 40 > a.y && p.y < a.y + a.height - 24;
  });
  return fits ? p : null;
}
function openShelf(quiet){
  if(shelfWin && !shelfWin.isDestroyed()){
    if(!shelfWin.isVisible()) quiet ? shelfWin.showInactive() : shelfWin.show();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const W = shelfWidth(), H = Math.min(560, wa.height - 80);
  const pos = validShelfPos(W, H) || { x: wa.x + wa.width - W - 12, y: wa.y + 60 };
  shelfWin = new BrowserWindow({
    x: pos.x, y: pos.y, width: W, height: H,
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false,
    movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  shelfWin.setAlwaysOnTop(true, 'floating');
  try{ shelfWin.setMovable(!settings.shelfLock); }catch(e){}
  shelfWin.loadFile('shelf.html');
  // Remember where it was put — including which monitor — so it doesn't snap
  // back to the primary display on the next capture.
  let posT = null;
  shelfWin.on('moved', () => {
    clearTimeout(posT);
    posT = setTimeout(() => {
      if(!shelfWin || shelfWin.isDestroyed()) return;
      const b = shelfWin.getBounds();
      settings.shelfPos = { x: b.x, y: b.y };
      saveSettings();
    }, 400);
  });
  shelfWin.once('ready-to-show', () => { quiet ? shelfWin.showInactive() : shelfWin.show(); sendShelf(); sendShelfState(); });
  shelfWin.on('closed', () => { shelfWin = null; });
}
function toggleShelf(){
  if(shelfWin && !shelfWin.isDestroyed() && shelfWin.isVisible()) shelfWin.hide();
  else openShelf(false);
}

// ---- floating capture bar ------------------------------------------------
// The modes only existed as hotkeys and tray items, so nothing about them was
// visible. This is the macOS Cmd+Shift+5 shape: a pill of mode buttons, an
// Options menu, and a Capture button.
// The window is sized from what the page ACTUALLY measures, not a constant:
// a hardcoded height was measured against one machine's fonts and clipped the
// top of the Options menu everywhere Segoe UI renders it taller.
const BAR_W = 660, BAR_H_MIN = 84;
let barH = BAR_H_MIN;                              // current content height, reported by the renderer
function barBounds(){
  const cur = screen.getCursorScreenPoint();
  const wa = (screen.getDisplayNearestPoint(cur) || screen.getPrimaryDisplay()).workArea;
  // Never taller than the work area, and never pushed off the top of it.
  const h = Math.max(BAR_H_MIN, Math.min(barH, wa.height - 16));
  return { x: Math.round(wa.x + (wa.width - BAR_W) / 2),
           y: Math.max(wa.y + 8, Math.round(wa.y + wa.height - h - 28)),
           width: BAR_W, height: h };
}
function openBar(){
  if(barWin && !barWin.isDestroyed()){ barWin.setBounds(barBounds()); barWin.show(); barWin.focus(); return; }
  barWin = new BrowserWindow({
    ...barBounds(),
    frame:false, transparent:true, backgroundColor:'#00000000', resizable:false, movable:true,
    alwaysOnTop:true, skipTaskbar:true, hasShadow:false, fullscreenable:false, show:false,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true },
  });
  barWin.setAlwaysOnTop(true, 'screen-saver');
  barWin.loadFile('bar.html');
  barWin.once('ready-to-show', () => { barWin.show(); barWin.focus(); });
  barWin.on('closed', () => { barWin = null; });
}
function hideBar(){ if(barWin && !barWin.isDestroyed()) barWin.hide(); }
function toggleBar(){
  if(barWin && !barWin.isDestroyed() && barWin.isVisible()) hideBar();
  else openBar();
}
ipcMain.on('bar:ready', (e) => e.sender.send('bar:state', settings));
ipcMain.on('bar:close', () => hideBar());
// The renderer measures itself and reports the height it needs; the window
// grows upward to match and shrinks back when the menu closes. A permanently
// tall transparent window would swallow clicks meant for whatever is beneath it.
ipcMain.on('bar:size', (e, px) => {
  barH = Math.max(BAR_H_MIN, Math.min(1200, Math.round(+px) || BAR_H_MIN));
  if(barWin && !barWin.isDestroyed()) barWin.setBounds(barBounds());
});
ipcMain.on('bar:option', (e, patch) => {
  Object.assign(settings, patch || {}); saveSettings(); refreshTrayMenu();
  if(barWin && !barWin.isDestroyed()) barWin.webContents.send('bar:state', settings);
});
ipcMain.on('bar:run', async (e, mode) => {
  // The bar must be gone BEFORE the capture runs: any window under the cursor
  // dismisses hover UI and menus, which is the whole v0.10.0 lesson. The timer
  // is the deliberate way to catch a menu — open it while the clock runs.
  barH = BAR_H_MIN;
  if(barWin && !barWin.isDestroyed()) barWin.setBounds(barBounds());
  hideBar();
  barLaunched = true; barMode = mode;
  const wait = Math.max(0, (+settings.barTimer || 0) * 1000) + 140;
  await new Promise(r => setTimeout(r, wait));
  try{
    // window/terminal finish when they resolve; the marquee modes finish later,
    // at commit/cancel, so those call returnBar() from their own end points.
    if(mode === 'screen'){ await captureWholeScreen(); }          // returns the bar itself
    else if(mode === 'window'){ await captureActiveWindow(); returnBar(); }
    else if(mode === 'terminal'){ await captureTerminalText(); returnBar(); }
    else startCapture(['markup','batch','ocr','pin'].includes(mode) ? mode : 'normal');
  }catch(err){ console.error('bar capture failed', err); barLaunched = false; }
});
// Dismissing after a grab is right for a one-off — it's what the platform tools
// do, and you rarely want a bar sitting over the thing you just captured. It is
// wrong for repeated work, so batch (whose whole point is collecting several)
// always brings the bar back, and 'Keep bar open' does it for any mode.
function returnBar(){
  if(!barLaunched) return;
  barLaunched = false;
  if(!(barMode === 'batch' || settings.barKeep)) return;
  // Let the save, notification and shelf settle before it reappears, or it
  // pops up over its own toast.
  setTimeout(() => {
    openBar();
    if(barWin && !barWin.isDestroyed()) barWin.webContents.send('bar:mode', barMode);
  }, 260);
}

ipcMain.on('shelf:ready', () => { sendShelf(); sendShelfState(); });
ipcMain.on('shelf:size', (e, size) => {
  if(!SHELF_W[size]) return;
  settings.shelfSize = size; saveSettings();
  if(shelfWin && !shelfWin.isDestroyed()){
    const b = shelfWin.getBounds(), W = shelfWidth();
    const wa = (screen.getDisplayNearestPoint({ x: b.x, y: b.y }) || screen.getPrimaryDisplay()).workArea;
    // Growing a shelf parked against the right edge would push it off
    // screen, so pull it back inside the display it is actually on.
    const x = Math.max(wa.x + 4, Math.min(b.x, wa.x + wa.width - W - 4));
    const locked = !!settings.shelfLock;
    if(locked){ try{ shelfWin.setMovable(true); }catch(e2){} }   // setBounds is a move
    shelfWin.setBounds({ x, y: b.y, width: W, height: b.height });
    if(locked){ try{ shelfWin.setMovable(false); }catch(e2){} }
    settings.shelfPos = { x, y: b.y }; saveSettings();
  }
  sendShelfState();
});
ipcMain.on('shelf:lock', (e, on) => { settings.shelfLock = !!on; saveSettings(); applyShelfLock(); });
ipcMain.on('shelf:hide', () => { if(shelfWin && !shelfWin.isDestroyed()) shelfWin.hide(); });
ipcMain.on('shelf:clear', () => { shelf.length = 0; sendShelf(); saveHistory(); });
ipcMain.on('shelf:remove', (e, i) => { if(shelf[i]) shelf.splice(i, 1); sendShelf(); saveHistory(); });
ipcMain.on('shelf:copy', (e, i) => {
  const it = shelf[i]; if(!it) return;
  try{ clipboard.writeImage(nativeImage.createFromPath(it.file)); }catch(e2){}
});
ipcMain.on('shelf:reveal', (e, i) => { const it = shelf[i]; if(it) shell.showItemInFolder(it.file); });
// Hand a saved PNG to another app. Windows' own "Open with" chooser is a
// shell32 entry point, so you get the real OS list (Paint, Photoshop, whatever
// you have) rather than a list we'd have to guess at and keep current.
function openWith(file){
  if(!file) return;
  if(process.platform !== 'win32'){ try{ shell.openPath(file); }catch(e){} return; }
  execFile('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', file], (err) => {
    if(err){ console.error('open with failed', err); try{ shell.openPath(file); }catch(e2){} }
  });
}
// Right-click a tile: the actions the hover buttons don't have room for.
ipcMain.on('shelf:menu', (e, i) => {
  const it = shelf[i]; if(!it) return;
  const load = () => { try{ const im = nativeImage.createFromPath(it.file); return im.isEmpty() ? null : im; }catch(e2){ return null; } };
  const menu = Menu.buildFromTemplate([
    { label: 'Share link  (7 days)', click: () => { const im = load(); if(im) shareAndCopy(im); } },
    { label: 'Copy image', click: () => { const im = load(); if(im) try{ clipboard.writeImage(im); }catch(e2){} } },
    { label: 'Pin on top', click: () => { const im = load(); if(im) openPin(im); } },
    { type: 'separator' },
    { label: 'Open with…', click: () => openWith(it.file) },
    { label: 'Show in folder', click: () => shell.showItemInFolder(it.file) },
    { label: 'Remove from shelf', click: () => { const k = shelf.indexOf(it); if(k >= 0) shelf.splice(k, 1); sendShelf(); saveHistory(); } },
  ]);
  const w = BrowserWindow.fromWebContents(e.sender);
  menu.popup(w ? { window: w } : {});
});
ipcMain.on('shelf:share', (e, i) => {
  const it = shelf[i]; if(!it) return;
  try{ const im = nativeImage.createFromPath(it.file); if(!im.isEmpty()) shareAndCopy(im); }catch(e2){}
});
// Put a shot from history back on screen as a floating reference.
ipcMain.on('shelf:pin', (e, i) => {
  const it = shelf[i]; if(!it) return;
  try{
    const im = nativeImage.createFromPath(it.file);
    if(!im.isEmpty()) openPin(im);
  }catch(e2){ console.error('pin from shelf failed', e2); }
});
// The actual drag-out. Must run from the dragstart the renderer reports.
ipcMain.on('shelf:drag', (e, i) => {
  const items = (i === 'all') ? shelf : (shelf[i] ? [shelf[i]] : []);
  const files = items.map(x => x.file).filter(f => { try{ return fs.existsSync(f); }catch(e2){ return false; } });
  if(!files.length) return;
  let icon = nativeImage.createFromPath(files[0]);
  try{ icon = icon.resize({ height: 64 }); }catch(e2){}
  if(icon.isEmpty()) icon = trayImage();
  try{ e.sender.startDrag(files.length > 1 ? { files, icon } : { file: files[0], icon }); }
  catch(e2){ console.error('drag failed', e2); }
});

// ---- tray ----------------------------------------------------------------
function trayImage(){
  const p = path.join(__dirname, 'assets', 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}
function buildTray(){
  tray = new Tray(trayImage());
  tray.setToolTip('Snappy Snap — ' + settings.hotkey);
  tray.on('click', () => startCapture());
  refreshTrayMenu();
}
function refreshTrayMenu(){
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Capture region   (' + settings.hotkey + ')', click: () => startCapture() },
    { label: 'Capture active window   (' + (settings.windowHotkey || '—') + ')', click: () => captureActiveWindow().catch((e) => console.error(e)) },
    { label: 'Capture whole screen   (' + (settings.screenHotkey || '—') + ')', click: () => captureWholeScreen().catch((e) => console.error(e)) },
    { label: 'Capture all monitors   (' + (settings.allHotkey || '—') + ')', click: () => captureAllScreens().catch((e) => console.error(e)) },
    { label: 'Capture & mark up   (' + (settings.markupHotkey || '—') + ')', click: () => startCapture('markup') },
    { label: 'Add to batch   (' + (settings.batchHotkey || '—') + ')', click: () => startCapture('batch') },
    { label: 'Copy text from a region   (' + (settings.ocrHotkey || '—') + ')', click: () => startCapture('ocr') },
    { label: 'Pin a region on top   (' + (settings.pinHotkey || '—') + ')', click: () => startCapture('pin') },
    ...(pins.size ? [{ label: 'Close all pins (' + pins.size + ')', click: () => { closeAllPins(); refreshTrayMenu(); } }] : []),
    { label: 'Capture terminal text   (' + (settings.termHotkey || '—') + ')', click: () => captureTerminalText().catch((e) => console.error(e)) },
    { label: 'Capture bar   (' + (settings.barHotkey || '—') + ')', click: () => toggleBar() },
    { label: 'Session shelf   (' + (settings.shelfHotkey || '—') + ')', click: () => toggleShelf() },
    { label: 'Share links…', click: () => openShares() },
    { type:'separator' },
    { label:'Mode: Raw — no frame', type:'radio', checked: settings.defaultAction === 'save', click: () => { settings.defaultAction = 'save'; saveSettings(); refreshTrayMenu(); } },
    { label:'Mode: Beautify in Snappy Frame', type:'radio', checked: settings.defaultAction === 'beautify', click: () => { settings.defaultAction = 'beautify'; saveSettings(); refreshTrayMenu(); } },
    { type:'separator' },
    { label:'Copy to clipboard', type:'checkbox', checked: settings.copyToClipboard, click:(mi) => { settings.copyToClipboard = mi.checked; saveSettings(); } },
    { label:'Save to folder', type:'checkbox', checked: settings.saveToFolder, click:(mi) => { settings.saveToFolder = mi.checked; saveSettings(); } },
    { label: settings.inboxCode ? 'Send to online inbox' : 'Send to inbox (set a code in Settings)', type:'checkbox', checked: settings.sendToInbox, enabled: !!settings.inboxCode, click:(mi) => { settings.sendToInbox = mi.checked; saveSettings(); } },
    { label:'Open save folder', click: () => { ensureFolder(); shell.openPath(settings.saveFolder); } },
    { type:'separator' },
    { label:'Start with Windows', type:'checkbox', checked: (() => { try { return app.getLoginItemSettings().openAtLogin; } catch (e) { return false; } })(), click:(mi) => { try { app.setLoginItemSettings({ openAtLogin: mi.checked, args: [] }); } catch (e) {} } },
    { label:'Settings…', click: () => openSettings() },
    { type:'separator' },
    { label:'Quit Snappy Snap', click: () => app.quit() },
  ]));
  if(tray) tray.setToolTip('Snappy Snap — ' + settings.hotkey);
}

function openSettings(){
  if(settingsWin){ settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width:520, height:640, title:'Snappy Snap — Settings', resizable:true, autoHideMenuBar:true,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true } });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---- settings IPC --------------------------------------------------------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  if('hotkey' in patch || 'windowHotkey' in patch || 'markupHotkey' in patch || 'batchHotkey' in patch || 'termHotkey' in patch || 'shelfHotkey' in patch || 'barHotkey' in patch || 'ocrHotkey' in patch || 'pinHotkey' in patch || 'screenHotkey' in patch || 'allHotkey' in patch) registerHotkey();
  if('shelfLock' in patch) applyShelfLock();      // reach the live window, not just the file
  refreshTrayMenu();
  return settings;
});
ipcMain.handle('settings:chooseFolder', async () => {
  const r = await dialog.showOpenDialog({ properties:['openDirectory','createDirectory'] });
  if(!r.canceled && r.filePaths[0]){ settings.saveFolder = r.filePaths[0]; saveSettings(); }
  return settings.saveFolder;
});
ipcMain.on('settings:openFolder', () => { ensureFolder(); shell.openPath(settings.saveFolder); });

// Start-with-Windows uses the OS login-item registry (not our settings file).
ipcMain.handle('autostart:get', () => { try { return app.getLoginItemSettings().openAtLogin; } catch (e) { return false; } });
ipcMain.handle('autostart:set', (e, on) => {
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: [] }); } catch (e2) {}
  refreshTrayMenu();
  try { return app.getLoginItemSettings().openAtLogin; } catch (e3) { return !!on; }
});

// ---- active-window capture (no marquee) ----------------------------------
// Ask Windows for the foreground window's title + app name (no native module —
// a one-shot PowerShell call), then grab THAT window's image via desktopCapturer
// (which handles any monitor / DPI itself). Files under <App>\<date>\.
function getForegroundInfo(){
  return new Promise((resolve) => {
    if(process.platform !== 'win32'){ resolve(null); return; }
    const ps = [
      'Add-Type @"',
      'using System;using System.Runtime.InteropServices;using System.Text;',
      'public class Fg{',
      ' [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      ' [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h,out int pid);',
      ' [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);',
      '}',
      '"@',
      '$h=[Fg]::GetForegroundWindow()',
      '$sb=New-Object System.Text.StringBuilder 512',
      '[Fg]::GetWindowText($h,$sb,512)|Out-Null',
      '$procId=0;[Fg]::GetWindowThreadProcessId($h,[ref]$procId)|Out-Null',
      '$p=Get-Process -Id $procId',
      '$app=$p.ProcessName',
      'try{ $pn=$p.MainModule.FileVersionInfo.ProductName; if($pn){$app=$pn} }catch{}',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
      '@{app=$app;title=$sb.ToString()}|ConvertTo-Json -Compress',
    ].join('\n');
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: 4000, windowsHide: true }, (err, stdout) => {
        if(err){ resolve(null); return; }
        try{ resolve(JSON.parse(String(stdout).trim())); }catch(e){ resolve(null); }
      });
  });
}

// ---- secret awareness ----------------------------------------------------
// Screenshots of terminals are where API keys leak. We can't read pixels, but
// when the focused window IS a terminal we can read its text buffer and check
// it — so an image grab can at least WARN, and window grabs can route to the
// masked text card instead. Kept in sync with the site's masking rules.
const SECRET_RE = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/, /\bsk-[A-Za-z0-9]{20,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/, /\bnpm_[A-Za-z0-9]{20,}/, /\bglpat-[A-Za-z0-9_-]{16,}/,
  /\b(?:r8_|hf_|pk_live_|sk_live_|rk_live_)[A-Za-z0-9]{16,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|apikey|secret|token|password|passwd|client[_-]?secret)["'\s]*[:=]\s*["']?[^\s"',;]{6,}/i,
  /Authorization:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S{4,}/,
];
const hasSecrets = (t) => !!t && SECRET_RE.some(re => re.test(t));
// Same rules, used to REMOVE the secret rather than just warn about it — text
// on the clipboard is one paste away from a chat window.
function maskSecrets(t){
  let out = String(t || ''), n = 0;
  for(const re of SECRET_RE){
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    out = out.replace(g, (m) => { n++; return m.length > 12 ? m.slice(0, 4) + '…[redacted]…' : '[redacted]'; });
  }
  return { text: out, masked: n };
}

// ---- OCR: pull the TEXT out of a grab ------------------------------------
// Windows ships an OCR engine (Windows.Media.Ocr); Windows PowerShell 5.1 can
// reach it through the WinRT projection, which is the same one-shot shape the
// terminal capture already uses. Text beats a picture of text for anything you
// are going to paste into a chat: it is searchable, diffable, costs less, and
// can have its secrets stripped — a screenshot cannot.
const OCR_TARGET_PX = 2400;                        // long edge fed to the OCR engine
// Windows' OCR engine expects dark text on a light page. Dark-mode UI — light
// text on a dark, often gradient background — is where it falls apart: DESIGN.md
// came back "DfSlG.V.md". So flatten to greyscale, invert if the grab is
// predominantly dark, and stretch the contrast so glyph edges are crisp.
// Exported for testing: pure buffer maths, no Electron needed.
function ocrPreprocess(bgra, width, height){
  const n = width * height;
  if(!n || bgra.length < n * 4) return { changed: false };
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let sum = 0;
  for(let i = 0, j = 0; i < n; i++, j += 4){
    // toBitmap() is BGRA.
    const v = (0.0722 * bgra[j] + 0.7152 * bgra[j + 1] + 0.2126 * bgra[j + 2]) | 0;
    lum[i] = v; hist[v]++; sum += v;
  }
  const mean = sum / n;
  const invert = mean < 128;                       // a dark grab: light text on dark
  // 2nd/98th percentile stretch — ignores a few stray pixels that would
  // otherwise pin the range and flatten everything else.
  const cut = Math.max(1, Math.floor(n * 0.02));
  let lo = 0, hi = 255, acc = 0;
  for(let v = 0; v < 256; v++){ acc += hist[v]; if(acc >= cut){ lo = v; break; } }
  acc = 0;
  for(let v = 255; v >= 0; v--){ acc += hist[v]; if(acc >= cut){ hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for(let i = 0, j = 0; i < n; i++, j += 4){
    let v = ((lum[i] - lo) * 255 / span);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if(invert) v = 255 - v;
    bgra[j] = bgra[j + 1] = bgra[j + 2] = v | 0;
    bgra[j + 3] = 255;
  }
  return { changed: true, invert, lo, hi, mean: Math.round(mean) };
}
if(typeof module !== 'undefined' && module.exports){ module.exports.ocrPreprocess = ocrPreprocess;
  module.exports.compositeDisplays = compositeDisplays;
  module.exports.applyNamePattern = applyNamePattern;
  module.exports.parseCli = parseCli; }
function ocrImage(image){
  return new Promise((resolve, reject) => {
    let tmp = '';
    try{
      const dir = path.join(app.getPath('temp'), 'snappy-ocr');
      fs.mkdirSync(dir, { recursive: true });
      tmp = path.join(dir, 'ocr-' + Date.now() + '.png');
      // Windows' OCR engine is tuned for document-scale text, so UI text grabbed
      // at 1:1 is where it confuses 1/l and 0/O. Upscaling before recognition is
      // the standard fix — the engine gets more pixels per glyph to work with.
      // Cap the result so a full-screen grab doesn't balloon into a slow decode.
      let feed = image;
      // Contrast/inversion first — cheaper on the un-upscaled pixels, and the
      // result is the same either way.
      try{
        const sz0 = image.getSize();
        const bmp = image.toBitmap();
        const info = ocrPreprocess(bmp, sz0.width, sz0.height);
        if(info.changed) feed = nativeImage.createFromBuffer(bmp, { width: sz0.width, height: sz0.height });
      }catch(e2){ feed = image; }
      try{
        const sz = feed.getSize();
        const long = Math.max(sz.width, sz.height);
        if(long > 0){
          const scale = Math.max(1, Math.min(4, OCR_TARGET_PX / long));
          if(scale > 1.05){
            feed = feed.resize({ width: Math.round(sz.width * scale),
                                 height: Math.round(sz.height * scale), quality: 'best' });
          }
        }
      }catch(e2){ /* keep whatever we have */ }
      fs.writeFileSync(tmp, feed.toPNG());
    }catch(e){ return reject(e); }
    const q = tmp.replace(/'/g, "''");
    const ps = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
      "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
      "function Await($op,$t){ $x=$asTask.MakeGenericMethod($t).Invoke($null,@($op)); $x.Wait(-1)|Out-Null; $x.Result }",
      "[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]|Out-Null",
      "[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]|Out-Null",
      "[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]|Out-Null",
      "$eng=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()",
      "if(-not $eng){ throw 'Windows has no OCR language pack for your display language.' }",
      "$f=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('" + q + "')) ([Windows.Storage.StorageFile])",
      "$st=Await ($f.OpenAsync(0)) ([Windows.Storage.Streams.IRandomAccessStream])",
      "$dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($st)) ([Windows.Graphics.Imaging.BitmapDecoder])",
      "$bmp=Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])",
      "$res=Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])",
      // Lines, not .Text — joining the lines ourselves keeps the layout readable.
      "($res.Lines | ForEach-Object { $_.Text }) -join \"`n\"",
    ].join('; ');
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 25000 },
      (err, stdout, stderr) => {
        try{ fs.unlinkSync(tmp); }catch(e2){}
        if(err) return reject(new Error(String(stderr || err.message || 'OCR failed').trim().slice(0, 300)));
        resolve(String(stdout || '').replace(/\r/g, '').trim());
      });
  });
}
// Claude reads a screenshot far better than a generic OCR engine — it copes with
// dark mode, gradients, code and tables, and keeps the layout. The trade is real
// and the user has to opt in: this UPLOADS the image, so anything sensitive in
// the grab leaves the machine BEFORE the redaction below can run. Local Windows
// OCR stays the default precisely because it never leaves the PC.
const OCR_PROMPT =
  'Transcribe every piece of text in this screenshot, exactly as written. ' +
  'Preserve the reading order and the line breaks. Keep code, commands and ' +
  'punctuation verbatim. Output only the transcription — no preamble, no ' +
  'commentary, no markdown fences.';
async function ocrViaClaude(image){
  const key = (settings.anthropicKey || '').trim();
  if(!key) throw new Error('No Anthropic API key set — add one in Settings.');
  let Anthropic;
  try{ Anthropic = require('@anthropic-ai/sdk'); Anthropic = Anthropic.default || Anthropic; }
  catch(e){ throw new Error('The Anthropic SDK is missing from this build.'); }
  const client = new Anthropic({ apiKey: key });
  // Keep the upload small: the engine reads fine well below native resolution,
  // and image tokens scale with area.
  let feed = image;
  try{
    const sz = image.getSize();
    const long = Math.max(sz.width, sz.height);
    if(long > 1600){
      const k = 1600 / long;
      feed = image.resize({ width: Math.round(sz.width * k), height: Math.round(sz.height * k), quality: 'best' });
    }
  }catch(e){}
  const res = await client.messages.create({
    model: settings.ocrModel || 'claude-opus-5',
    max_tokens: 8000,
    // A transcription needs no deliberation; low effort keeps it quick and cheap.
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: feed.toPNG().toString('base64') } },
      { type: 'text', text: OCR_PROMPT },
    ] }],
  });
  if(res.stop_reason === 'refusal') throw new Error('Claude declined to transcribe that image.');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

async function deliverOcr(image){
  try{
    let raw = '', via = 'Windows';
    if(settings.ocrEngine === 'claude'){
      try{ raw = await ocrViaClaude(image); via = 'Claude'; }
      catch(err){
        // Never lose the grab to a cloud failure — fall back to the local engine
        // and say which one actually ran.
        console.error('claude ocr failed', err);
        raw = await ocrImage(image);
        try{ new Notification({ title:'Snappy Snap — Claude OCR unavailable',
          body: String(err && err.message || err).slice(0, 180) + ' — used Windows OCR instead.' }).show(); }catch(e2){}
      }
    } else {
      raw = await ocrImage(image);
    }
    if(!raw){
      new Notification({ title:'Snappy Snap — Copy text', body:'No text was found in that selection.' }).show();
      return;
    }
    const { text, masked } = settings.warnSecrets !== false ? maskSecrets(raw) : { text: raw, masked: 0 };
    clipboard.writeText(text);
    const lines = text.split('\n').length;
    new Notification({
      title: 'Snappy Snap — Text copied (' + via + ')',
      body: lines + (lines === 1 ? ' line' : ' lines') + ' on the clipboard' +
            (masked ? ' · ' + masked + ' secret' + (masked === 1 ? '' : 's') + ' redacted' : ''),
    }).show();
  }catch(e){
    console.error('ocr failed', e);
    try{ new Notification({ title:'Snappy Snap — Copy text failed', body:String(e && e.message || e).slice(0, 200) }).show(); }catch(e2){}
  }
}
const isTerminalApp = (a) => /powershell|pwsh|cmd|conhost|windowsterminal|wt|terminal/i.test(a || '');

// Fired AFTER an image grab (never blocks it): if the shot was of a terminal
// holding something key-shaped, say so — the user can redo it as masked text.
async function warnIfSecretsOnScreen(){
  try{
    const info = await getForegroundInfo();
    if(!info || !isTerminalApp(info.app)) return;
    const r = await readTerminalText();
    if(!r || !r.ok || !hasSecrets(r.text)) return;
    const n = new Notification({
      title: 'Snappy Snap — possible API key in that shot',
      body: 'This terminal contains something key-shaped. ' + (settings.termHotkey || 'The terminal hotkey') + ' captures it as text with secrets masked.',
    });
    n.on('click', () => captureTerminalText().catch(() => {}));
    n.show();
  }catch(e){}
}

async function captureActiveWindow(){
  const info = await getForegroundInfo();
  const title = (info && info.title) || '';
  const appName = (info && info.app) || '';
  // A terminal window has real text behind it — grab THAT (sharper, unlimited
  // scrollback, secrets masked) rather than pixels that can leak a key.
  if(settings.terminalAsText !== false && isTerminalApp(appName)){
    const r = await readTerminalText();
    if(r && r.ok && r.text && r.text.trim()){ await deliverTerminalText(r); return; }
  }
  let sources;
  // Same reason as the marquee path: a pin or the shelf overlapping the target
  // window can end up composited into its thumbnail.
  await hideOwnWindows();
  try{ sources = await desktopCapturer.getSources({ types:['window'], thumbnailSize:{ width:3840, height:2160 } }); }
  catch(e){ console.error('window sources failed', e); restoreOwnWindows(); return; }
  const mine = ['Snappy Snap', 'Snappy Snap — Settings', 'Snappy Frame'];
  let src = (title && sources.find(s => s.name === title))
    || (title && sources.find(s => s.name && (s.name.includes(title) || title.includes(s.name))))
    || sources.find(s => s.name && !mine.includes(s.name));
  if(!src){ restoreOwnWindows(); try{ new Notification({ title:'Snappy Snap', body:'Couldn’t find the active window' }).show(); }catch(e){} return; }
  const img = src.thumbnail;
  if(!img || img.isEmpty()){ restoreOwnWindows(); try{ new Notification({ title:'Snappy Snap', body:'That window can’t be captured — try the marquee (Ctrl+Shift+1)' }).show(); }catch(e){} return; }
  restoreOwnWindows();                                // frame is taken; put them back
  await handleResult(img, { appName: appName || src.name });
}

// ---- whole-screen capture (no marquee) -----------------------------------
// The screen under the cursor, grabbed and delivered in one keystroke. The
// marquee path already takes exactly this frame before it shows anything, so
// this is the same capture minus the crop — and it keeps the hover-safety
// contract: nothing of ours is on screen when the frame is taken.
async function captureWholeScreen(){
  if(overlayBusy) return;
  overlayBusy = true;
  try{
    const pt = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(pt);
    const sf = display.scaleFactor || 1;
    const px = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };
    await hideOwnWindows();
    const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize: px });
    const displays = screen.getAllDisplays();
    const idx = displays.findIndex(d => d.id === display.id);
    const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[idx] || sources[0];
    restoreOwnWindows();
    if(!src || src.thumbnail.isEmpty()){
      try{ new Notification({ title:'Snappy Snap', body:'Couldn’t read the screen' }).show(); }catch(e){}
      return;
    }
    await handleResult(src.thumbnail);
  }catch(e){
    console.error('captureWholeScreen failed', e); restoreOwnWindows();
  }finally{ overlayBusy = false; returnBar(); }
}

// ---- every monitor, composited into one image ----------------------------
// Blit each display's frame into one BGRA canvas laid out the way the desktop
// actually is. Everything is scaled to the SHARPEST display's pixel density, so
// a 4K screen beside a 1080p one keeps its detail instead of the whole shot
// being dragged down to the coarser grid. Exported for the test harness.
function compositeDisplays(parts, W, H){
  // Opaque black where no monitor reaches. A non-rectangular desktop leaves
  // gaps, and transparency there reads as black in some apps and as the card
  // colour in others — so make it black everywhere, deliberately.
  const out = Buffer.alloc(W * H * 4);
  for(let i = 3; i < out.length; i += 4) out[i] = 255;
  for(const p of parts){
    const { bitmap, w, h, x, y } = p;
    for(let row = 0; row < h; row++){
      const dy = y + row;
      if(dy < 0 || dy >= H) continue;
      const sxPx = Math.max(0, -x), n = Math.min(w - sxPx, W - Math.max(0, x));
      if(n <= 0) continue;
      bitmap.copy(out, ((dy * W) + Math.max(0, x)) * 4, (row * w + sxPx) * 4, (row * w + sxPx + n) * 4);
    }
  }
  return out;
}
async function captureAllScreens(){
  if(overlayBusy) return;
  const displays = screen.getAllDisplays();
  if(displays.length < 2){ return captureWholeScreen(); }   // nothing to stitch
  overlayBusy = true;
  try{
    const scale = Math.max(...displays.map(d => d.scaleFactor || 1));
    const minX = Math.min(...displays.map(d => d.bounds.x)), minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    const W = Math.round((maxX - minX) * scale), H = Math.round((maxY - minY) * scale);
    if(W < 1 || H < 1 || W * H > 200e6){                    // ~200 Mpx of BGRA is already 800 MB
      try{ new Notification({ title:'Snappy Snap', body:'That desktop is too large to stitch into one image' }).show(); }catch(e){}
      return;
    }
    await hideOwnWindows();
    const sources = await desktopCapturer.getSources({ types:['screen'],
      thumbnailSize: { width: Math.round((maxX - minX) * scale), height: Math.round((maxY - minY) * scale) } });
    restoreOwnWindows();
    const parts = [];
    displays.forEach((d, i) => {
      const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[i];
      if(!src || src.thumbnail.isEmpty()) return;
      // thumbnailSize is a MAXIMUM and preserves aspect, so each display comes
      // back at its own size — resize it to the slot it occupies on the canvas.
      const tw = Math.round(d.bounds.width * scale), th = Math.round(d.bounds.height * scale);
      const sz = src.thumbnail.getSize();
      const img = (sz.width === tw && sz.height === th) ? src.thumbnail
                : src.thumbnail.resize({ width: tw, height: th, quality: 'best' });
      parts.push({ bitmap: img.toBitmap(), w: tw, h: th,
                   x: Math.round((d.bounds.x - minX) * scale), y: Math.round((d.bounds.y - minY) * scale) });
    });
    if(!parts.length){
      try{ new Notification({ title:'Snappy Snap', body:'Couldn’t read the screens' }).show(); }catch(e){}
      return;
    }
    const img = nativeImage.createFromBuffer(compositeDisplays(parts, W, H), { width: W, height: H });
    if(img.isEmpty()){
      try{ new Notification({ title:'Snappy Snap', body:'Couldn’t stitch the screens' }).show(); }catch(e){}
      return;
    }
    await handleResult(img);
  }catch(e){
    console.error('captureAllScreens failed', e); restoreOwnWindows();
  }finally{ overlayBusy = false; returnBar(); }
}

// ---- terminal scrollback capture (text, not pixels) ----------------------
// A terminal's scrollback is text, so instead of scroll-and-stitching pixels
// we read the buffer itself and hand it to Snappy Frame's Text cards, which
// render it as a crisp framed card at any length. Two routes, one PowerShell
// one-shot: classic conhost windows (powershell/cmd) expose the whole buffer
// via the console API; Windows Terminal exposes it via UI Automation's
// TextPattern (the same surface screen readers use).
function readTerminalText(){
  return new Promise((resolve) => {
    if(process.platform !== 'win32'){ resolve(null); return; }
    const ps = [
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
      'Add-Type @"',
      'using System; using System.Runtime.InteropServices; using System.Text;',
      'public class TG {',
      ' [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      ' [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);',
      ' [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
      ' [DllImport("kernel32.dll")] public static extern bool FreeConsole();',
      ' [DllImport("kernel32.dll")] public static extern bool AttachConsole(int pid);',
      ' [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateFile(string n, uint a, uint s, IntPtr se, uint d, uint f, IntPtr t);',
      ' [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }',
      ' [StructLayout(LayoutKind.Sequential)] public struct SRECT { public short L; public short T; public short R; public short B; }',
      ' [StructLayout(LayoutKind.Sequential)] public struct CSBI { public COORD Size; public COORD Cur; public ushort Attr; public SRECT Win; public COORD Max; }',
      ' [DllImport("kernel32.dll")] public static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI i);',
      ' [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool ReadConsoleOutputCharacter(IntPtr h, StringBuilder b, uint len, COORD c, out uint n);',
      '}',
      '"@',
      '$h=[TG]::GetForegroundWindow()',
      '$sb=New-Object System.Text.StringBuilder 512',
      '[TG]::GetWindowText($h,$sb,512)|Out-Null',
      '$title=$sb.ToString()',
      '$procId=0',
      '[TG]::GetWindowThreadProcessId($h,[ref]$procId)|Out-Null',
      '$app=""',
      'try{ $app=(Get-Process -Id $procId).ProcessName }catch{}',
      '$text=$null',
      '$err=""',
      // Windows Terminal hosts the shell in a CHILD process, so the window's own
      // pid has no console. Try it first, then every descendant.
      '$cands=New-Object System.Collections.Generic.List[int]',
      '$cands.Add($procId)',
      'try{',
      ' $all=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name',
      ' $queue=New-Object System.Collections.Generic.Queue[int]',
      ' $queue.Enqueue($procId)',
      ' while($queue.Count -gt 0){',
      '  $p=$queue.Dequeue()',
      '  foreach($k in $all){ if($k.ParentProcessId -eq $p -and -not $cands.Contains([int]$k.ProcessId)){ $cands.Add([int]$k.ProcessId); $queue.Enqueue([int]$k.ProcessId) } }',
      ' }',
      '}catch{}',
      'foreach($cpid in $cands){',
      'if($text){ break }',
      'try{',
      ' [TG]::FreeConsole()|Out-Null',
      ' if([TG]::AttachConsole($cpid)){',
      '  $out=[TG]::CreateFile("CONOUT$",0xC0000000,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)',
      '  if($out -ne [IntPtr]::Zero -and $out.ToInt64() -ne -1){',
      '   $info=New-Object "TG+CSBI"',
      '   if([TG]::GetConsoleScreenBufferInfo($out,[ref]$info)){',
      '    $w=[int]$info.Size.X',
      '    $rows=[int]$info.Cur.Y+1',
      '    if($w -gt 0 -and $rows -gt 0){',
      '     $len=[uint32]($w*$rows)',
      '     $buf=New-Object System.Text.StringBuilder ([int]$len)',
      '     $pos=New-Object "TG+COORD"',
      '     $n=[uint32]0',
      '     if([TG]::ReadConsoleOutputCharacter($out,$buf,$len,$pos,[ref]$n)){',
      '      $s=$buf.ToString()',
      '      $ls=New-Object System.Collections.Generic.List[string]',
      '      for($y=0;$y -lt $rows;$y++){ $i=$y*$w; if($i -ge $s.Length){ break }; $ls.Add($s.Substring($i,[Math]::Min($w,$s.Length-$i)).TrimEnd()) }',
      '      $text=([string]::Join("`n",$ls)).TrimEnd()',
      '     }',
      '    }',
      '   }',
      '  }',
      ' }',
      '}catch{ $err=$_.Exception.Message }',
      '}',
      'if(-not $text){',
      ' try{',
      '  Add-Type -AssemblyName UIAutomationClient',
      '  Add-Type -AssemblyName UIAutomationTypes',
      '  $el=[System.Windows.Automation.AutomationElement]::FromHandle($h)',
      '  $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty,$true)',
      // FindFirst returned the TAB BAR in Windows Terminal. Take the LONGEST
      // text of all candidates instead — that is the scrollback buffer.
      '  $els=$el.FindAll([System.Windows.Automation.TreeScope]::Subtree,$cond)',
      '  $best=""',
      '  foreach($e in $els){',
      '   try{',
      '    $pat=$e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)',
      '    $t=$pat.DocumentRange.GetText(-1)',
      '    if($t -and $t.Length -gt $best.Length){ $best=$t }',
      '   }catch{}',
      '  }',
      '  if($best -and $best.Trim().Length -gt 0){ $text=$best }',
      '  elseif(-not $err){ $err="no readable text surface in the focused window" }',
      ' }catch{ if(-not $err){ $err=$_.Exception.Message } }',
      '}',
      'if($text -and $text.Trim()){ @{ok=$true;app=$app;title=$title;text=$text}|ConvertTo-Json -Compress }',
      'else{ @{ok=$false;app=$app;title=$title;err=[string]$err}|ConvertTo-Json -Compress }',
    ].join('\n');
    const b64 = Buffer.from(ps, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { timeout: 9000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if(err){ resolve({ ok:false, err: String(err.message || err).slice(0, 160) }); return; }
        try{ resolve(JSON.parse(String(stdout).trim())); }catch(e){ resolve({ ok:false, err:'unexpected reader output' }); }
      });
  });
}

async function captureTerminalText(){
  const r = await readTerminalText();
  if(!r || !r.ok || !r.text || !r.text.trim()){
    const why = (r && r.err) ? (' — ' + String(r.err).slice(0, 120)) : '';
    try{ new Notification({ title:'Snappy Snap', body:'Couldn’t read that window as text' + why }).show(); }catch(e){}
    return;
  }
  await deliverTerminalText(r);
}

// Tidy the buffer and hand it to Snappy Frame (which masks secrets on render).
async function deliverTerminalText(r){
  let lines = String(r.text).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
  while(lines.length && !lines[0]) lines.shift();
  while(lines.length && !lines[lines.length - 1]) lines.pop();
  const text = lines.join('\n').slice(0, 200000);
  if(!text){ try{ new Notification({ title:'Snappy Snap', body:'That terminal appears to be empty' }).show(); }catch(e){} return; }
  const a = (r.app || '').toLowerCase();
  const title = /powershell|pwsh/.test(a) ? 'PowerShell'
    : a === 'cmd' ? 'Command Prompt'
    : (r.title && r.title.trim()) ? r.title.trim().slice(0, 80)
    : (r.app || 'Terminal');
  openBeautifyText(text, title);
}

// Hand terminal text to Snappy Frame, which renders it as a Text card.
function openBeautifyText(text, title){
  const w = new BrowserWindow({ width:1240, height:840, title:'Snappy Frame', autoHideMenuBar:true });
  w.loadURL(settings.beautifyUrl);
  w.webContents.on('did-finish-load', () => {
    const js = 'window.postMessage(' + JSON.stringify({ type:'snappy-frame-text', text, title }) + ', "*");';
    setTimeout(() => { w.webContents.executeJavaScript(js).catch(() => {}); }, 700);
  });
}

// ---- hotkey / lifecycle --------------------------------------------------
function registerHotkey(){
  globalShortcut.unregisterAll();
  try{ const ok = globalShortcut.register(settings.hotkey, () => startCapture()); if(!ok) console.error('hotkey register returned false'); }
  catch(e){ console.error('hotkey failed', e); }
  if(settings.windowHotkey){
    try{ globalShortcut.register(settings.windowHotkey, () => captureActiveWindow().catch(e => console.error(e))); }
    catch(e){ console.error('window hotkey failed', e); }
  }
  if(settings.markupHotkey){
    try{ globalShortcut.register(settings.markupHotkey, () => startCapture('markup')); }
    catch(e){ console.error('markup hotkey failed', e); }
  }
  if(settings.screenHotkey){
    try{ globalShortcut.register(settings.screenHotkey, () => captureWholeScreen().catch(e => console.error(e))); }
    catch(e){ console.error('screen hotkey failed', e); }
  }
  if(settings.allHotkey){
    try{ globalShortcut.register(settings.allHotkey, () => captureAllScreens().catch(e => console.error(e))); }
    catch(e){ console.error('all-monitors hotkey failed', e); }
  }
  if(settings.batchHotkey){
    try{ globalShortcut.register(settings.batchHotkey, () => startCapture('batch')); }
    catch(e){ console.error('batch hotkey failed', e); }
  }
  if(settings.shelfHotkey){
    try{ globalShortcut.register(settings.shelfHotkey, () => toggleShelf()); }
    catch(e){ console.error('shelf hotkey failed', e); }
  }
  if(settings.termHotkey){
    try{ globalShortcut.register(settings.termHotkey, () => captureTerminalText().catch(e => console.error(e))); }
    catch(e){ console.error('terminal hotkey failed', e); }
  }
  if(settings.barHotkey){
    try{ globalShortcut.register(settings.barHotkey, () => toggleBar()); }
    catch(e){ console.error('bar hotkey failed', e); }
  }
  if(settings.ocrHotkey){
    try{ globalShortcut.register(settings.ocrHotkey, () => startCapture('ocr')); }
    catch(e){ console.error('ocr hotkey failed', e); }
  }
  if(settings.pinHotkey){
    try{ globalShortcut.register(settings.pinHotkey, () => startCapture('pin')); }
    catch(e){ console.error('pin hotkey failed', e); }
  }
}

// ---- command line ---------------------------------------------------------
// The app lives in the tray, so a second launch is a REMOTE CONTROL, not a
// second copy: Electron hands its argv to the running instance, which performs
// the capture. That makes every mode scriptable and bindable to whatever
// shortcut manager you already use. Pure parser, exported for the tests.
const CLI_MODES = ['region','window','screen','all','markup','ocr','pin','batch','bar','shelf'];
function parseCli(argv){
  // argv arrives as the full process argv; drop the exe and any Electron/Chromium
  // switches so `snappy-snap.exe --region` and `electron . --region` parse alike.
  const args = (argv || []).slice(1).filter(a => typeof a === 'string' && !a.startsWith('--inspect') && a !== '.');
  const out = { mode: null, delay: 0, dir: null, clipboard: null, save: null };
  let seen = false;
  for(let i = 0; i < args.length; i++){
    const a = args[i];
    if(!a.startsWith('--')) continue;
    const [kRaw, inlineVal] = a.slice(2).split('=');
    const k = kRaw.toLowerCase();
    const val = () => (inlineVal !== undefined ? inlineVal : (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : ''));
    if(CLI_MODES.includes(k)){ out.mode = k; seen = true; }
    else if(k === 'delay'){ out.delay = Math.max(0, Math.min(60000, parseInt(val(), 10) || 0)); seen = true; }
    else if(k === 'path'){ const v = val(); if(v){ out.dir = v; seen = true; } }
    else if(k === 'clipboard'){ out.clipboard = true; seen = true; }
    else if(k === 'no-clipboard'){ out.clipboard = false; seen = true; }
    else if(k === 'save'){ out.save = true; seen = true; }
    else if(k === 'no-save'){ out.save = false; seen = true; }
  }
  if(!seen) return null;                                   // an ordinary launch, not a command
  if(!out.mode) out.mode = 'region';                       // options with no mode still mean "capture a region"
  return out;
}
// Per-capture overrides live here for exactly one capture. Captures are
// serialised by overlayBusy, so there is no second command to race with.
let cliOverride = null;
async function runCli(cmd){
  if(!cmd) return;
  if(cmd.mode === 'bar'){ toggleBar(); return; }
  if(cmd.mode === 'shelf'){ toggleShelf(); return; }
  if(cmd.delay) await new Promise(r => setTimeout(r, cmd.delay));
  cliOverride = { dir: cmd.dir, clipboard: cmd.clipboard, save: cmd.save };
  try{
    if(cmd.mode === 'window') await captureActiveWindow();
    else if(cmd.mode === 'screen') await captureWholeScreen();
    else if(cmd.mode === 'all') await captureAllScreens();
    else startCapture(['markup','ocr','pin','batch'].includes(cmd.mode) ? cmd.mode : 'normal');
  }catch(e){ console.error('cli capture failed', e); cliOverride = null; }
}

if(!app.requestSingleInstanceLock()){
  app.quit();                                    // the running copy handles the argv below
} else {
  app.on('second-instance', (e, argv) => { try{ runCli(parseCli(argv)); }catch(err){ console.error('cli failed', err); } });
  app.whenReady().then(() => {
    loadSettings(); loadHistory(); loadShares(); ensureFolder(); buildTray(); registerHotkey(); ensureOverlay();
    if(process.platform === 'darwin' && app.dock) app.dock.hide();   // tray-only
    // Prime the screen-capture pipeline so the first grab isn't a cold start.
    setTimeout(() => { desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:1, height:1 } }).catch(() => {}); }, 600);
    // A first launch can carry a command too (someone scripting a cold start).
    const first = parseCli(process.argv);
    if(first) setTimeout(() => runCli(first), 900);
  });
}
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
