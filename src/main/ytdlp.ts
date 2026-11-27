// Everything that talks to yt-dlp.exe / ffmpeg.exe directly.
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AnalyzeResult, AudioOption, MediaInfo, Settings, ToolStatus, VideoOption } from '../shared/types';
import { logger } from './logger';

export const childEnv = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

/** Arguments every yt-dlp call gets. */
export function baseArgs(s: Settings): string[] {
  const args = ['--ffmpeg-location', path.dirname(s.ffmpegPath)];
  if (s.cookiesFromBrowser !== 'none') args.push('--cookies-from-browser', s.cookiesFromBrowser);
  return args;
}

/** Kills a process and all of its children (yt-dlp spawns ffmpeg). */
export function killTree(child: ChildProcess | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || !child.pid) return resolve();
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

// ---------------------------------------------------------------- tools check

function versionOf(exe: string, args: string[]): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    if (!fs.existsSync(exe)) return resolve({ ok: false, error: 'Arquivo não encontrado' });
    execFile(exe, args, { windowsHide: true, timeout: 20000, env: childEnv() }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true, version: stdout.split(/\r?\n/)[0].trim() });
    });
  });
}

export async function checkTools(s: Settings): Promise<ToolStatus> {
  const [y, f] = await Promise.all([versionOf(s.ytdlpPath, ['--version']), versionOf(s.ffmpegPath, ['-version'])]);
  if (f.version) f.version = f.version.replace(/^ffmpeg version\s+/, '').split(' ')[0].replace(/-(full_build|essentials).*$/, '');
  const status = { ytdlp: { ...y, path: s.ytdlpPath }, ffmpeg: { ...f, path: s.ffmpegPath } };
  logger.info('tools', `yt-dlp: ${y.ok ? y.version : 'ERRO ' + y.error} | ffmpeg: ${f.ok ? f.version : 'ERRO ' + f.error}`);
  return status;
}

export function updateYtdlp(s: Settings): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(s.ytdlpPath, ['-U'], { windowsHide: true, timeout: 180000, env: childEnv() }, (err, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim();
      logger.info('update', output);
      resolve({ ok: !err, output });
    });
  });
}

// ---------------------------------------------------------------- friendly errors

const ERRORS: [RegExp, string][] = [
  [/Unsupported URL|is not a valid URL|No suitable extractor/i, 'Este link não é suportado. Verifique se ele aponta para um vídeo.'],
  [/Private video|This video is private/i, 'Este vídeo é privado.'],
  [/confirm your age|age.?restricted|inappropriate for some users/i, 'Este vídeo tem restrição de idade. Ative "Usar cookies do navegador" em Configurações › Avançado (com a conta logada no navegador).'],
  [/confirm (your|you.re) not a bot|Sign in to confirm/i, 'O site pediu login para confirmar que você não é um robô. Em Configurações › Avançado, ative "Usar cookies do navegador".'],
  [/members-only|Join this channel/i, 'Conteúdo exclusivo para membros do canal.'],
  [/Video unavailable|This video is not available|has been removed|does not exist|HTTP Error 404/i, 'Vídeo indisponível ou removido.'],
  [/not available in your country|geo.?restrict/i, 'Este vídeo não está disponível na sua região.'],
  [/Requested format is not available/i, 'A qualidade escolhida não está mais disponível. Analise o link novamente.'],
  [/HTTP Error 403|Forbidden/i, 'O servidor recusou o download (erro 403). Tente novamente ou atualize o yt-dlp em Diagnóstico.'],
  [/HTTP Error 429|Too Many Requests/i, 'Muitas requisições ao site. Aguarde alguns minutos e tente de novo.'],
  [/getaddrinfo|Failed to resolve|Unable to download webpage|timed out|Connection reset|network is unreachable|No connection/i, 'Falha de conexão. Verifique sua internet.'],
  [/ffmpeg (is )?not (found|installed)|ffprobe.*not found|Postprocessing.*ffmpeg/i, 'O FFmpeg não foi encontrado. Confira o caminho em Configurações.'],
  [/No space left|disk full|Errno 28/i, 'Sem espaço em disco.'],
  [/Permission denied|Errno 13|Access is denied/i, 'Sem permissão para gravar na pasta de destino. Escolha outra pasta.'],
  [/could not (copy|find) .*cookie|cookies database|Could not copy Chrome cookie/i, 'Não foi possível ler os cookies do navegador. Feche o navegador e tente de novo, ou use o Firefox.'],
  [/is live|live event|Premieres in/i, 'Transmissões ao vivo ou estreias ainda não iniciadas não podem ser baixadas aqui.'],
  [/DRM/i, 'Este conteúdo é protegido por DRM e não pode ser baixado.'],
];

export function friendlyError(text: string): string {
  const errLines = text.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).join('\n') || text;
  for (const [re, msg] of ERRORS) if (re.test(errLines)) return msg;
  return 'Não foi possível concluir. Veja os detalhes em Diagnóstico.';
}

// ---------------------------------------------------------------- analysis

let analyzeChild: ChildProcess | null = null;

export function cancelAnalyze() {
  const c = analyzeChild;
  analyzeChild = null;
  return killTree(c);
}

export function analyze(s: Settings, url: string): Promise<AnalyzeResult> {
  return new Promise((resolve) => {
    if (!fs.existsSync(s.ytdlpPath)) return resolve({ ok: false, error: 'O yt-dlp não foi encontrado. Confira o caminho em Configurações.' });
    void cancelAnalyze();
    const args = [...baseArgs(s), '-J', '--no-playlist', '--flat-playlist', url];
    logger.info('analyze', `yt-dlp ${args.join(' ')}`);
    const t0 = Date.now();
    const child = spawn(s.ytdlpPath, args, { windowsHide: true, env: childEnv() });
    analyzeChild = child;
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => resolve({ ok: false, error: 'Não foi possível executar o yt-dlp.', detail: e.message }));
    child.on('close', (code) => {
      const canceled = analyzeChild !== child;
      if (analyzeChild === child) analyzeChild = null;
      if (canceled) return resolve({ ok: false, error: 'Análise cancelada.' });
      if (err.trim()) logger.warn('analyze', err.trim());
      if (code !== 0) {
        logger.error('analyze', `yt-dlp saiu com código ${code}`);
        return resolve({ ok: false, error: friendlyError(err), detail: err.trim() });
      }
      try {
        const j = JSON.parse(Buffer.concat(out).toString('utf8'));
        if (j._type === 'playlist') {
          const n = j.entries?.length ?? j.playlist_count;
          return resolve({ ok: false, error: `Este link é uma playlist${n ? ` com ${n} vídeos` : ''}. Cole o link de um vídeo específico.` });
        }
        if (j.is_live) return resolve({ ok: false, error: 'Transmissões ao vivo não podem ser baixadas aqui. Tente depois que a live terminar.' });
        const info = parseInfo(j, url);
        if (/challenge solving failed|Error solving n challenge/i.test(err)) info.outdatedWarning = true;
        logger.info('analyze', `OK em ${Date.now() - t0} ms: "${info.title}" · ${info.formatCount} formatos · ${info.videoOptions.length} resoluções · ${info.audioOptions.length} áudios`);
        resolve({ ok: true, info });
      } catch (e: any) {
        logger.error('analyze', 'JSON inválido: ' + e.message);
        resolve({ ok: false, error: 'Resposta inesperada do yt-dlp. Veja Diagnóstico.', detail: e.message });
      }
    });
  });
}

const codecName = (vc?: string) => {
  if (!vc) return '';
  if (/^avc|h264/i.test(vc)) return 'H.264';
  if (/^vp0?9/i.test(vc)) return 'VP9';
  if (/^av01/i.test(vc)) return 'AV1';
  if (/^hev|hvc|h265/i.test(vc)) return 'H.265';
  if (/^vp0?8/i.test(vc)) return 'VP8';
  return vc.split('.')[0].toUpperCase();
};

const audioCodecName = (ac?: string, ext?: string) => {
  if (!ac || ac === 'none') return (ext || '').toUpperCase();
  if (/^mp4a/i.test(ac)) return 'AAC';
  if (/opus/i.test(ac)) return 'Opus';
  if (/vorbis/i.test(ac)) return 'Vorbis';
  if (/mp3/i.test(ac)) return 'MP3';
  if (/flac/i.test(ac)) return 'FLAC';
  return ac.split('.')[0].toUpperCase();
};

export function parseInfo(j: any, url: string): MediaInfo {
  const duration: number | undefined = j.duration ?? undefined;
  const raw: any[] = (j.formats?.length ? j.formats : [j]).filter(
    (f: any) => f && f.format_id !== undefined && !f.has_drm && f.ext !== 'mhtml' && !/storyboard/i.test(f.format_note || ''),
  );
  const sizeOf = (f: any): number | undefined =>
    f.filesize ?? f.filesize_approx ?? (f.tbr && duration ? Math.round((f.tbr * 1000 / 8) * duration) : undefined);
  const hasVideo = (f: any) => (f.vcodec ? f.vcodec !== 'none' : !!(f.height || f.width) || f.acodec == null);
  const hasAudio = (f: any) => (f.acodec ? f.acodec !== 'none' : true);
  const isDrc = (f: any) => /drc/i.test(String(f.format_id)) || /DRC/.test(f.format_note || '');
  const isHttps = (f: any) => !f.protocol || /^https?$/.test(f.protocol);

  // ---- audio-only formats
  const audios = raw.filter((f) => !hasVideo(f) && hasAudio(f) && (f.abr || f.tbr || sizeOf(f)));
  const audioOptions: AudioOption[] = [];
  const seen = new Set<string>();
  for (const f of audios.sort((a, b) => Number(isDrc(a)) - Number(isDrc(b)) || (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))) {
    const abr = Math.round(f.abr ?? f.tbr ?? 0) || undefined;
    const codec = audioCodecName(f.acodec, f.ext);
    const k = `${codec}-${abr}-${f.language ?? ''}`;
    if (seen.has(k) || (isDrc(f) && audios.some((o) => !isDrc(o) && Math.abs((o.abr ?? 0) - (f.abr ?? 0)) < 8 && o.ext === f.ext))) continue;
    seen.add(k);
    audioOptions.push({ formatId: String(f.format_id), ext: f.ext, codec, abr, size: sizeOf(f), note: f.language && f.language !== 'und' ? f.language : undefined });
  }
  audioOptions.sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));
  const nonDrcAudios = audios.filter((f) => !isDrc(f));
  const bestBy = (list: any[]) => list.sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0];
  const bestM4a = bestBy(nonDrcAudios.filter((f) => f.ext === 'm4a'));
  const bestAny = bestBy([...nonDrcAudios]);

  // ---- video formats grouped by resolution + fps
  const videos = raw.filter(hasVideo);
  const groups = new Map<string, any[]>();
  for (const f of videos) {
    const h = f.height ?? 0;
    const fps = f.fps ? Math.round(f.fps) : 0;
    const k = `${h}-${fps}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const mp4Score = (f: any) =>
    (/^avc/i.test(f.vcodec || '') ? 3e6 : f.ext === 'mp4' ? 2e6 : 1e6) + (isHttps(f) ? 1e5 : 0) + (f.tbr ?? 0);
  const bestScore = (f: any) => (isHttps(f) ? 1e5 : 0) + (f.tbr ?? 0) + (/^av01/i.test(f.vcodec || '') ? 500 : 0);

  const videoOptions: VideoOption[] = [];
  for (const [k, list] of groups) {
    const mp4 = [...list].sort((a, b) => mp4Score(b) - mp4Score(a))[0];
    const best = [...list].sort((a, b) => bestScore(b) - bestScore(a))[0];
    const h = mp4.height ?? 0;
    const fps = mp4.fps ? Math.round(mp4.fps) : undefined;
    const aM4a = hasAudio(mp4) ? 0 : sizeOf(bestM4a ?? bestAny ?? {}) ?? 0;
    const aAny = hasAudio(best) ? 0 : sizeOf(bestAny ?? {}) ?? 0;
    const vs = sizeOf(mp4), bs = sizeOf(best);
    videoOptions.push({
      key: k,
      height: h,
      width: mp4.width ?? undefined,
      fps,
      label: h ? `${h}p` : mp4.format_note || mp4.format_id,
      codec: codecName(best.vcodec),
      mp4FormatId: String(mp4.format_id),
      mp4Codec: codecName(mp4.vcodec),
      mp4Size: vs !== undefined ? vs + aM4a : undefined,
      mp4HasAudio: hasAudio(mp4),
      bestFormatId: String(best.format_id),
      bestSize: bs !== undefined ? bs + aAny : undefined,
      bestHasAudio: hasAudio(best),
    });
  }
  videoOptions.sort((a, b) => b.height - a.height || (b.fps ?? 0) - (a.fps ?? 0));
  // Drop odd low-frame-rate duplicates (e.g. a 15 fps 144p stream next to the normal 30 fps one).
  for (let i = videoOptions.length - 1; i >= 0; i--) {
    const o = videoOptions[i];
    if (o.fps && o.fps < 20 && videoOptions.some((x) => x !== o && x.height === o.height && (x.fps ?? 0) >= 20)) videoOptions.splice(i, 1);
  }

  const thumbs: any[] = j.thumbnails ?? [];
  const thumbnail =
    j.thumbnail ??
    [...thumbs].filter((t) => t.url && !/\.webp/i.test(t.url)).sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0))[0]?.url ??
    thumbs[thumbs.length - 1]?.url;

  return {
    url: j.webpage_url || url,
    id: String(j.id ?? ''),
    title: j.title || j.fulltitle || 'Sem título',
    uploader: j.uploader || j.channel || j.creator || j.uploader_id || undefined,
    duration,
    thumbnail,
    site: j.extractor_key || j.webpage_url_domain || j.extractor || '',
    isLive: !!j.is_live,
    videoOptions,
    audioOptions,
    bestAudioSize: sizeOf(bestM4a ?? bestAny ?? {}),
    bestAudioSizeAny: sizeOf(bestAny ?? {}),
    formatCount: raw.length,
  };
}

// ---------------------------------------------------------------- auto-detection

/** Places where yt-dlp / FFmpeg usually live on Windows, plus whatever `where` finds on PATH. */
function candidates(exe: 'yt-dlp.exe' | 'ffmpeg.exe'): string[] {
  const env = process.env;
  const list = exe === 'yt-dlp.exe'
    ? ['C:\\yt-dlp\\yt-dlp.exe']
    : ['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'];
  if (env.LOCALAPPDATA) list.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe));
  if (env.USERPROFILE) list.push(path.join(env.USERPROFILE, 'scoop', 'shims', exe));
  list.push(path.join(env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', exe));
  try {
    const out = execFileSync('where', [exe], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    list.push(...out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch {}
  return [...new Set(list)];
}

export function findTool(exe: 'yt-dlp.exe' | 'ffmpeg.exe'): string | undefined {
  return candidates(exe).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

/** Fills in tool paths that are missing on this computer. Returns what changed. */
export function autoDetect(s: Settings, force = false): Partial<Settings> {
  const patch: Partial<Settings> = {};
  if (force || !fs.existsSync(s.ytdlpPath)) {
    const p = findTool('yt-dlp.exe');
    if (p && p !== s.ytdlpPath) patch.ytdlpPath = p;
  }
  if (force || !fs.existsSync(s.ffmpegPath)) {
    const p = findTool('ffmpeg.exe');
    if (p && p !== s.ffmpegPath) patch.ffmpegPath = p;
  }
  if (Object.keys(patch).length) logger.info('tools', `Detectado automaticamente: ${JSON.stringify(patch)}`);
  return patch;
}
