// Snappy Snap — rapid marquee screen capture (tray app).
// Hotkey → freeze the screen under the cursor → drag a rectangle → save to a
// folder + copy to clipboard (raw, no frame), or open it in Snappy Frame.
const { app, BrowserWindow, globalShortcut, desktopCapturer, screen, clipboard,
  nativeImage, Tray, Menu, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  hotkey: 'CommandOrControl+Shift+1',
  saveFolder: path.join(app.getPath('pictures'), 'Snappy Snaps'),
  saveToFolder: true,
  copyToClipboard: true,
  defaultAction: 'save',                          // 'save' (raw/no frame) | 'beautify'
  beautifyUrl: 'https://snappy-frame.netlify.app',
  sendToInbox: false,                             // also upload each snap to the online inbox
  inboxCode: '',                                  // pairing code (snap_…) — get one at /inbox
  revealAfter: false,
  notify: true,
};
let settings = { ...DEFAULTS };

function loadSettings(){ try{ settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }; }catch(e){ settings = { ...DEFAULTS }; } }
function saveSettings(){ try{ fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive:true }); fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2)); }catch(e){ console.error(e); } }
function ensureFolder(){ try{ fs.mkdirSync(settings.saveFolder, { recursive:true }); }catch(e){} }

let tray = null, overlayWin = null, settingsWin = null, beautifyWin = null;
const pending = new Map();                         // webContents.id -> { dataUrl, w, h }

// ---- capture flow --------------------------------------------------------
async function startCapture(){
  if(overlayWin) return;                           // one marquee at a time
  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  const sf = display.scaleFactor || 1;
  const px = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };

  let sources;
  try{ sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize: px }); }
  catch(e){ console.error('getSources failed', e); return; }

  const displays = screen.getAllDisplays();
  const idx = displays.findIndex(d => d.id === display.id);
  let src = sources.find(s => String(s.display_id) === String(display.id)) || sources[idx] || sources[0];
  if(!src){ return; }
  const size = src.thumbnail.getSize();

  overlayWin = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    frame:false, transparent:true, backgroundColor:'#00000000',
    alwaysOnTop:true, skipTaskbar:true, resizable:false, movable:false,
    hasShadow:false, fullscreenable:false, enableLargerThanScreen:true, show:false,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true },
  });
  pending.set(overlayWin.webContents.id, { dataUrl: src.thumbnail.toDataURL(), w:size.width, h:size.height });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile('overlay.html');
  overlayWin.once('ready-to-show', () => { overlayWin.show(); overlayWin.focus(); });
  overlayWin.on('closed', () => { overlayWin = null; });
}

ipcMain.handle('overlay:data', (e) => pending.get(e.sender.id) || null);
ipcMain.on('overlay:cancel', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if(w){ pending.delete(e.sender.id); w.close(); } });
ipcMain.on('overlay:commit', async (e, rect) => {
  const data = pending.get(e.sender.id);
  const w = BrowserWindow.fromWebContents(e.sender);
  pending.delete(e.sender.id);
  if(w) w.close();
  if(!data || !rect) return;
  const full = nativeImage.createFromDataURL(data.dataUrl);
  const iw = data.w, ih = data.h;
  let cx = Math.round(rect.x * iw), cy = Math.round(rect.y * ih);
  let cw = Math.round(rect.w * iw), ch = Math.round(rect.h * ih);
  cx = Math.max(0, Math.min(cx, iw - 1)); cy = Math.max(0, Math.min(cy, ih - 1));
  cw = Math.max(1, Math.min(cw, iw - cx)); ch = Math.max(1, Math.min(ch, ih - cy));
  const crop = full.crop({ x:cx, y:cy, width:cw, height:ch });
  await handleResult(crop);
});

async function handleResult(image){
  if(settings.copyToClipboard){ try{ clipboard.writeImage(image); }catch(e){} }
  let savedPath = null;
  if(settings.saveToFolder){
    ensureFolder();
    savedPath = path.join(settings.saveFolder, 'snap-' + stamp() + '.png');
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

function stamp(){ const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }

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
    { label: 'Capture now   (' + settings.hotkey + ')', click: () => startCapture() },
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
  settingsWin = new BrowserWindow({ width:520, height:560, title:'Snappy Snap — Settings', resizable:false, autoHideMenuBar:true,
    webPreferences:{ preload: path.join(__dirname, 'preload.js'), contextIsolation:true } });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---- settings IPC --------------------------------------------------------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, patch) => {
  const oldHotkey = settings.hotkey;
  settings = { ...settings, ...patch };
  saveSettings();
  if(patch.hotkey && patch.hotkey !== oldHotkey) registerHotkey();
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

// ---- hotkey / lifecycle --------------------------------------------------
function registerHotkey(){
  globalShortcut.unregisterAll();
  try{ const ok = globalShortcut.register(settings.hotkey, () => startCapture()); if(!ok) console.error('hotkey register returned false'); }
  catch(e){ console.error('hotkey failed', e); }
}

app.whenReady().then(() => {
  loadSettings(); ensureFolder(); buildTray(); registerHotkey();
  if(process.platform === 'darwin' && app.dock) app.dock.hide();   // tray-only
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
