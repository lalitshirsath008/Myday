const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkStrip', {
  onShow: (fn) => ipcRenderer.on('strip:show', (_e, a) => fn(a)),
  open: () => ipcRenderer.send('strip:open'),
  done: () => ipcRenderer.send('strip:done'),
});
