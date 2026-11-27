import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, Notification, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HistoryItem, Settings } from '../shared/types';
import { dataDir, defaultDownloadDir, defaultSettings, JsonFile } from './store';
import { logger } from './logger';
import { analyze, autoDetect, cancelAnalyze, checkTools, updateYtdlp } from './ytdlp';
import { DownloadManager } from './downloads';

app.setAppUserModelId('local.baixador.app');
// Optional separate data folder (used for automated tests).
if (process.env.BAIXADOR_DATA_DIR) app.setPath('userData', process.env.BAIXADOR_DATA_DIR);
protocol.registerSchemesAsPrivileged([{ scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let settings: JsonFile<Settings>;
let history: JsonFile<HistoryItem[]>;
let manager: DownloadManager;

const thumbsDir = () => path.join(dataDir(), 'thumbs');
const send = (ch: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

async function cacheThumb(id: string, url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await net.fetch(url);
    if (!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(thumbsDir(), { recursive: true });
    const ext = /webp/.test(res.headers.get('content-type') || '') ? 'webp' : /png/.test(res.headers.get('content-type') || '') ? 'png' : 'jpg';
    fs.writeFileSync(path.join(thumbsDir(), `${id}.${ext}`), buf);
    return `thumb://local/${id}.${ext}`;
  } catch (e: any) {
    logger.warn('thumb', `Capa não salva: ${e.message}`);
    return url;
  }
}

function notify(title: string, body: string, onClick?: () => void) {
  if (!settings.value.notifications || !Notification.isSupported()) return;
  if (win?.isFocused()) return; // the in-app toast is enough
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { win?.show(); win?.focus(); onClick?.(); });
  n.show();
}

function createWindow() {
  const dark = settings.value.theme === 'dark' || (settings.value.theme === 'system' && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: dark ? '#0c0d10' : '#f5f6f8',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#c9ccd3' : '#3a3d45', height: 40 },
    icon: path.join(__dirname, '../renderer/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const devUrl = process.env.VITE_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// ---------------------------------------------------------------- clipboard watcher
let lastClip = '';
async function readClip(): Promise<string> {
  return String((await clipboard.readText()) ?? '').trim();
}
async function watchClipboard() {
  lastClip = await readClip();
  setInterval(async () => {
    if (!settings.value.clipboardWatch) return;
    const t = await readClip();
    if (t === lastClip) return;
    lastClip = t;
    if (/^https?:\/\/\S+$/i.test(t) && t.length < 2000) send('clipboard:url', t);
  }, 1000);
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  const h = ipcMain.handle.bind(ipcMain);

  h('settings:get', () => settings.value);
  h('settings:set', (_e, patch: Partial<Settings>) => {
    settings.set({ ...settings.value, ...patch });
    if (patch.maxConcurrent) manager.schedule();
    return settings.value;
  });
  h('dialog:folder', async (_e, current?: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Escolher pasta', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('dialog:file', async (_e, current?: string) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Escolher executável', defaultPath: current, properties: ['openFile'], filters: [{ name: 'Executável', extensions: ['exe'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('tools:check', () => checkTools(settings.value));
  h('tools:detect', () => {
    const patch = autoDetect(settings.value, true);
    if (Object.keys(patch).length) settings.set({ ...settings.value, ...patch });
    return settings.value;
  });
  h('tools:update', () => updateYtdlp(settings.value));

  h('analyze', (_e, url: string) => analyze(settings.value, url.trim()));
  h('analyze:cancel', () => cancelAnalyze());

  h('jobs:enqueue', (_e, req) => manager.enqueue(req));
  h('jobs:list', () => manager.list());
  h('jobs:pause', (_e, id: string) => manager.pause(id));
  h('jobs:resume', (_e, id: string) => manager.resume(id));
  h('jobs:cancel', (_e, id: string) => manager.cancel(id));
  h('jobs:retry', (_e, id: string) => manager.retry(id));
  h('jobs:remove', (_e, id: string) => manager.remove(id));
  h('jobs:clear', () => manager.clearFinished());

  h('history:list', () => history.value);
  h('history:remove', async (_e, id: string, deleteFile: boolean) => {
    const item = history.value.find((i) => i.id === id);
    if (!item) return { ok: true };
    if (deleteFile && fs.existsSync(item.filePath)) {
      try {
        await shell.trashItem(item.filePath); // goes to the Recycle Bin, never a hard delete
        logger.info('history', `Arquivo enviado para a Lixeira: ${item.filePath}`);
      } catch (e: any) {
        logger.error('history', `Falha ao enviar para a Lixeira: ${e.message}`);
        return { ok: false, error: 'Não foi possível mover o arquivo para a Lixeira.' };
      }
    }
    history.set(history.value.filter((i) => i.id !== id));
    if (item.thumbnail?.startsWith('thumb://')) {
      try { fs.rmSync(path.join(thumbsDir(), item.thumbnail.split('/').pop()!), { force: true }); } catch {}
    }
    send('history:update', history.value);
    return { ok: true };
  });
  h('history:clear', () => {
    history.set([]);
    try { fs.rmSync(thumbsDir(), { recursive: true, force: true }); } catch {}
    send('history:update', history.value);
  });

  h('shell:openFile', (_e, p: string) => shell.openPath(p));
  h('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p));
  h('shell:openFolder', (_e, p: string) => { fs.mkdirSync(p, { recursive: true }); return shell.openPath(p); });
  h('fs:exists', (_e, p: string) => fs.existsSync(p));

  h('logs:get', () => logger.all());
  h('logs:clear', () => logger.clear());
  h('logs:export', async () => {
    const r = await dialog.showSaveDialog(win!, { title: 'Exportar logs', defaultPath: `baixador-logs-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Texto', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, logger.dump(), 'utf8');
    return r.filePath;
  });

  h('clipboard:read', () => readClip());
  ipcMain.on('titlebar:theme', (_e, dark: boolean) => {
    try { win?.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#c9ccd3' : '#3a3d45', height: 40 }); } catch {}
    win?.setBackgroundColor(dark ? '#0c0d10' : '#f5f6f8');
  });
}

// ---------------------------------------------------------------- boot
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  settings = new JsonFile<Settings>('settings.json', defaultSettings);
  history = new JsonFile<HistoryItem[]>('history.json', []);
  if (!settings.existed) settings.set({ ...settings.value, downloadDir: defaultDownloadDir() });
  const found = autoDetect(settings.value);
  if (Object.keys(found).length) settings.set({ ...settings.value, ...found });
  try { fs.mkdirSync(settings.value.downloadDir, { recursive: true }); } catch {}

  protocol.handle('thumb', (req) => {
    const name = path.basename(decodeURIComponent(new URL(req.url).pathname));
    return net.fetch(pathToFileURL(path.join(thumbsDir(), name)).toString());
  });

  logger.onEntry((e) => send('log:entry', e));
  logger.info('app', `Baixador ${app.getVersion()} iniciado · dados em ${dataDir()}`);

  manager = new DownloadManager({
    settings: () => settings.value,
    onChange: (jobs) => send('jobs:update', jobs),
    onFinished: (job) => {
      if (job.status === 'completed') {
        notify('Download concluído', job.title, () => job.filePath && shell.showItemInFolder(job.filePath));
        if (settings.value.openFolderAfter && job.filePath) shell.showItemInFolder(job.filePath);
      } else if (job.status === 'error') {
        notify('Falha no download', `${job.title}\n${job.error ?? ''}`, () => send('navigate', 'downloads'));
      }
    },
    addHistory: async (item, thumbUrl) => {
      item.thumbnail = await cacheThumb(item.id, thumbUrl);
      history.set([item, ...history.value.filter((i) => i.id !== item.id)]);
      send('history:update', history.value);
    },
  });

  registerIpc();
  createWindow();
  void watchClipboard();
  void checkTools(settings.value);
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  try { await manager?.shutdown(); settings?.saveNow(); history?.saveNow(); } finally { app.quit(); }
});
app.on('window-all-closed', () => app.quit());
