// Updater tests.
//   SIMULATED: a fake release server on 127.0.0.1 produces the failure cases on demand.
//   REAL (with --real): the same code against the public GitHub releases of this repository.
// Usage: npm run test:updater [-- --real]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Updater, localTestFeed, startHelper } from '../src/main/updater';
import { compareVersions, hashFromSums, parseVersion, readRelease, type InstallKind, type UpdateState } from '../src/shared/update';

const results: { name: string; ok: boolean; kind: 'SIMULADO' | 'REAL'; info: string }[] = [];
let mode: 'SIMULADO' | 'REAL' = 'SIMULADO';
const record = (name: string, ok: boolean, info = '') => { results.push({ name, ok, kind: mode, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${name}${info ? '  ' + info : ''}`); };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'baixador-updater-test-'));

// ---------------------------------------------------------------- fake release server
const payload = Buffer.concat([Buffer.from('MZ'), randomBytes(3 * 1024 * 1024)]);
interface Scenario {
  tag?: string; draft?: boolean; prerelease?: boolean; sums?: string | null; digest?: string; body?: Buffer;
  download?: 'ok' | 'slow' | 'cut' | 'short' | 'redirect-evil' | '500'; assetUrl?: string; api?: number; garbage?: boolean;
}
let scenario: Scenario = {};
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const tag = scenario.tag ?? 'v2.0.0';
  const version = tag.replace(/^v/, '');
  const name = `Baixador-Setup-${version}.exe`;
  const body = scenario.body ?? payload;
  if (req.url === '/latest') {
    if (scenario.api) return void res.writeHead(scenario.api).end();
    if (scenario.garbage) return void res.writeHead(200).end('<html>');
    const assets: any[] = [{ name, size: body.length, state: 'uploaded', digest: scenario.digest, browser_download_url: scenario.assetUrl ?? `${base}/download/${tag}/${name}` }];
    if (scenario.sums !== null) assets.push({ name: 'SHA256SUMS.txt', size: 100, browser_download_url: `${base}/download/${tag}/SHA256SUMS.txt` });
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tag_name: tag, draft: scenario.draft ?? false, prerelease: scenario.prerelease ?? false, body: 'Notas de teste', assets }));
  }
  if (req.url?.endsWith('/SHA256SUMS.txt')) return void res.writeHead(200).end(scenario.sums ?? `${sha(body)}  ${name}\n`);
  if (req.url?.endsWith(name)) {
    const d = scenario.download ?? 'ok';
    if (d === '500') return void res.writeHead(500).end();
    if (d === 'redirect-evil') return void res.writeHead(302, { location: 'https://example.com/evil.exe' }).end();
    if (d === 'short') { res.writeHead(200); return void res.end(body.subarray(0, body.length / 2)); }
    res.writeHead(200, { 'content-length': body.length });
    if (d === 'cut') { res.write(body.subarray(0, body.length / 3)); return void setTimeout(() => res.destroy(), 200); }
    if (d === 'slow') {
      let off = 0;
      const t = setInterval(() => { res.write(body.subarray(off, off + 64 * 1024)); off += 64 * 1024; if (off >= body.length) { clearInterval(t); res.end(); } }, 100);
      return void res.on('close', () => clearInterval(t));
    }
    return void res.end(body);
  }
  res.writeHead(404).end();
});

function make(o: { version?: string; kind?: InstallKind; feed?: string | null; busy?: () => string | undefined; onState?: (s: UpdateState, u: Updater) => void } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(sandbox, 'tmp-'));
  const states: UpdateState[] = [];
  let quit = false;
  const u: Updater = new Updater({
    version: o.version ?? '1.2.0', kind: o.kind ?? 'installed', appDir: sandbox, exeName: 'Baixador.exe', dataDir: sandbox, tempRoot,
    testFeed: o.feed === null ? undefined : o.feed ?? `http://127.0.0.1:${(server.address() as any).port}/latest`,
    emit: (s) => { states.push({ ...s }); o.onState?.(s, u); }, busy: o.busy ?? (() => undefined), quit: () => { quit = true; },
  });
  const files = () => { const root = path.join(tempRoot, 'Baixador-update'); return fs.existsSync(root) ? (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(root, f)).isFile()) : []; };
  return { u, states, files, tempRoot, quit: () => quit };
}

async function failing(name: string, sc: Scenario, expect: RegExp) {
  scenario = sc;
  const t = make();
  await t.u.check();
  if (t.u.state.status === 'available') await t.u.download();
  const ok = t.u.state.status === 'error' && expect.test(t.u.state.error ?? '') && t.files().length === 0;
  record(name, ok, `${t.u.state.status}: ${t.u.state.error ?? ''}${t.files().length ? ' · SOBRARAM ' + t.files() : ''}`);
}

/** Runs the real swap script on throwaway folders. A folder is "in use" when a process has it as its working directory. */
async function swapCase(name: string, locked: boolean) {
  const base = fs.mkdtempSync(path.join(sandbox, 'swap ç & [1] '));
  const appDir = path.join(base, 'Baixador'), newDir = appDir + '.nova-2.0.0', backup = appDir + '.anterior-1.0.0';
  for (const [dir, label] of [[appDir, 'antiga'], [newDir, 'nova']]) {
    fs.mkdirSync(dir);
    fs.copyFileSync(path.join(process.env.SystemRoot!, 'System32', 'whoami.exe'), path.join(dir, 'Baixador.exe'));
    fs.writeFileSync(path.join(dir, 'versao.txt'), label);
  }
  const holder = locked ? spawn(path.join(process.env.SystemRoot!, 'System32', 'PING.EXE'), ['-n', '60', '127.0.0.1'], { cwd: appDir, stdio: 'ignore' }) : undefined;
  const result = path.join(base, 'resultado.json');
  const app = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 2500)'], { stdio: 'ignore' }); // stands in for the running app
  await startHelper(path.join(base, 'aux'), { AppPid: app.pid!, AppDir: appDir, NewDir: newDir, Backup: backup, Exe: 'Baixador.exe', Result: result, Version: '2.0.0' });
  for (let i = 0; i < 90 && !fs.existsSync(result); i++) await new Promise((r) => setTimeout(r, 1000));
  await new Promise((r) => setTimeout(r, 1000));
  holder?.kill();
  const r = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, 'utf8').replace(/^\uFEFF/, '')) : undefined;
  const now = fs.existsSync(path.join(appDir, 'versao.txt')) ? fs.readFileSync(path.join(appDir, 'versao.txt'), 'utf8') : '(sumiu)';
  const ok = locked ? r?.ok === false && now === 'antiga' && !fs.existsSync(backup) : r?.ok === true && now === 'nova' && fs.readFileSync(path.join(backup, 'versao.txt'), 'utf8') === 'antiga' && !fs.existsSync(newDir);
  record(name, ok, r ? r.message.slice(0, 90) : 'sem resultado');
}

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  record('versões: comparação e validação', compareVersions('1.10.0', '1.9.9') > 0 && compareVersions('v1.2.0', '1.2.0') === 0 && !parseVersion('1.2.0-beta') && !parseVersion('latest'));
  record('SHA256SUMS: encontra só o nome exato', hashFromSums(`${'a'.repeat(64)}  x.exe\n${'b'.repeat(64)} *y.zip`, 'y.zip') === 'b'.repeat(64) && !hashFromSums(`${'a'.repeat(64)}  xx.exe`, 'x.exe'));
  record('feed de teste: só aceita este computador', !localTestFeed('https://evil.example/latest') && !localTestFeed('http://127.0.0.1.evil.example/x') && !!localTestFeed('http://127.0.0.1:1/x'));
  const foreign = readRelease({ tag_name: 'v9.0.0', draft: false, prerelease: false, assets: [{ name: 'Baixador-Setup-9.0.0.exe', size: 5, browser_download_url: 'https://github.com/outro/repo/releases/download/v9.0.0/Baixador-Setup-9.0.0.exe' }] }, 'installed');
  record('arquivo de outro repositório é ignorado', !('ignored' in foreign) && !foreign.asset);

  for (const [name, sc] of [['mesma versão: atualizado', { tag: 'v1.2.0' }], ['versão antiga: sem downgrade', { tag: 'v1.0.0' }], ['rascunho é ignorado', { draft: true }], ['pré-lançamento é ignorado', { prerelease: true }], ['tag inválida é ignorada', { tag: 'v2.0.0-rc1' }]] as const) {
    scenario = sc;
    const t = make();
    await t.u.check();
    record(name, t.u.state.status === 'uptodate' && !t.u.state.info, t.u.state.status);
  }

  scenario = {};
  {
    const t = make();
    await t.u.check();
    record('nova versão com notas', t.u.state.status === 'available' && t.u.state.info?.version === '2.0.0' && t.u.state.info.notes === 'Notas de teste');
    await t.u.download();
    const progressed = t.states.some((s) => s.status === 'verifying');
    record('download completo e verificado', t.u.state.status === 'ready' && progressed && t.files().length === 1 && !t.files()[0].endsWith('.part'), t.u.state.error ?? t.files().join());
    // tamper with the verified file before installing
    fs.appendFileSync(path.join(t.tempRoot, 'Baixador-update', t.files()[0]), 'x');
    const r = await t.u.install();
    record('arquivo alterado depois da verificação não é executado', !r.ok && /mudou/.test(r.error ?? '') && !t.quit() && t.files().length === 0, r.error);
  }
  {
    const t = make({ busy: () => 'Há downloads em andamento.' });
    await t.u.check(); await t.u.download();
    const r = await t.u.install();
    record('não instala com tarefas em andamento', !r.ok && /andamento/.test(r.error!) && !t.quit(), r.error);
  }
  {
    const t = make();
    const r = await t.u.install();
    record('não instala sem download verificado', !r.ok && !t.quit(), r.error);
  }
  scenario = { download: 'slow' };
  {
    let sawSpeed = false;
    const t = make({ onState: (s, u) => { if (s.status === 'downloading' && (s.received ?? 0) > 700_000) { sawSpeed ||= (s.speed ?? 0) > 0; u.cancel(); } } });
    await t.u.check(); await t.u.download();
    record('cancelamento: volta ao estado disponível, sem temporários', t.u.state.status === 'available' && t.files().length === 0, t.u.state.status);
    record('progresso e velocidade informados', sawSpeed);
  }
  await failing('download interrompido (conexão cai)', { download: 'cut' }, /conexão caiu|incompleto/);
  await failing('download incompleto sem erro de rede', { download: 'short' }, /incompleto/);
  await failing('hash inválido', { sums: `${'0'.repeat(64)}  Baixador-Setup-2.0.0.exe\n` }, /SHA-256 falhou/);
  await failing('digest da API diverge do SHA256SUMS', { digest: 'sha256:' + '1'.repeat(64) }, /não conferem/);
  await failing('SHA256SUMS sem o arquivo', { sums: `${'0'.repeat(64)}  outro.exe\n` }, /não contém/);
  await failing('arquivo inválido (hash certo, não é executável)', { body: Buffer.from('<html>erro</html>'.repeat(100)) }, /não é um instalador/);
  await failing('redirecionamento para outro endereço é bloqueado', { download: 'redirect-evil' }, /não permitido/);
  await failing('erro do servidor no download', { download: '500' }, /500/);
  await failing('limite de consultas do GitHub', { api: 403 }, /limitou/);
  await failing('resposta que não é JSON', { garbage: true }, /conexão|GitHub/);
  scenario = { sums: null };
  {
    const t = make();
    await t.u.check();
    record('sem SHA256SUMS: só oferece a página da release', t.u.state.status === 'available' && /SHA256SUMS/.test(t.u.state.manualReason ?? ''), t.u.state.manualReason);
    await t.u.download();
    record('sem SHA256SUMS: não baixa nada', t.files().length === 0);
  }
  scenario = {};
  {
    const t = make({ feed: 'http://127.0.0.1:9/latest' });
    await t.u.check();
    record('falha de conexão', t.u.state.status === 'error' && /conexão/.test(t.u.state.error!), t.u.state.error);
  }

  if (process.platform === 'win32') {
    mode = 'REAL';
    await swapCase('troca de pasta: o script real substitui a pasta e guarda a anterior', false);
    await swapCase('troca de pasta: pasta em uso, nada é alterado', true);
    mode = 'SIMULADO';
  }

  if (process.argv.includes('--real')) {
    mode = 'REAL';
    const same = make({ feed: null, version: '9.9.9' });
    await same.u.check();
    record('GitHub: versão instalada mais nova que a publicada', same.u.state.status === 'uptodate', same.u.state.error ?? same.u.state.status);
    for (const kind of ['installed', 'portable'] as const) {
      const t = make({ feed: null, version: '0.9.0', kind });
      await t.u.check();
      const ok = t.u.state.status === 'available' && !t.u.state.manualReason;
      record(`GitHub: nova versão encontrada (${kind})`, ok, t.u.state.error ?? `${t.u.state.info?.version} · ${t.u.state.info?.asset?.name}`);
      if (!ok) continue;
      const started = Date.now();
      await t.u.download();
      record(`GitHub: download real verificado por SHA-256 (${kind})`, t.u.state.status === 'ready', t.u.state.error ?? `${t.u.state.total} bytes em ${((Date.now() - started) / 1000).toFixed(0)} s`);
      t.u.cleanup();
    }
  }

  server.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passaram`);
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
void main();
