// Runs after `npm run dist`: copies the installer into the website (web/public/downloads) with a
// small manifest, so the My day drawer can offer it. The site only shows the download when the
// manifest's appUrl is its own address, so an installer built for another site is never offered.
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./package.json');
const config = require('./config.json');

const src = path.join(__dirname, 'dist', `RGK-WorkTrack-Setup-${pkg.version}.exe`);
const outDir = path.join(__dirname, '..', 'web', 'public', 'downloads');
const file = 'RGK-WorkTrack-Setup.exe';

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, file));
const manifest = { version: pkg.version, appUrl: new URL(config.appUrl).origin, file, size: fs.statSync(src).size };
fs.writeFileSync(path.join(outDir, 'desktop.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Installer copied to web/public/downloads/${file} (for ${manifest.appUrl})`);
