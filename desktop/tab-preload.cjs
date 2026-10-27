const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkTab', {
  toggle: () => ipcRenderer.send('tab:toggle'),
  dragStart: () => ipcRenderer.send('tab:drag-start'),
  dragMove: () => ipcRenderer.send('tab:drag-move'),
  dragEnd: () => ipcRenderer.send('tab:drag-end'),
  onCount: (fn) => ipcRenderer.on('count', (_e, done, total) => fn(done, total)),
  onUnread: (fn) => ipcRenderer.on('unread', (_e, unread) => fn(unread)),
});
