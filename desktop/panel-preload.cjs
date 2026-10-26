// Gives the WorkTrack page (/widget/my-day) two small hooks into the desktop app. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkWidget', {
  hide: () => ipcRenderer.send('panel:hide'),
  setCount: (done, total) => ipcRenderer.send('panel:count', done, total),
});
