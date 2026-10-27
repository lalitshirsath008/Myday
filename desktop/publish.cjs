// Runs after `npm run dist`: writes the website's download manifest (web/public/downloads/desktop.json)
// and copies the installer next to it for local use. The installer is too big for git (GitHub's
// 100 MB limit), so the live site links to `config.downloadUrl` (a public GitHub Release) instead.
// The site only shows the download when the manifest's appUrl is its own address.
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./package.json');
const config = require('./config.json');

const file = pkg.build.nsis.artifactName.replace('${ext}', 'exe');
const src = path.join(__dirname, 'dist', file);
const outDir = path.join(__dirname, '..', 'web', 'public', 'downloads');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, file));
const manifest = { version: pkg.version, appUrl: new URL(config.appUrl).origin, file, url: config.downloadUrl ?? null, size: fs.statSync(src).size };
fs.writeFileSync(path.join(outDir, 'desktop.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Installer: desktop/dist/${file} (for ${manifest.appUrl}). Upload it to: ${manifest.url ?? 'web/public/downloads'}`);
