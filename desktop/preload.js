// Bridge a tiny, safe API into the overlay + settings windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snap', {
  // overlay
  getData: () => ipcRenderer.invoke('overlay:data'),
  commit: (rect) => ipcRenderer.send('overlay:commit', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  openFolder: () => ipcRenderer.send('settings:openFolder'),
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (on) => ipcRenderer.invoke('autostart:set', on),
});
