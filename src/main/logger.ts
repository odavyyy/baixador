// In-memory ring buffer of technical logs, mirrored to a daily log file and to the UI (Diagnóstico).
import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry } from '../shared/types';
import { dataDir } from './store';

const MAX = 3000;
const entries: LogEntry[] = [];
let listener: ((e: LogEntry) => void) | null = null;
let stream: fs.WriteStream | null = null;

function fileStream() {
  if (stream) return stream;
  try {
    const dir = path.join(dataDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    stream = fs.createWriteStream(path.join(dir, `baixador-${day}.log`), { flags: 'a' });
  } catch {}
  return stream;
}

export function log(level: LogEntry['level'], scope: string, msg: string) {
  const e: LogEntry = { t: Date.now(), level, scope, msg: msg.length > 4000 ? msg.slice(0, 4000) + '…' : msg };
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  fileStream()?.write(`${new Date(e.t).toISOString()} [${level}] [${scope}] ${e.msg}\n`);
  listener?.(e);
}

export const logger = {
  info: (scope: string, msg: string) => log('info', scope, msg),
  warn: (scope: string, msg: string) => log('warn', scope, msg),
  error: (scope: string, msg: string) => log('error', scope, msg),
  all: () => entries.slice(),
  clear: () => { entries.length = 0; },
  onEntry: (cb: (e: LogEntry) => void) => { listener = cb; },
  dump: () => entries.map((e) => `${new Date(e.t).toISOString()} [${e.level}] [${e.scope}] ${e.msg}`).join('\n'),
};
