// Dev mode: Vite dev server (hot reload for the UI) + Electron pointed at it.
// Extra arguments are passed to Electron, e.g. `npm run dev -- --remote-debugging-port=9333`.
// Changes in src/main need a restart of this command.
import { createServer } from 'vite';
import { spawn, execSync } from 'node:child_process';
import electronPath from 'electron';

execSync('node scripts/build-main.mjs', { stdio: 'inherit' });
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
child.on('close', () => { server.close(); process.exit(0); });
