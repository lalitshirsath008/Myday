const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkStrip', {
  onShow: (fn) => ipcRenderer.on('strip:show', (_e, a) => fn(a)),
  open: (data) => ipcRenderer.send('strip:open', data),
  done: () => ipcRenderer.send('strip:done'),
});
