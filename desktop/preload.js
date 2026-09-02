// Bridge a tiny, safe API into the overlay + settings windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snap', {
  // overlay
  onOverlayShow: (cb) => ipcRenderer.on('overlay:show', (e, d) => cb(d)),
  onOverlayClear: (cb) => ipcRenderer.on('overlay:clear', () => cb()),
  showReady: () => ipcRenderer.send('overlay:ready'),
  commit: (rect) => ipcRenderer.send('overlay:commit', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  // mark-up editor
  getAnnotate: () => ipcRenderer.invoke('annotator:data'),
  annotateDone: (payload) => ipcRenderer.send('annotator:done', payload),
  annotateCancel: () => ipcRenderer.send('annotator:cancel'),
  annotateReport: (msg) => ipcRenderer.send('annotator:report', msg),
  // floating capture bar
  barReady: () => ipcRenderer.send('bar:ready'),
  barOnState: (cb) => ipcRenderer.on('bar:state', (e, s) => cb(s)),
  barOnMode: (cb) => ipcRenderer.on('bar:mode', (e, m) => cb(m)),
  barRun: (mode) => ipcRenderer.send('bar:run', mode),
  barOption: (patch) => ipcRenderer.send('bar:option', patch),
  barSize: (px) => ipcRenderer.send('bar:size', px),
  barClose: () => ipcRenderer.send('bar:close'),
  // session shelf
  shelfReady: () => ipcRenderer.send('shelf:ready'),
  shelfOnUpdate: (cb) => ipcRenderer.on('shelf:update', (e, items) => cb(items)),
  shelfOnState: (cb) => ipcRenderer.on('shelf:state', (e, st) => cb(st)),
  shelfSize: (size) => ipcRenderer.send('shelf:size', size),
  shelfLock: (on) => ipcRenderer.send('shelf:lock', on),
  shelfDrag: (i) => ipcRenderer.send('shelf:drag', i),
  shelfCopy: (i) => ipcRenderer.send('shelf:copy', i),
  shelfRemove: (i) => ipcRenderer.send('shelf:remove', i),
  shelfReveal: (i) => ipcRenderer.send('shelf:reveal', i),
  shelfClear: () => ipcRenderer.send('shelf:clear'),
  shelfHide: () => ipcRenderer.send('shelf:hide'),
  // batch collector
  batchReady: () => ipcRenderer.send('batch:ready'),
  batchOnUpdate: (cb) => ipcRenderer.on('batch:update', (e, items) => cb(items)),
  batchAction: (name, dataUrl) => ipcRenderer.send('batch:action', { name, dataUrl }),
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  openFolder: () => ipcRenderer.send('settings:openFolder'),
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (on) => ipcRenderer.invoke('autostart:set', on),
});
