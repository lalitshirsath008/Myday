// RGK WorkTrack desktop companion.
// Puts the "My day" tab on the right edge of the screen, above every app. Clicking it slides
// out the same My day panel as the website (it loads <appUrl>/widget/my-day).
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const APP_URL = new URL(process.env.RGK_APP_URL || config.appUrl);
const PANEL_URL = new URL('/widget/my-day', APP_URL).toString();
const TAB = { width: 34, height: 112 };
const PANEL_WIDTH = 420;

let tab, panel, tray;
let lastBlurHide = 0;

// ---- small persisted settings (tab position) ----
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
    title: 'My day — RGK WorkTrack',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'panel-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  panel.setAlwaysOnTop(true, 'screen-saver');
  panel.loadURL(PANEL_URL);

  // Stay on the WorkTrack site; anything else opens in the normal browser.
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
    if (input.type === 'keyDown' && input.key === 'Escape') {
      e.preventDefault();
      hidePanel();
    }
  });
  // If the site isn't reachable, show a short message instead of a blank window.
  panel.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. a redirect)
    const html = `<body style="font:14px Segoe UI,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;color:#333;text-align:center;padding:24px;box-sizing:border-box">
      <p style="font-size:17px;font-weight:600;margin:0 0 6px">Can’t reach RGK WorkTrack</p>
      <p style="margin:0 0 16px;color:#777">${APP_URL.host} · ${String(desc).replace(/[<>&]/g, '')}</p>
      <p style="margin:0;color:#777">Check your internet connection. It will retry when you open My day again.</p></body>`;
    panel.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
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

function openLoginSetting() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('RGK WorkTrack — My day');
  const refresh = () => {
    const startsWithWindows = app.getLoginItemSettings(openLoginSetting()).openAtLogin;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open My day', click: showPanel },
        { label: 'Open RGK WorkTrack in browser', click: () => shell.openExternal(APP_URL.toString()) },
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
        { label: 'Reload', click: () => panel.loadURL(PANEL_URL) },
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
ipcMain.on('panel:count', (e, done, total) => {
  if (!from(e, panel) || !Number.isInteger(done) || !Number.isInteger(total)) return;
  tab.webContents.send('count', done, total);
  tray.setToolTip(total ? `My day: ${done} of ${total} done` : 'RGK WorkTrack — My day');
});

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
    buildTray();
    screen.on('display-metrics-changed', () => {
      placeTab();
      if (panel.isVisible()) panel.setBounds(panelBounds());
    });
  });
  // Keep running in the tray when windows close; let real quits (menu, Windows shutdown) through.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => (app.isQuitting = true));
}
