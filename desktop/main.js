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

let tray = null, overlayWin = null, settingsWin = null, beautifyWin = null, annotatorWin = null, batchWin = null;
const pending = new Map();                         // webContents.id -> { img (nativeImage), w, h }
const annPending = new Map();                      // annotator webContents.id -> { dataUrl, w, h }
const batch = [];                                  // collected region grabs (full-res dataURLs) awaiting hand-off
let captureMode = 'normal';                        // 'normal' | 'markup' | 'batch' — what to do after the marquee

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
  if(overlayWin && !overlayWin.isDestroyed()){
    overlayWin.webContents.send('overlay:clear');    // wipe the frozen shot while hidden, so it can never flash on the next grab
    overlayWin.hide();
  }
}

let grabSeq = 0;
let readyResolve = null;                           // resolves when the renderer confirms the frozen frame is painted
ipcMain.on('overlay:ready', () => { if(readyResolve){ readyResolve(); readyResolve = null; } });

async function startCapture(mode){
  if(overlayBusy) return;                           // one marquee at a time
  overlayBusy = true;
  const seq = ++grabSeq;
  captureMode = (mode === 'markup' || mode === 'batch') ? mode : 'normal';
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
    overlayWin.webContents.send('overlay:show', { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64') });
    await Promise.race([ready, new Promise(r => setTimeout(r, 400))]);
    readyResolve = null;
    if(seq !== grabSeq){ return; }                   // superseded while waiting
    overlayWin.show(); overlayWin.focus();
  }catch(e){ console.error('startCapture failed', e); overlayBusy = false; }
}

ipcMain.on('overlay:cancel', (e) => { pending.delete(e.sender.id); hideOverlay(); });
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
  if(captureMode === 'batch'){ addToBatch(crop.toDataURL()); return; }
  if(captureMode === 'markup'){ openAnnotator(crop.toDataURL()); return; }
  await handleResult(crop);
});

function sanitizeName(s){ return String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60); }

async function handleResult(image, ctx){
  if(settings.copyToClipboard || (ctx && ctx.forceCopy)){ try{ clipboard.writeImage(image); }catch(e){} }
  let savedPath = null;
  if(settings.saveToFolder){
    ensureFolder();
    const n = nameParts();
    let dir = settings.saveFolder, base;
    // window grabs know the app → file under <App>\; marquee grabs don't.
    const appDir = ctx && ctx.appName ? sanitizeName(ctx.appName) : '';
    if(appDir) dir = path.join(dir, appDir);
    if(settings.dailyFolders){                    // …\[App\]\YYYY-MM-DD\Snap 16.15.26.png
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

function notify(savedPath, inboxOk){
  const bits = [];
  if(savedPath) bits.push('Saved ' + path.basename(savedPath));
  if(settings.copyToClipboard) bits.push('copied to clipboard');
  if(inboxOk === true) bits.push('sent to inbox');
  else if(inboxOk === false) bits.push('inbox failed');
  try{ new Notification({ title:'Snappy Snap', body: bits.join(' · ') || 'Captured' }).show(); }catch(e){}
}

// ---- beautify (hand the crop to Snappy Frame, same protocol as the extension)
function openBeautify(dataUrl){
  beautifyWin = new BrowserWindow({ width:1240, height:840, title:'Snappy Frame', autoHideMenuBar:true });
  beautifyWin.loadURL(settings.beautifyUrl);
  beautifyWin.webContents.on('did-finish-load', () => {
    const js = 'window.postMessage(' + JSON.stringify({ type:'snappy-frame-image', dataUrl }) + ', "*");';
    setTimeout(() => { beautifyWin.webContents.executeJavaScript(js).catch(() => {}); }, 700);
  });
  beautifyWin.on('closed', () => { beautifyWin = null; });
}

// ---- mark-up editor ------------------------------------------------------
// Hand the fresh crop to a canvas annotator; on finish it posts back a flattened
// PNG. Markup always copies to the clipboard (that's the point — paste into a
// chat), plus save/inbox/notify per the normal settings.
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
ipcMain.on('annotator:cancel', (e) => { const w = BrowserWindow.fromWebContents(e.sender); annPending.delete(e.sender.id); if(w) w.close(); });
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
    if(payload.action === 'beautify'){ try{ clipboard.writeImage(img); }catch(e2){} openBeautify(img.toDataURL()); return; }
    await handleResult(img, { markup: true, forceCopy: true });
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
    { label: 'Capture & mark up   (' + (settings.markupHotkey || '—') + ')', click: () => startCapture('markup') },
    { label: 'Add to batch   (' + (settings.batchHotkey || '—') + ')', click: () => startCapture('batch') },
    { label: 'Capture terminal text   (' + (settings.termHotkey || '—') + ')', click: () => captureTerminalText().catch((e) => console.error(e)) },
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
  if('hotkey' in patch || 'windowHotkey' in patch || 'markupHotkey' in patch || 'batchHotkey' in patch || 'termHotkey' in patch) registerHotkey();
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

async function captureActiveWindow(){
  const info = await getForegroundInfo();
  const title = (info && info.title) || '';
  const appName = (info && info.app) || '';
  let sources;
  try{ sources = await desktopCapturer.getSources({ types:['window'], thumbnailSize:{ width:3840, height:2160 } }); }
  catch(e){ console.error('window sources failed', e); return; }
  const mine = ['Snappy Snap', 'Snappy Snap — Settings', 'Snappy Frame'];
  let src = (title && sources.find(s => s.name === title))
    || (title && sources.find(s => s.name && (s.name.includes(title) || title.includes(s.name))))
    || sources.find(s => s.name && !mine.includes(s.name));
  if(!src){ try{ new Notification({ title:'Snappy Snap', body:'Couldn’t find the active window' }).show(); }catch(e){} return; }
  const img = src.thumbnail;
  if(!img || img.isEmpty()){ try{ new Notification({ title:'Snappy Snap', body:'That window can’t be captured — try the marquee (Ctrl+Shift+1)' }).show(); }catch(e){} return; }
  await handleResult(img, { appName: appName || src.name });
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
      'try{',
      ' [TG]::FreeConsole()|Out-Null',
      ' if([TG]::AttachConsole($procId)){',
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
      'if(-not $text){',
      ' try{',
      '  Add-Type -AssemblyName UIAutomationClient',
      '  Add-Type -AssemblyName UIAutomationTypes',
      '  $el=[System.Windows.Automation.AutomationElement]::FromHandle($h)',
      '  $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty,$true)',
      '  $tEl=$el.FindFirst([System.Windows.Automation.TreeScope]::Subtree,$cond)',
      '  if($tEl){',
      '   $pat=$tEl.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)',
      '   $text=$pat.DocumentRange.GetText(-1)',
      '  } elseif(-not $err){ $err="no readable text surface in the focused window" }',
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
  // Tidy: per-line right-trim, drop leading/trailing blank lines, cap size.
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
  if(settings.batchHotkey){
    try{ globalShortcut.register(settings.batchHotkey, () => startCapture('batch')); }
    catch(e){ console.error('batch hotkey failed', e); }
  }
  if(settings.termHotkey){
    try{ globalShortcut.register(settings.termHotkey, () => captureTerminalText().catch(e => console.error(e))); }
    catch(e){ console.error('terminal hotkey failed', e); }
  }
}

app.whenReady().then(() => {
  loadSettings(); ensureFolder(); buildTray(); registerHotkey(); ensureOverlay();
  if(process.platform === 'darwin' && app.dock) app.dock.hide();   // tray-only
  // Prime the screen-capture pipeline so the first grab isn't a cold start.
  setTimeout(() => { desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:1, height:1 } }).catch(() => {}); }, 600);
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
