// Bundles the Cloud Functions (and the shared @rgk/core logic) into lib/ for deployment.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['firebase-admin', 'firebase-functions'],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'lib/index.js' });
await build({ ...common, entryPoints: ['src/seed-emulator.ts'], outfile: 'lib/seed-emulator.js' });
await build({ ...common, entryPoints: ['src/bootstrap-admin.ts'], outfile: 'lib/bootstrap-admin.js' });
await build({ ...common, entryPoints: ['src/seed-departments.ts'], outfile: 'lib/seed-departments.js' });
