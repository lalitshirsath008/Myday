// Starts the desktop app from source. Clears ELECTRON_RUN_AS_NODE, which some editors set and which would
// make Electron run as plain Node.
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.RGK_APP_URL ??= 'https://rgk-myday.vercel.app';
spawn(electron, [__dirname, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: false }).on('exit', (code) => process.exit(code ?? 0));
