// Gives the RGK Myday page (/widget/my-day) a few small hooks into the desktop app. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgkWidget', {
  hide: () => ipcRenderer.send('panel:hide'),
  setCount: (done, total) => ipcRenderer.send('panel:count', done, total),
  setUnread: (unread) => ipcRenderer.send('panel:unread', unread),
  notify: (n) => ipcRenderer.send('panel:notify', n),
  taskAlert: (a) => ipcRenderer.send('panel:task-alert', a),
  onNotificationOpened: (fn) => {
    const handler = (_e, id) => fn(id);
    ipcRenderer.on('notification:opened', handler);
    return () => ipcRenderer.removeListener('notification:opened', handler);
  },
});
