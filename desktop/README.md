# RGK WorkTrack desktop app

Puts the orange **My day** tab on the right edge of the Windows screen, above every app.
Clicking it slides out the same My day panel as the website. It loads `<appUrl>/widget/my-day`,
so the list, the sign-in and the security rules are the website's. The desktop app only adds the tab, the window and the tray menu.

- **Click** the tab to open. **Esc**, ✕, or clicking anywhere else closes it.
- **Drag** the tab up or down to move it. The position is remembered.
- **Tray icon** (near the clock): Open My day, open the website, show/hide the tab,
  move the tab back to the middle, Start with Windows, Reload, Quit.
- Employees and managers only. Super Admin sees a short notice.

## Which website it opens

`config.json` → `appUrl`. Default `http://localhost:5173` (the dev server).
After the live deployment, change it to `https://task-8861a.web.app` before building the installer.
For a one-off run you can also set the `RGK_APP_URL` environment variable.

In **demo mode**, the desktop app keeps its own demo data and signs out when it closes,
just like a separate browser. With live Firebase, everything is shared, and you stay signed in.

## Download from the website

`npm run dist` also copies the installer to `web/public/downloads/` with a small `desktop.json`
(version, size, and which site it connects to). The **My day** drawer then shows a
**Download for Windows** card with three install steps. It appears on Windows computers only, can be hidden with ✕,
and appears only when the installer was built for that same site. That way the live site never offers a `localhost` build.

## Run from source

```sh
npm install --prefix desktop   # once
npm run desktop                # from the repo root (the web dev server must be running)
```

## Build the Windows installer

```sh
npm run dist --prefix desktop
```

This creates `desktop/dist/RGK-WorkTrack-Setup-<version>.exe` and copies it into the website (see above). It is a per-user install, so no admin rights are needed.
It adds Start-menu and desktop shortcuts and turns on **Start with Windows** on first run (it can be switched off in the tray menu).

The installer is **not code-signed**. Windows SmartScreen will show “Windows protected your PC”
(More info → Run anyway). Sign it with the company's code-signing certificate before giving it to everyone
(set `CSC_LINK` / `CSC_KEY_PASSWORD`; electron-builder signs automatically).

## Security

- Context isolation and the sandbox are on, and Node integration is off. The page gets just two functions
  (`rgkWidget.hide`, `rgkWidget.setCount`).
- The panel stays on the `appUrl` site. Other links open in the normal browser.
- Electron fuses are set in the installer build: no run-as-Node, no `NODE_OPTIONS`, no inspector flags, and the app loads only from its checked asar.
