// In-app updater. Only talks to the official GitHub releases, only when the user asks, and never runs a file
// whose SHA-256 doesn't match the release's SHA256SUMS.txt.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assetName, compareVersions, hashFromSums, LATEST_API, LATEST_PAGE, readRelease, RELEASES_PAGE, REPO, tagFromLatestRedirect,
  type InstallKind, type ReleaseAsset, type UpdateInfo, type UpdateState,
} from '../shared/update';
import { logger } from './logger';

export interface UpdaterOptions {
  version: string;
  kind: InstallKind;
  /** folder that contains Baixador.exe */
  appDir: string;
  exeName: string;
  dataDir: string;
  tempRoot?: string;
  /** test-only feed; accepted only when it points at this computer */
  testFeed?: string;
  emit: (s: UpdateState) => void;
  /** returns a reason when the app is busy and must not be replaced now */
  busy: () => string | undefined;
  quit: () => void;
}

const GITHUB_HOSTS = (h: string) => h === 'api.github.com' || h === 'github.com' || h.endsWith('.githubusercontent.com');
const STALL_MS = 30_000;
/** ceiling for a download whose size the server didn't announce */
const MAX_UNKNOWN_SIZE = 600 * 1024 * 1024;
const LIMITED = 'O GitHub limitou as consultas por enquanto, e o caminho alternativo também não funcionou. Tente de novo mais tarde (pode levar até uma hora) ou use "Ver no GitHub".';

export function localTestFeed(raw?: string): URL | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? u : undefined;
  } catch {
    return undefined;
  }
}

class UserError extends Error {}

export class Updater {
  state: UpdateState;
  private abort: AbortController | null = null;
  private file?: string;
  private hash?: string;
  private feed?: URL;
  private root: string;
  private oneClick = false;
  private starting = false;

  constructor(private o: UpdaterOptions) {
    this.feed = localTestFeed(o.testFeed);
    this.root = path.join(o.tempRoot ?? os.tmpdir(), 'Baixador-update');
    this.state = { status: 'idle', current: o.version, kind: o.kind };
    if (this.feed) logger.warn('update', `Usando um servidor de TESTE local: ${this.feed.origin}`);
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.o.emit(this.state);
  }

  /** Removes leftovers of earlier downloads and reports how the last portable update ended. */
  cleanup() {
    try { fs.rmSync(this.root, { recursive: true, force: true }); } catch {}
    const result = path.join(this.o.dataDir, 'update-result.json');
    try {
      const r = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^\uFEFF/, ''));
      fs.rmSync(result, { force: true });
      this.state.lastResult = { ok: !!r.ok, message: String(r.message) };
      logger[r.ok ? 'info' : 'error']('update', `Última atualização: ${r.message}`);
    } catch {}
  }

  private allowed(url: URL): boolean {
    if (this.feed && url.origin === this.feed.origin) return true;
    return url.protocol === 'https:' && GITHUB_HOSTS(url.hostname);
  }

  /** fetch with manual redirects, so every hop is checked against the allow list. */
  private async get(url: string, signal: AbortSignal, accept: string, method = 'GET'): Promise<Response> {
    let current = new URL(url);
    for (let hop = 0; hop < 6; hop++) {
      if (!this.allowed(current)) throw new UserError('Endereço de atualização não permitido.');
      const res = await fetch(current, { method, redirect: 'manual', signal, headers: { Accept: accept, 'User-Agent': 'Baixador-updater' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current);
        continue;
      }
      return res;
    }
    throw new UserError('Redirecionamentos demais ao baixar a atualização.');
  }

  private describe(e: any): string {
    if (e instanceof UserError) return e.message;
    return 'Falha de conexão com o GitHub. Verifique sua internet e tente de novo.';
  }

  /**
   * Used when the API refuses because of its request limit. The public "latest" page redirects to the newest
   * stable release (never a draft or prerelease). There are no release notes or API digest this way; the
   * download is still refused unless it matches the release's SHA256SUMS.txt.
   */
  private async latestFromWebsite(): Promise<UpdateInfo> {
    const signal = AbortSignal.timeout(20_000);
    const latest = new URL(this.feed ? `${this.feed.origin}/releases/latest` : LATEST_PAGE);
    const releases = this.feed ? `${this.feed.origin}/releases` : RELEASES_PAGE;
    // only the address is read, so this one redirect is not followed
    const res = await fetch(latest, { method: 'HEAD', redirect: 'manual', signal, headers: { 'User-Agent': 'Baixador-updater' } });
    const location = res.headers.get('location');
    const tag = res.status >= 300 && res.status < 400 && location ? tagFromLatestRedirect(new URL(location, latest).href, releases) : undefined;
    if (!tag) throw new UserError(LIMITED);
    const version = tag.slice(1);
    const base = this.feed ? `${this.feed.origin}/download/` : `https://github.com/${REPO}/releases/download/`;
    const find = async (name: string): Promise<ReleaseAsset | undefined> => {
      const url = `${base}${tag}/${name}`;
      const head = await this.get(url, signal, 'application/octet-stream', 'HEAD');
      if (head.status === 404) return undefined;
      if (!head.ok) throw new UserError(LIMITED);
      return { name, url, size: Number(head.headers.get('content-length')) || 0 };
    };
    return {
      version, notes: '', page: `${RELEASES_PAGE}/tag/${tag}`,
      asset: await find(assetName(this.o.kind, version)),
      sums: await find('SHA256SUMS.txt'),
    };
  }

  /** One click: look for a new version, download it, verify it, install it and reopen the app. */
  async updateNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.oneClick || ['checking', 'downloading', 'verifying', 'installing'].includes(this.state.status)) return { ok: true };
    this.oneClick = true;
    try {
      if (this.state.status !== 'ready') {
        if (this.state.status !== 'available') await this.check();
        if (this.state.status !== 'available' || this.state.manualReason) return { ok: true };
        // refuse before spending the download, not only after it
        const reason = this.o.busy();
        if (reason) return { ok: false, error: reason };
        await this.download();
      }
      // cancelled or failed: the state already says so. If a task started meanwhile, install() refuses and
      // the verified download stays ready.
      return (this.state.status as UpdateState['status']) === 'ready' ? await this.install() : { ok: true };
    } finally {
      this.oneClick = false;
    }
  }

  async check(): Promise<UpdateState> {
    if (['checking', 'downloading', 'verifying', 'installing'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', error: undefined, info: undefined, manualReason: undefined, lastResult: undefined });
    try {
      const url = this.feed ? this.feed.href : LATEST_API;
      const res = await this.get(url, AbortSignal.timeout(20_000), 'application/vnd.github+json');
      let info: UpdateInfo | { ignored: string };
      if (res.status === 403 || res.status === 429) {
        logger.warn('update', `A API do GitHub recusou a consulta (${res.status}). Usando a página pública de releases.`);
        info = await this.latestFromWebsite();
      } else {
        if (res.status === 404) throw new UserError('Nenhuma versão estável publicada foi encontrada.');
        if (!res.ok) throw new UserError(`O GitHub respondeu com erro (${res.status}).`);
        const base = this.feed ? `${this.feed.origin}/download/` : `https://github.com/${REPO}/releases/download/`;
        info = readRelease(await res.json(), this.o.kind, base);
      }
      if ('ignored' in info) {
        logger.warn('update', `Release ignorada: ${info.ignored}`);
        this.set({ status: 'uptodate', checkedAt: Date.now() });
        return this.state;
      }
      // never offer the same or an older version (no downgrades)
      if (compareVersions(info.version, this.o.version) <= 0) {
        this.set({ status: 'uptodate', checkedAt: Date.now(), info: undefined });
        return this.state;
      }
      const manualReason = this.o.kind === 'dev' ? 'Em modo de desenvolvimento o app não instala atualizações.'
        : !info.asset ? 'Esta versão não tem o arquivo correspondente à sua instalação.'
          : !info.sums ? 'Esta versão não tem o arquivo SHA256SUMS.txt, necessário para conferir o download.'
            : undefined;
      logger.info('update', `Nova versão disponível: ${info.version} (instalada: ${this.o.version}, formato: ${this.o.kind})`);
      this.set({ status: 'available', info, manualReason, checkedAt: Date.now(), total: info.asset?.size || undefined });
    } catch (e: any) {
      logger.error('update', `Verificação falhou: ${e.message}${e.cause ? ' · ' + e.cause.message : ''}`);
      this.set({ status: 'error', error: this.describe(e) });
    }
    return this.state;
  }

  async download(): Promise<UpdateState> {
    const info = this.state.info;
    if (!info?.asset || !info.sums || this.state.manualReason || !['available', 'error'].includes(this.state.status)) return this.state;
    const asset: ReleaseAsset = info.asset;
    const dir = path.join(this.root, info.version);
    const part = path.join(dir, asset.name + '.part');
    const final = path.join(dir, asset.name);
    this.abort = new AbortController();
    const { signal } = this.abort;
    let stall: NodeJS.Timeout | undefined;
    let stalled = false;
    const kick = () => { clearTimeout(stall); stall = setTimeout(() => { stalled = true; this.abort?.abort(); }, STALL_MS); };
    this.file = undefined;
    this.set({ status: 'downloading', error: undefined, received: 0, total: asset.size || undefined, speed: 0 });
    let fd: number | undefined;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      kick();
      const sumsRes = await this.get(info.sums.url, signal, 'application/octet-stream');
      if (!sumsRes.ok) throw new UserError('Não foi possível baixar o arquivo de verificação (SHA256SUMS.txt).');
      const expected = hashFromSums((await sumsRes.text()).slice(0, 100_000), asset.name);
      if (!expected) throw new UserError('O SHA256SUMS.txt não contém o arquivo desta atualização. Nada foi instalado.');
      const apiHash = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : undefined;
      if (apiHash && apiHash !== expected) throw new UserError('Os dois códigos de verificação publicados não conferem. Nada foi instalado.');

      const res = await this.get(asset.url, signal, 'application/octet-stream');
      if (!res.ok || !res.body) throw new UserError(`Não foi possível baixar a atualização (${res.status}).`);
      const declared = Number(res.headers.get('content-length'));
      if (declared && asset.size && declared !== asset.size) throw new UserError('O tamanho do arquivo não confere com o publicado.');
      const sha = createHash('sha256');
      fd = fs.openSync(part, 'w');
      let received = 0, mark = Date.now(), markBytes = 0, speed = 0;
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        kick();
        received += chunk.length;
        if (received > (asset.size || declared || MAX_UNKNOWN_SIZE)) throw new UserError('O arquivo recebido é maior que o publicado.');
        sha.update(chunk);
        fs.writeSync(fd, chunk);
        const now = Date.now();
        if (now - mark >= 400) {
          speed = ((received - markBytes) * 1000) / (now - mark);
          mark = now; markBytes = received;
          this.set({ received, speed });
        }
      }
      fs.closeSync(fd);
      fd = undefined;
      clearTimeout(stall);
      const size = asset.size || declared;
      if (size && received !== size) throw new UserError('O download veio incompleto. Tente novamente.');
      this.set({ status: 'verifying', received, speed: undefined });
      if (sha.digest('hex') !== expected) throw new UserError('A verificação SHA-256 falhou: o arquivo não é o publicado. Ele foi apagado.');
      const head = Buffer.alloc(2);
      const check = fs.openSync(part, 'r');
      fs.readSync(check, head, 0, 2, 0);
      fs.closeSync(check);
      if (head.toString('latin1') !== (asset.name.endsWith('.exe') ? 'MZ' : 'PK')) throw new UserError('O arquivo baixado não é um instalador ou pacote válido.');
      fs.renameSync(part, final);
      this.file = final;
      this.hash = expected;
      logger.info('update', `Download verificado: ${asset.name} (${received} bytes, SHA-256 confere)`);
      this.set({ status: 'ready' });
    } catch (e: any) {
      clearTimeout(stall);
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      if (signal.aborted && !stalled) {
        logger.info('update', 'Download cancelado pelo usuário; arquivos temporários removidos.');
        this.set({ status: 'available', received: undefined, speed: undefined });
      } else {
        logger.error('update', `Download falhou: ${stalled ? 'sem dados por 30 s' : e.message}${e.cause ? ' · ' + e.cause.message : ''}`);
        this.set({ status: 'error', error: stalled ? 'O download parou de responder. Tente novamente.' : e instanceof UserError ? e.message : 'A conexão caiu durante o download. Nada foi instalado.', received: undefined, speed: undefined });
      }
    } finally {
      this.abort = null;
    }
    return this.state;
  }

  cancel() {
    this.abort?.abort();
  }

  /** Called only after the user asks for it in the UI. */
  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.starting) return { ok: true };
    this.starting = true;
    try {
      return await this.startInstall();
    } finally {
      this.starting = false;
    }
  }

  private async startInstall(): Promise<{ ok: boolean; error?: string }> {
    if (this.state.status !== 'ready' || !this.file || !this.hash || !this.state.info) return { ok: false, error: 'Baixe a atualização primeiro.' };
    const reason = this.o.busy();
    if (reason) return { ok: false, error: reason };
    const file = this.file;
    try {
      // re-check right before running it: the file sat in %TEMP% in the meantime
      const now = await new Promise<string>((resolve, reject) => {
        const h = createHash('sha256');
        fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
      });
      if (now !== this.hash) {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
        this.set({ status: 'error', error: 'O arquivo baixado mudou depois da verificação. Nada foi instalado.' });
        return { ok: false, error: this.state.error };
      }
      if (this.o.kind === 'installed') this.runInstaller(file);
      else await this.swapPortable(file, this.state.info.version);
    } catch (e: any) {
      logger.error('update', `Instalação não iniciada: ${e.message}`);
      return { ok: false, error: e instanceof UserError ? e.message : 'Não foi possível iniciar a instalação. Seu aplicativo continua como estava.' };
    }
    this.set({ status: 'installing' });
    setTimeout(() => this.o.quit(), 600);
    return { ok: true };
  }

  private runInstaller(file: string) {
    // flags understood by electron-builder's NSIS template: silent, this is an update, start the app afterwards.
    // If the folder needs administrator rights, the normal installer window is shown instead.
    const args = canWrite(this.o.appDir) ? ['/S', '--updated', '--force-run'] : ['--updated', '--force-run'];
    logger.info('update', `Executando o instalador verificado: ${file} ${args.join(' ')}`);
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => logger.error('update', `O instalador não abriu: ${e.message}`));
    child.unref();
  }

  /**
   * The portable folder is replaced as a whole: extract next to it, validate, then a helper script swaps the
   * folders after the app exits. The old folder is kept, and restored if anything fails.
   */
  private async swapPortable(zip: string, version: string) {
    const dir = path.resolve(this.o.appDir);
    const parent = path.dirname(dir);
    if (parent === dir) throw new UserError('O app está na raiz de um disco. Mova-o para uma pasta própria para atualizar automaticamente.');
    if (!canWrite(dir) || !canWrite(parent)) throw new UserError('Sem permissão de escrita na pasta do aplicativo. Baixe a nova versão pela página de releases.');
    const staging = `${dir}.nova-${version}`;
    const backup = `${dir}.anterior-${this.o.version}`;
    if (fs.existsSync(backup)) throw new UserError(`Já existe a pasta "${path.basename(backup)}" de uma atualização anterior. Confira o conteúdo e apague-a antes de atualizar.`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging);
    try {
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      await new Promise<void>((resolve, reject) => execFile(tar, ['-xf', zip, '-C', staging], { windowsHide: true, timeout: 300_000 }, (err) => (err ? reject(new UserError('Não foi possível extrair o pacote da atualização.')) : resolve())));
      for (const needed of [this.o.exeName, path.join('resources', 'app.asar')]) {
        if (!fs.existsSync(path.join(staging, needed))) throw new UserError('O pacote baixado não contém o aplicativo esperado.');
      }
      // If the folder holds anything that isn't part of the app (the zip may have been extracted into
      // Downloads or the Desktop), moving it would move the user's files. Refuse instead.
      const known = new Set(fs.readdirSync(staging).map((n) => n.toLowerCase()));
      const foreign = fs.readdirSync(dir).filter((n) => !known.has(n.toLowerCase()));
      if (foreign.length) {
        throw new UserError(`A pasta do aplicativo tem arquivos que não são do Baixador (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? '…' : ''}). Para não mexer neles, a atualização automática foi interrompida. Mova o Baixador para uma pasta só dele ou extraia a nova versão manualmente.`);
      }
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    logger.info('update', `Troca de pastas agendada: ${staging} -> ${dir} (cópia anterior em ${backup})`);
    try {
      await startHelper(this.root, {
        AppPid: process.pid, AppDir: dir, NewDir: staging, Backup: backup, Exe: this.o.exeName,
        Result: path.join(this.o.dataDir, 'update-result.json'), Version: version,
      });
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
  }
}

/**
 * Starts the swap script so that it survives the app closing, and waits until it says it is running; the app
 * only quits after that. A directly detached powershell.exe has no console and exits without running
 * anything, so "cmd /c start" gives it one. Paths travel in a JSON file, never on the command line.
 */
export async function startHelper(root: string, params: Record<string, string | number>, waitMs = 20_000): Promise<void> {
  fs.mkdirSync(root, { recursive: true });
  const ready = path.join(root, 'trocar-versao.pronto');
  fs.rmSync(ready, { force: true });
  fs.writeFileSync(path.join(root, 'trocar-versao.ps1'), '\uFEFF' + SWAP_SCRIPT, 'utf8');
  fs.writeFileSync(path.join(root, 'trocar-versao.json'), JSON.stringify(params), 'utf8');
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const ps = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(path.join(system, 'cmd.exe'), ['/d', '/c', 'start', '""', '/min', ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', 'trocar-versao.ps1'],
    { detached: true, stdio: 'ignore', cwd: root, windowsVerbatimArguments: true });
  child.on('error', (e) => logger.error('update', `Não foi possível abrir o auxiliar: ${e.message}`));
  child.unref();
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    if (fs.existsSync(ready)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new UserError('O assistente de atualização não iniciou (o PowerShell pode estar bloqueado neste computador). Nada foi alterado.');
}

export function canWrite(dir: string): boolean {
  const probe = path.join(dir, `.baixador-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Waits for the app to exit, swaps the folders and starts the new version; on failure restores the old one. */
export const SWAP_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$p = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'trocar-versao.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$AppPid = [int]$p.AppPid; $AppDir = $p.AppDir; $NewDir = $p.NewDir; $Backup = $p.Backup; $Exe = $p.Exe; $Result = $p.Result; $Version = $p.Version
'ok' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'trocar-versao.pronto')
# not Start-Process: it reads [ ] in a path as a wildcard
function Open-App {
  $si = New-Object System.Diagnostics.ProcessStartInfo
  $si.FileName = Join-Path $AppDir $Exe
  $si.WorkingDirectory = $AppDir
  $si.UseShellExecute = $false
  [void][System.Diagnostics.Process]::Start($si)
}
function Save($ok, $message) {
  try { @{ ok = $ok; message = $message } | ConvertTo-Json | Set-Content -LiteralPath $Result -Encoding UTF8 } catch {}
}
try { Wait-Process -Id $AppPid -Timeout 90 -ErrorAction SilentlyContinue } catch {}
if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) { Save $false 'O aplicativo não fechou a tempo. Nada foi alterado.'; Remove-Item -LiteralPath $NewDir -Recurse -Force; exit 1 }
$moved = $false
for ($i = 0; $i -lt 40 -and -not $moved; $i++) {
  try { Rename-Item -LiteralPath $AppDir -NewName (Split-Path -Leaf $Backup); $moved = $true } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $moved) {
  Save $false 'A pasta do aplicativo está em uso (outra janela ou programa aberto nela). Nada foi alterado.'
  Remove-Item -LiteralPath $NewDir -Recurse -Force -ErrorAction SilentlyContinue
  Open-App
  exit 1
}
try {
  Rename-Item -LiteralPath $NewDir -NewName (Split-Path -Leaf $AppDir)
  Save $true ("Atualizado para a versão " + $Version + ". A versão anterior foi guardada em: " + $Backup)
  Open-App
} catch {
  if (Test-Path -LiteralPath $AppDir) { Rename-Item -LiteralPath $AppDir -NewName (Split-Path -Leaf $NewDir) -ErrorAction SilentlyContinue }
  Rename-Item -LiteralPath $Backup -NewName (Split-Path -Leaf $AppDir)
  Save $false ('A atualização falhou e a versão anterior foi restaurada. ' + $_.Exception.Message)
  Open-App
  exit 1
}
`;
