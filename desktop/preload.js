// Bridge a tiny, safe API into the overlay + settings windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snap', {
  // overlay
  getData: () => ipcRenderer.invoke('overlay:data'),
  onOverlayShow: (cb) => ipcRenderer.on('overlay:show', (e, d) => cb(d)),
  commit: (rect) => ipcRenderer.send('overlay:commit', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  // mark-up editor
  getAnnotate: () => ipcRenderer.invoke('annotator:data'),
  annotateDone: (payload) => ipcRenderer.send('annotator:done', payload),
  annotateCancel: () => ipcRenderer.send('annotator:cancel'),
  annotateReport: (msg) => ipcRenderer.send('annotator:report', msg),
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
