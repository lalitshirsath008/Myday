// RGK WorkTrack desktop companion.
// Puts the "My day" tab on the right edge of the screen, above every app. Clicking it slides
// out the same My day panel as the website (it loads <appUrl>/widget/my-day).
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// ---- small persisted settings (tab position & server URL) ----
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writeSettings(patch) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }));
  } catch {
    // Not critical: the tab just goes back to its default place next time.
  }
}

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const activeSettings = readSettings();
const appUrlStr = process.env.RGK_APP_URL || activeSettings.appUrl || config.appUrl;
let APP_URL = new URL(appUrlStr);
let PANEL_URL = new URL('/widget/my-day', APP_URL).toString();
const TAB = { width: 48, height: 124 };
const PANEL_WIDTH = 420;
const BANNER = { width: 392, height: 112 };
const STRIP = { width: 600, height: 172 };

let tab, panel, tray, banner, strip;
let lastBlurHide = 0;
let lastCount = { done: 0, total: 0 };
let lastUnread = 0;

function sendTabState() {
  if (tab && !tab.isDestroyed() && tab.webContents) {
    tab.webContents.send('count', lastCount.done, lastCount.total);
    tab.webContents.send('unread', lastUnread);
  }
}

const workArea = () => screen.getPrimaryDisplay().workArea;

/** Tab position as a fraction of the work-area height, so it survives resolution changes. */
function placeTab(fraction = readSettings().tabY ?? 0.42) {
  const wa = workArea();
  const y = Math.round(wa.y + Math.min(Math.max(fraction, 0), 1) * (wa.height - TAB.height));
  tab.setBounds({ x: wa.x + wa.width - TAB.width, y, ...TAB });
}

function createTab() {
  tab = new BrowserWindow({
    ...TAB,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'tab-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  tab.setAlwaysOnTop(true, 'screen-saver');
  tab.setVisibleOnAllWorkspaces(true);
  placeTab();
  tab.loadFile(path.join(__dirname, 'tab.html'));
  tab.webContents.on('did-finish-load', () => sendTabState());
  tab.once('ready-to-show', () => !readSettings().tabHidden && tab.showInactive());
}

function panelBounds() {
  const wa = workArea();
  return { x: wa.x + wa.width - PANEL_WIDTH, y: wa.y, width: PANEL_WIDTH, height: wa.height };
}

function createPanel() {
  panel = new BrowserWindow({
    ...panelBounds(),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    thickFrame: false,
    show: false,
    backgroundColor: '#ffffff',
    title: 'My day — RGK Myday',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Keeps checking for notifications while hidden.
    webPreferences: { preload: path.join(__dirname, 'panel-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.loadURL(PANEL_URL);

  // Stay on the RGK Myday site; anything else opens in the normal browser.
  panel.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== APP_URL.origin) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  panel.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'Escape') {
        e.preventDefault();
        hidePanel();
      } else if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')) {
        e.preventDefault();
        reloadPanel();
      } else if (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')) {
        e.preventDefault();
        panel.webContents.toggleDevTools();
      }
    }
  });
  // If the site isn't reachable, show a short message with retry & localhost options.
  panel.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted
    const html = `<body style="font:14px Segoe UI,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;color:#333;text-align:center;padding:24px;box-sizing:border-box">
      <p style="font-size:17px;font-weight:600;margin:0 0 6px">Can’t reach RGK Myday</p>
      <p style="margin:0 0 16px;color:#777">${APP_URL.host} · ${String(desc).replace(/[<>&]/g, '')}</p>
      <p style="margin:0 0 16px;color:#777">No internet? It reconnects by itself as soon as you are back online.</p>
      <div style="display:flex;gap:8px">
        <button onclick="location.href='${PANEL_URL}'" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">Retry</button>
        <button onclick="location.href='http://localhost:5173/widget/my-day'" style="padding:8px 16px;background:#e5e7eb;color:#1f2937;border:none;border-radius:6px;cursor:pointer">Localhost (5173)</button>
      </div>
    </body>`;
    panel.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    scheduleRetry();
  });
  panel.on('blur', () => {
    if (panel.isVisible()) {
      lastBlurHide = Date.now();
      hidePanel();
    }
  });
  panel.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hidePanel();
    }
  });
}

function reloadPanel() {
  if (!panel || panel.isDestroyed()) return;
  panel.webContents.session
    .clearCache()
    .then(() => {
      const cur = panel.webContents.getURL();
      if (!cur || cur.startsWith('data:')) {
        panel.loadURL(PANEL_URL);
      } else {
        panel.webContents.reloadIgnoringCache();
      }
    })
    .catch(() => {
      panel.webContents.reloadIgnoringCache();
    });
}

// Offline: quietly try again every 20 seconds (and when the laptop wakes up) until the site loads.
let retryTimer = null;
const offline = () => panel && !panel.isDestroyed() && panel.webContents.getURL().startsWith('data:');
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => offline() && panel.loadURL(PANEL_URL), 20_000);
}

/** Slide the panel in from the right edge. */
function showPanel() {
  if (panel.webContents.getURL().startsWith('data:')) panel.loadURL(PANEL_URL); // retry after an offline error
  const end = panelBounds();
  const start = { ...end, x: end.x + 48 };
  panel.setBounds(start);
  panel.setOpacity(0);
  panel.show();
  panel.focus();
  tab.hide();
  const steps = 10;
  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    const t = 1 - Math.pow(1 - i / steps, 3); // ease-out
    if (panel.isDestroyed()) return clearInterval(timer);
    panel.setBounds({ ...end, x: Math.round(start.x - (start.x - end.x) * t) });
    panel.setOpacity(t);
    if (i >= steps) clearInterval(timer);
  }, 16);
}

function hidePanel() {
  if (!panel.isVisible()) return;
  panel.hide();
  placeTab();
  if (!readSettings().tabHidden) tab.showInactive();
}

function togglePanel() {
  if (panel.isVisible()) return hidePanel();
  // A click on the tab first blurs (and hides) the panel; don't reopen it straight away.
  if (Date.now() - lastBlurHide < 300) return;
  showPanel();
}

// ---- iOS-style notification banner, top-right of the screen, over every app ----
let bannerQueue = [];
let bannerCurrent = null;
let bannerReady = false;

function bannerBounds() {
  const wa = workArea();
  return { x: wa.x + wa.width - BANNER.width - 6, y: wa.y + 6, ...BANNER };
}

function createBanner() {
  banner = new BrowserWindow({
    ...bannerBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'banner-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // the chime plays without a click
    },
  });
  banner.setAlwaysOnTop(true, 'screen-saver');
  banner.loadFile(path.join(__dirname, 'banner.html'));
  banner.webContents.once('did-finish-load', () => {
    bannerReady = true;
    nextBanner();
  });
}

function nextBanner() {
  if (!bannerReady || bannerCurrent || !bannerQueue.length) return;
  bannerCurrent = bannerQueue.shift();
  banner.setBounds(bannerBounds());
  banner.webContents.send('banner:show', bannerCurrent);
  banner.showInactive();
}

function bannerDone() {
  bannerCurrent = null;
  if (!bannerQueue.length) banner.hide();
  nextBanner();
}

// ---- "Time to start" strip: slides out of the edge tab when a task's start time comes ----
let stripQueue = [];
let stripCurrent = null;
let stripReady = false;

function stripBounds() {
  const wa = workArea();
  const t = tab.getBounds();
  const y = Math.min(Math.max(Math.round(t.y + t.height / 2 - STRIP.height / 2), wa.y), wa.y + wa.height - STRIP.height);
  return { x: wa.x + wa.width - STRIP.width, y, ...STRIP };
}

function createStrip() {
  strip = new BrowserWindow({
    ...stripBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'strip-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  strip.setAlwaysOnTop(true, 'screen-saver');
  strip.loadFile(path.join(__dirname, 'strip.html'));
  strip.webContents.once('did-finish-load', () => {
    stripReady = true;
    nextStrip();
  });
}

function nextStrip() {
  if (!stripReady || stripCurrent || !stripQueue.length) return;
  stripCurrent = stripQueue.shift();
  strip.setBounds(stripBounds());
  strip.webContents.send('strip:show', stripCurrent);
  strip.showInactive();
}

function stripDone() {
  stripCurrent = null;
  if (!stripQueue.length) strip.hide();
  nextStrip();
}

function openLoginSetting() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('RGK Myday — Companion');
  const refresh = () => {
    const startsWithWindows = app.getLoginItemSettings(openLoginSetting()).openAtLogin;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open My day', click: showPanel },
        { label: 'Open RGK Myday in browser', click: () => shell.openExternal(APP_URL.toString()) },
        { type: 'separator' },
        {
          label: 'Show the tab on screen',
          type: 'checkbox',
          checked: !readSettings().tabHidden,
          click: (item) => {
            writeSettings({ tabHidden: !item.checked });
            if (item.checked) tab.showInactive();
            else tab.hide();
          },
        },
        { label: 'Move the tab back to the middle', click: () => (writeSettings({ tabY: 0.42 }), placeTab(0.42)) },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: startsWithWindows,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked, ...openLoginSetting() });
            refresh();
          },
        },
        { type: 'separator' },
        {
          label: 'Use Localhost (http://localhost:5173)',
          click: () => {
            writeSettings({ appUrl: 'http://localhost:5173' });
            APP_URL = new URL('http://localhost:5173');
            PANEL_URL = 'http://localhost:5173/widget/my-day';
            panel.loadURL(PANEL_URL);
          },
        },
        { label: 'Reload & Clear Cache (Ctrl+R)', click: () => reloadPanel() },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
  };
  refresh();
  tray.on('click', togglePanel);
}

// ---- messages from the tab and the panel page (each accepted only from its own window) ----
const from = (e, win) => win && !win.isDestroyed() && e.sender.id === win.webContents.id;
ipcMain.on('tab:toggle', (e) => from(e, tab) && togglePanel());
// Dragging uses the real cursor position, so the tab moving under the mouse doesn't skew it.
let dragStart = null;
ipcMain.on('tab:drag-start', (e) => {
  if (!from(e, tab)) return;
  dragStart = { cursorY: screen.getCursorScreenPoint().y, winY: tab.getBounds().y };
});
ipcMain.on('tab:drag-move', (e) => {
  if (!from(e, tab) || !dragStart) return;
  const wa = workArea();
  const y = Math.min(Math.max(dragStart.winY + (screen.getCursorScreenPoint().y - dragStart.cursorY), wa.y), wa.y + wa.height - TAB.height);
  tab.setBounds({ ...tab.getBounds(), y });
});
ipcMain.on('tab:drag-end', (e) => {
  if (!from(e, tab) || !dragStart) return;
  dragStart = null;
  const wa = workArea();
  writeSettings({ tabY: (tab.getBounds().y - wa.y) / Math.max(1, wa.height - TAB.height) });
});
ipcMain.on('panel:hide', (e) => from(e, panel) && hidePanel());
ipcMain.on('panel:reload', (e) => from(e, panel) && reloadPanel());
ipcMain.on('panel:count', (e, done, total) => {
  if (!from(e, panel) || !Number.isInteger(done) || !Number.isInteger(total)) return;
  lastCount = { done, total };
  sendTabState();
  const unreadSuffix = lastUnread > 0 ? ` · ${lastUnread} unread` : '';
  tray.setToolTip(total ? `My day: ${done} of ${total} done${unreadSuffix}` : `RGK Myday${unreadSuffix}`);
});
ipcMain.on('panel:unread', (e, unread) => {
  if (!from(e, panel) || !Number.isInteger(unread) || unread < 0) return;
  lastUnread = unread;
  sendTabState();
  const unreadSuffix = lastUnread > 0 ? ` · ${lastUnread} unread` : '';
  tray.setToolTip(lastCount.total ? `My day: ${lastCount.done} of ${lastCount.total} done${unreadSuffix}` : `RGK Myday${unreadSuffix}`);
});
// A new notification from the page. Only same-site links (a path like /reports/...) are accepted.
ipcMain.on('panel:notify', (e, n) => {
  if (!from(e, panel) || !n || typeof n.title !== 'string') return;
  const link = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link.slice(0, 300) : null;
  stripQueue.push({
    type: 'notification',
    id: typeof n.id === 'string' ? n.id.slice(0, 100) : null,
    title: n.title.slice(0, 200),
    body: typeof n.body === 'string' ? n.body.slice(0, 500) : '',
    timeLabel: 'New Notification',
    label: '',
    link,
    sound: n.sound !== false,
  });
  stripQueue = stripQueue.slice(-5);
  nextStrip();
});
ipcMain.on('banner:click', (e) => {
  if (!from(e, banner) || !bannerCurrent) return;
  const { id, link } = bannerCurrent;
  if (id) panel.webContents.send('notification:opened', id);
  if (link) shell.openExternal(new URL(link, APP_URL).toString());
  else showPanel();
});
ipcMain.on('banner:done', (e) => from(e, banner) && bannerDone());
// A task's start time came (from the page). Text is length-limited and shown as plain text.
ipcMain.on('panel:task-alert', (e, a) => {
  if (!from(e, panel) || !a || typeof a.title !== 'string' || typeof a.time !== 'string' || !/^\d{2}:\d{2}$/.test(a.time)) return;
  stripQueue.push({
    type: 'task',
    title: a.title.slice(0, 200),
    time: a.time,
    timeLabel: typeof a.timeLabel === 'string' ? a.timeLabel.slice(0, 20) : a.time,
    label: typeof a.label === 'string' ? a.label.slice(0, 40) : '',
    sound: a.sound !== false,
  });
  stripQueue = stripQueue.slice(-5);
  nextStrip();
});
ipcMain.on('strip:open', (e, data) => {
  if (!from(e, strip)) return;
  const current = data || stripCurrent;
  if (current?.id) panel.webContents.send('notification:opened', current.id);
  if (current?.link) shell.openExternal(new URL(current.link, APP_URL).toString());
  else showPanel();
});
ipcMain.on('strip:done', (e) => from(e, strip) && stripDone());

// One copy only: starting it again just opens the panel.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => panel && showPanel());
  app.whenReady().then(() => {
    app.setAppUserModelId('net.rgkgroup.worktrack.desktop');
    // An installed copy starts with Windows by default (it can be switched off in the tray menu).
    if (app.isPackaged && !readSettings().loginItemSet) {
      app.setLoginItemSettings({ openAtLogin: true });
      writeSettings({ loginItemSet: true });
    }
    createTab();
    createPanel();
    createBanner();
    createStrip();
    buildTray();
    powerMonitor.on('resume', () => offline() && panel.loadURL(PANEL_URL));
    screen.on('display-metrics-changed', () => {
      placeTab();
      if (panel.isVisible()) panel.setBounds(panelBounds());
    });
  });
  // Keep running in the tray when windows close; let real quits (menu, Windows shutdown) through.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => (app.isQuitting = true));
}
