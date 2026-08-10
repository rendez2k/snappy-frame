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
function hideOverlay(){ overlayBusy = false; if(overlayWin && !overlayWin.isDestroyed()) overlayWin.hide(); }

let grabSeq = 0, shotPromise = null;               // shotPromise resolves when the current grab's frame is in `pending`

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

    // Capture FIRST — the frame grab is initiated before anything is shown or
    // focused, so menus/dropdowns/popups that dismiss on focus loss are still
    // in it. (The 0.9.0 regression: showing+focusing the overlay before the
    // capture closed them, and they vanished from the shot.)
    const grab = desktopCapturer.getSources({ types:['screen'], thumbnailSize: px });

    ensureOverlay();
    if(overlayWin.webContents.isLoading()){          // only the very first grab waits for the page
      await new Promise(r => overlayWin.webContents.once('did-finish-load', r));
    }

    // Arm the marquee immediately, but WITHOUT activating it (showInactive) —
    // activation is what closes popups. The overlay draws nothing until the
    // shot lands, so the capture can't include it either.
    pending.delete(overlayWin.webContents.id);
    overlayWin.setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
    overlayWin.webContents.send('overlay:arm');
    overlayWin.showInactive();

    shotPromise = (async () => {
      const sources = await grab;
      const displays = screen.getAllDisplays();
      const idx = displays.findIndex(d => d.id === display.id);
      const src = sources.find(s => String(s.display_id) === String(display.id)) || sources[idx] || sources[0];
      if(!src || !overlayWin || overlayWin.isDestroyed()) return;
      const img = src.thumbnail;
      const size = img.getSize();
      pending.set(overlayWin.webContents.id, { img, w:size.width, h:size.height });
      // JPEG preview: ~10× smaller than a PNG dataURL of the whole screen, so
      // encode + IPC + paint are all fast. The final crop uses `img` untouched.
      if(seq === grabSeq){
        overlayWin.webContents.send('overlay:shot', { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64') });
        overlayWin.focus();                          // frame is safe now — take focus so Esc works
      }
    })();
    shotPromise.catch(e => { console.error('capture failed', e); if(seq === grabSeq) hideOverlay(); });
  }catch(e){ console.error('startCapture failed', e); overlayBusy = false; }
}

ipcMain.on('overlay:cancel', (e) => { pending.delete(e.sender.id); hideOverlay(); });
ipcMain.on('overlay:commit', async (e, rect) => {
  hideOverlay();                                     // overlay vanishes the instant the drag ends
  try{ if(shotPromise) await shotPromise; }catch(_){} // near-always already resolved by mouse-up
  const data = pending.get(e.sender.id);
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
  if('hotkey' in patch || 'windowHotkey' in patch || 'markupHotkey' in patch || 'batchHotkey' in patch) registerHotkey();
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
}

app.whenReady().then(() => {
  loadSettings(); ensureFolder(); buildTray(); registerHotkey(); ensureOverlay();
  if(process.platform === 'darwin' && app.dock) app.dock.hide();   // tray-only
  // Prime the screen-capture pipeline so the first grab isn't a cold start.
  setTimeout(() => { desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width:1, height:1 } }).catch(() => {}); }, 600);
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
