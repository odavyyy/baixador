// Bundles a test file (Electron stubbed out) and runs it with Node.
// Usage: node scripts/run-test.mjs tests/<file>.ts [args…]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const [entry, ...args] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baixador-test-'));
const outfile = path.join(dir, 'test.cjs');
const stub = {
  name: 'electron-stub',
  setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `module.exports = { app: { getPath: () => ${JSON.stringify(dir)} } };` }));
  },
};
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, plugins: [stub], logLevel: 'warning' });
const r = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
