const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkBanner', {
  onShow: (fn) => ipcRenderer.on('banner:show', (_e, n) => fn(n)),
  click: () => ipcRenderer.send('banner:click'),
  done: () => ipcRenderer.send('banner:done'),
});
