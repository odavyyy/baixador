import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, Notification, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HistoryItem, Settings } from '../shared/types';
import { dataDir, defaultDownloadDir, defaultSettings, JsonFile } from './store';
import { logger } from './logger';
import { analyze, analyzeBatch, autoDetect, cancelAnalyze, cancelBatch, checkTools, updateYtdlp } from './ytdlp';
import { DownloadManager } from './downloads';
import { Converter, detectHardware, probeFile } from './convert';
import { Updater } from './updater';
import { RELEASES_PAGE, REPO, type InstallKind } from '../shared/update';

app.setAppUserModelId('local.baixador.app');
// Optional separate data folder (used for automated tests).
if (process.env.BAIXADOR_DATA_DIR) app.setPath('userData', process.env.BAIXADOR_DATA_DIR);
protocol.registerSchemesAsPrivileged([{ scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let settings: JsonFile<Settings>;
let history: JsonFile<HistoryItem[]>;
let manager: DownloadManager;
let converter: Converter;
let updater: Updater;

/** The same files make both distributions; only the installer leaves an uninstaller next to the exe. */
function installKind(): InstallKind {
  if (!app.isPackaged) return 'dev';
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${path.basename(process.execPath)}`)) ? 'installed' : 'portable';
}

const DOCS: Record<string, string> = {
  privacy: 'PRIVACY.md',
  terms: 'TERMS.md',
  notices: 'CONTENT_NOTICE.md',
  license: 'LICENSE',
  thirdParty: 'THIRD_PARTY_NOTICES.md',
  signing: 'CODE_SIGNING_POLICY.md',
};

const thumbsDir = () => path.join(dataDir(), 'thumbs');
const send = (ch: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

async function cacheThumb(id: string, url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await net.fetch(url);
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(thumbsDir(), { recursive: true });
    const ext = /webp/.test(res.headers.get('content-type') || '') ? 'webp' : /png/.test(res.headers.get('content-type') || '') ? 'png' : 'jpg';
    fs.writeFileSync(path.join(thumbsDir(), `${id}.${ext}`), buf);
    return `thumb://local/${id}.${ext}`;
  } catch (e: any) {
    logger.warn('thumb', `Capa não salva: ${e.message}`);
    return undefined;
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
    // spellcheck off: Chromium would otherwise download dictionaries on its own
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // the window must never navigate away (e.g. a file dropped outside the converter)
  win.webContents.on('will-navigate', (e) => e.preventDefault());
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

  h('analyze', async (_e, url: string) => { await cancelBatch(); return analyze(settings.value, url.trim()); });
  h('analyze:cancel', async () => { await Promise.all([cancelAnalyze(), cancelBatch()]); });
  h('analyze:batch', (_e, urls: string[]) => analyzeBatch(settings.value, urls, (done, total) => send('batch:progress', { done, total })));

  h('jobs:enqueue', (_e, req) => manager.enqueue(req));
  h('jobs:enqueueMany', (_e, reqs) => manager.enqueueMany(reqs));
  h('jobs:list', () => manager.list());
  h('jobs:pause', (_e, id: string) => manager.pause(id));
  h('jobs:resume', (_e, id: string) => manager.resume(id));
  h('jobs:cancel', (_e, id: string) => manager.cancel(id));
  h('jobs:retry', (_e, id: string) => manager.retry(id));
  h('jobs:remove', (_e, id: string) => manager.remove(id));
  h('jobs:clear', () => manager.clearFinished());

  h('convert:pick', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Escolher vídeo', properties: ['openFile'], filters: [{ name: 'Vídeos e áudios', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'ts', 'mts', '3gp', 'gif', 'mp3', 'm4a', 'wav', 'opus', 'ogg', 'flac'] }, { name: 'Todos os arquivos', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('convert:probe', (_e, p: string) => probeFile(settings.value, p).then((probe) => ({ ok: true, probe }), (e) => ({ ok: false, error: e.message })));
  h('convert:hardware', (_e, force: boolean) => detectHardware(settings.value, force).then((hardware) => ({ ok: true, hardware }), (e) => ({ ok: false, error: e.message })));
  h('convert:start', (_e, req) => converter.start(req));
  h('convert:cancel', () => converter.cancel());
  h('convert:estimate', (_e, input, s, pref, gpu) => converter.estimate(input, s, pref, gpu));
  h('convert:state', () => converter.state);

  h('update:state', () => updater.state);
  h('update:check', () => updater.check());
  h('update:download', () => updater.download());
  h('update:cancel', () => updater.cancel());
  h('update:install', () => updater.install());
  h('update:page', () => shell.openExternal(RELEASES_PAGE));
  h('docs:read', (_e, doc: string) => {
    const name = DOCS[doc];
    if (!name) return '';
    // LICENSE and the notices are shipped next to the exe (electron-builder keeps them out of app.asar)
    const beside = path.join(path.dirname(process.execPath), name === 'LICENSE' ? 'LICENSE.txt' : name);
    for (const file of [path.join(app.getAppPath(), name), beside]) {
      try { return fs.readFileSync(file, 'utf8'); } catch {}
    }
    return 'Documento não encontrado nesta instalação.';
  });
  h('project:link', (_e, link: string) => shell.openExternal(link === 'issues' ? `https://github.com/${REPO}/issues` : `https://github.com/${REPO}`));

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

  // "open" runs whatever Windows associates with the file, so only files this app produced are accepted
  h('shell:openFile', (_e, p: string) => {
    const known = [...history.value.map((i) => i.filePath), ...manager.list().map((j) => j.filePath), converter.state.output];
    if (!known.includes(p)) return 'Arquivo desconhecido.';
    return shell.openPath(p);
  });
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
      if (job.batchId) {
        // One notification (and one folder window) for the whole playlist.
        const batch = manager.list().filter((j) => j.batchId === job.batchId);
        if (batch.some((j) => ['queued', 'downloading', 'processing', 'paused'].includes(j.status))) return;
        const done = batch.filter((j) => j.status === 'completed');
        notify(job.batchKind === 'list' ? 'Lote finalizado' : 'Playlist finalizada', `${job.batchTitle}\n${done.length} de ${batch.length} concluídos`, () => send('navigate', 'downloads'));
        const file = done[0]?.filePath;
        if (settings.value.openFolderAfter && file) shell.showItemInFolder(file);
        return;
      }
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

  converter = new Converter(
    () => settings.value,
    (state) => send('convert:update', state),
    (state) => {
      if (state.status === 'done') notify('Conversão concluída', path.basename(state.output!), () => shell.showItemInFolder(state.output!));
      else if (state.status === 'error') notify('A conversão falhou', state.error ?? '', () => send('navigate', 'converter'));
    },
  );

  updater = new Updater({
    version: app.getVersion(),
    kind: installKind(),
    appDir: path.dirname(process.execPath),
    exeName: path.basename(process.execPath),
    dataDir: dataDir(),
    testFeed: process.env.BAIXADOR_UPDATE_FEED,
    emit: (state) => send('update:update', state),
    busy: () => (manager.activeCount() ? 'Há downloads em andamento. Aguarde ou pause antes de atualizar.' : converter.running ? 'Há uma conversão em andamento. Aguarde ou cancele antes de atualizar.' : undefined),
    quit: () => app.quit(),
  });
  updater.cleanup();

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
  try { await converter?.cancel(); await manager?.shutdown(); settings?.saveNow(); history?.saveNow(); } finally { app.quit(); }
});
app.on('window-all-closed', () => app.quit());
