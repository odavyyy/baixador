// Bundles tests/convert-engine.ts (Electron stubbed out) and runs it with Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baixador-test-'));
const outfile = path.join(dir, 'convert-engine.cjs');
const stub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `module.exports = { app: { getPath: () => ${JSON.stringify(dir)} } };` }));
  },
};
await build({ entryPoints: ['tests/convert-engine.ts'], bundle: true, platform: 'node', format: 'cjs', outfile, plugins: [stub], logLevel: 'warning' });
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
