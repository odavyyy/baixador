// Download queue: spawns yt-dlp per job, parses real progress, handles pause/resume/cancel/retry.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DownloadRequest, FilenameStyle, HistoryItem, Job, Settings } from '../shared/types';
import { JsonFile } from './store';
import { logger } from './logger';
import { baseArgs, childEnv, friendlyError, killTree } from './ytdlp';

const TEMPLATES: Record<FilenameStyle, string> = {
  title: '%(title)s.%(ext)s',
  'title-id': '%(title)s [%(id)s].%(ext)s',
  'channel-title': '%(uploader,channel|Desconhecido)s - %(title)s.%(ext)s',
  'date-title': '%(upload_date>%Y-%m-%d|sem data)s - %(title)s.%(ext)s',
};

const PP_LABEL: Record<string, string> = {
  Merger: 'Juntando vídeo e áudio',
  ExtractAudio: 'Convertendo áudio',
  EmbedThumbnail: 'Adicionando capa',
  FFmpegMetadata: 'Gravando informações',
  Metadata: 'Gravando informações',
  VideoRemuxer: 'Convertendo para MP4',
  VideoConvertor: 'Convertendo vídeo',
  FixupM3u8: 'Ajustando arquivo',
  FixupM4a: 'Ajustando arquivo',
  FixupStretched: 'Ajustando arquivo',
  FixupDuplicateMoov: 'Ajustando arquivo',
  FixupTimestamp: 'Ajustando arquivo',
};

interface Runtime {
  child: ChildProcess;
  files: Map<string, { downloaded: number; total?: number }>;
  phases: number;
  stopReason?: 'pause' | 'cancel';
  errTail: string[];
  finalPath?: string;
  lastDest?: string;
  alreadyExists?: boolean;
}

export interface ManagerHooks {
  settings: () => Settings;
  onChange: (jobs: Job[]) => void;
  onFinished: (job: Job) => void;
  addHistory: (item: HistoryItem, thumbUrl?: string) => void;
}

const num = (s: string) => (s === 'NA' || s === 'None' || s === '' ? undefined : Number(s));

export class DownloadManager {
  private store = new JsonFile<Job[]>('jobs.json', []);
  private running = new Map<string, Runtime>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private hooks: ManagerHooks) {
    // Jobs interrupted by closing the app come back paused (partial files are kept, so they resume).
    for (const j of this.store.value) {
      if (['downloading', 'processing', 'queued'].includes(j.status)) {
        j.status = 'paused';
        j.speed = undefined;
        j.eta = undefined;
        j.stage = undefined;
      }
    }
    this.store.scheduleSave();
  }

  get jobs() { return this.store.value; }
  list() { return this.jobs; }
  private find(id: string) { return this.jobs.find((j) => j.id === id); }

  private changed(immediate = false) {
    this.store.scheduleSave(1000);
    if (immediate) {
      if (this.emitTimer) { clearTimeout(this.emitTimer); this.emitTimer = null; }
      this.hooks.onChange(this.jobs);
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.hooks.onChange(this.jobs); }, 150);
  }

  enqueue(req: DownloadRequest): Job {
    const job = this.add(req);
    this.changed(true);
    this.schedule();
    return job;
  }

  /** Adds a whole batch before starting anything, so the batch can't look finished halfway through. */
  enqueueMany(reqs: DownloadRequest[]): number {
    // add() puts jobs at the top and schedule() takes from the bottom, so the first item still starts first.
    for (const r of reqs) this.add(r);
    this.changed(true);
    this.schedule();
    return reqs.length;
  }

  private add(req: DownloadRequest): Job {
    const s = this.hooks.settings();
    const job: Job = {
      ...req,
      id: randomUUID(),
      status: 'queued',
      progress: 0,
      downloaded: 0,
      createdAt: Date.now(),
      outputDir: req.outputDir || s.downloadDir,
    };
    this.jobs.unshift(job);
    logger.info('queue', `Adicionado: "${job.title}" (${job.mode}, ${job.qualityLabel})`);
    return job;
  }

  schedule() {
    const max = Math.max(1, Math.min(10, this.hooks.settings().maxConcurrent || 1));
    // oldest queued first
    const queued = this.jobs.filter((j) => j.status === 'queued').reverse();
    for (const j of queued) {
      if (this.running.size >= max) break;
      this.start(j);
    }
  }

  /** Same quality, but only HLS (m3u8) streams: they keep working when YouTube rejects direct links with 403. */
  private fallbackSpec(job: Job): string {
    const h = job.height ? `[height<=${job.height}]` : '';
    const hls = '[protocol*=m3u8]';
    if (job.mode === 'mp3' || job.mode === 'audio') return `ba${hls}/b${hls}`;
    return `bv*${h}${hls}+ba${hls}/b${h}${hls}`;
  }

  /** Output template; adds " (720p)" etc. when a file with the plain name already exists. */
  private template(job: Job, s: Settings): string {
    const base = TEMPLATES[s.filenameStyle] ?? TEMPLATES.title;
    if (!job.nameSuffix) return base;
    const safe = job.nameSuffix.replace(/[<>:"/\|?*%]/g, '').trim();
    return base.replace('.%(ext)s', ` (${safe}).%(ext)s`);
  }

  private buildArgs(job: Job, s: Settings): string[] {
    const args = [
      ...baseArgs(s),
      '--newline', '--no-playlist', '--no-mtime', '--trim-filenames', '180',
      '-P', job.outputDir,
      '-o', this.template(job, s),
      '-f', job.usedFallback ? this.fallbackSpec(job) : job.formatSpec,
      '--progress-template', 'download:[[P]]%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s',
      '--progress-template', 'postprocess:[[PP]]%(progress.status)s|%(progress.postprocessor)s',
      '--print', 'after_move:[[FILE]]%(filepath)s',
      '--no-quiet', '--progress',
    ];
    if (job.formatSort && !job.usedFallback) args.push('-S', job.formatSort);
    switch (job.mode) {
      case 'video':
        args.push('--merge-output-format', 'mp4', '--remux-video', 'mp4');
        break;
      case 'video-original':
        args.push('--merge-output-format', 'mkv');
        break;
      case 'mp3':
        // 0 means yt-dlp's best variable bitrate (--audio-quality 0)
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', job.bitrate === 0 ? '0' : `${job.bitrate ?? s.defaultBitrate}K`);
        if (s.embedMetadata) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
        break;
      case 'audio':
        // Keep the original codec: only remux to its natural container (.m4a / .opus), no re-encoding.
        args.push('-x', '--audio-format', 'best');
        break;
    }
    if (s.embedMetadata) args.push('--embed-metadata');
    args.push('--', job.url);
    return args;
  }

  private start(job: Job) {
    const s = this.hooks.settings();
    if (!fs.existsSync(s.ytdlpPath)) return this.fail(job, 'O yt-dlp não foi encontrado. Confira o caminho em Configurações.');
    try {
      fs.mkdirSync(job.outputDir, { recursive: true });
    } catch (e: any) {
      return this.fail(job, 'Não foi possível criar a pasta de destino. Escolha outra pasta em Configurações.', e.message);
    }
    const args = this.buildArgs(job, s);
    const tag = `job:${job.id.slice(0, 6)}`;
    logger.info(tag, `"${job.title}" → yt-dlp ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);

    const child = spawn(s.ytdlpPath, args, { windowsHide: true, env: childEnv(), cwd: job.outputDir });
    const rt: Runtime = {
      child,
      files: new Map(),
      phases: job.mode === 'video' || job.mode === 'video-original' ? (job.formatSpec.split('/')[0].includes('+') ? 2 : 1) : 1,
      errTail: [],
    };
    this.running.set(job.id, rt);
    Object.assign(job, {
      status: 'downloading', error: undefined, errorDetail: undefined, stage: 'Iniciando…',
      speed: undefined, eta: undefined, filePath: undefined, finishedAt: undefined,
    });
    this.changed(true);

    const onLine = (line: string, isErr: boolean) => {
      line = line.trimEnd();
      if (!line) return;
      if (line.startsWith('[[P]]')) return this.onProgress(job, rt, line.slice(5));
      if (line.startsWith('[[PP]]')) {
        const [st, pp] = line.slice(6).split('|');
        if (st === 'started' && pp !== 'MoveFiles') {
          job.status = 'processing';
          job.stage = pp === 'ExtractAudio' && job.mode === 'mp3' ? 'Convertendo para MP3' : PP_LABEL[pp] ?? 'Processando';
          job.speed = undefined;
          job.eta = undefined;
          this.changed();
        }
        logger.info(tag, `pós-processamento ${pp}: ${st}`);
        return;
      }
      if (line.startsWith('[[FILE]]')) { rt.finalPath = line.slice(8).trim(); return; }
      const dest = line.match(/^\[(?:download|ExtractAudio|VideoRemuxer)\] Destination: (.+)$/) || line.match(/^\[Merger\] Merging formats into "(.+)"$/);
      if (dest) rt.lastDest = dest[1];
      const already = line.match(/^\[download\] (.+) has already been downloaded/);
      if (already) { rt.lastDest = already[1]; rt.alreadyExists = true; }
      if (/^\[(youtube|info|generic)/.test(line) && job.status === 'downloading' && !rt.files.size) {
        job.stage = 'Preparando…';
        this.changed();
      }
      if (isErr || /^ERROR|WARNING/.test(line)) {
        rt.errTail.push(line);
        if (rt.errTail.length > 40) rt.errTail.shift();
      }
      logger[/^ERROR/.test(line) ? 'error' : /^WARNING/.test(line) ? 'warn' : 'info'](tag, line);
    };
    const lineReader = (isErr: boolean) => {
      let buf = '';
      return (d: Buffer) => {
        buf += d.toString('utf8');
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? '';
        for (const p of parts) onLine(p, isErr);
      };
    };
    child.stdout.on('data', lineReader(false));
    child.stderr.on('data', lineReader(true));
    child.on('error', (e) => {
      logger.error(tag, e.message);
      rt.errTail.push(e.message);
    });
    child.on('close', (code) => this.onExit(job, rt, code));
  }

  private onProgress(job: Job, rt: Runtime, payload: string) {
    const parts = payload.split('|');
    const [status, dl, tot, totEst, speed, eta] = parts;
    const filename = parts.slice(6).join('|');
    const f = rt.files.get(filename) ?? { downloaded: 0 };
    f.downloaded = num(dl) ?? f.downloaded;
    f.total = num(tot) ?? num(totEst) ?? f.total;
    if (status === 'finished' && f.total === undefined) f.total = f.downloaded;
    rt.files.set(filename, f);

    let sumDl = 0, sumTot = 0;
    for (const v of rt.files.values()) { sumDl += v.downloaded; sumTot += v.total ?? v.downloaded; }
    const pending = Math.max(0, rt.phases - rt.files.size);
    let total = sumTot;
    if (pending > 0) {
      const rest = job.expectedSize ? job.expectedSize - sumTot : 0;
      total += rest > 0 ? rest : sumTot * 0.15 * pending; // unknown audio track: small share
    }
    const pct = total > 0 ? Math.min(99.5, (sumDl / total) * 100) : 0;
    job.progress = Math.max(job.progress, pct);
    job.downloaded = sumDl;
    job.total = total || undefined;
    job.speed = num(speed);
    job.eta = num(eta);
    if (job.status !== 'processing') {
      job.status = 'downloading';
      job.stage = rt.phases === 2 ? (rt.files.size <= 1 ? 'Baixando vídeo' : 'Baixando áudio') : job.mode === 'mp3' || job.mode === 'audio' ? 'Baixando áudio' : 'Baixando';
    }
    this.changed();
  }

  private onExit(job: Job, rt: Runtime, code: number | null) {
    this.running.delete(job.id);
    const tag = `job:${job.id.slice(0, 6)}`;
    logger.info(tag, `yt-dlp terminou (código ${code})${rt.stopReason ? ` — ${rt.stopReason}` : ''}`);
    job.speed = undefined;
    job.eta = undefined;

    if (rt.stopReason === 'pause') {
      job.status = 'paused';
      job.stage = undefined;
    } else if (rt.stopReason === 'cancel') {
      job.status = 'canceled';
      job.stage = undefined;
      this.cleanupPartials(rt);
    } else {
      const file = rt.finalPath || rt.lastDest;
      if (code === 0 && rt.alreadyExists && !job.nameSuffix) {
        // A file with this name already exists (maybe another quality): download again with the quality in the name.
        logger.info(tag, `Já existe um arquivo com esse nome (${file}). Baixando como "(${job.qualityLabel})".`);
        job.nameSuffix = job.qualityLabel;
        job.status = 'queued';
        job.progress = 0;
        job.downloaded = 0;
      } else if (code === 0 && file && fs.existsSync(file)) {
        job.status = 'completed';
        job.progress = 100;
        job.stage = undefined;
        job.filePath = file;
        job.finishedAt = Date.now();
        try { job.total = fs.statSync(file).size; job.downloaded = job.total; } catch {}
        logger.info(tag, `Concluído: ${file}`);
        this.hooks.addHistory(
          {
            id: job.id, title: job.title, url: job.url, filePath: file, uploader: job.uploader,
            mode: job.mode, qualityLabel: job.qualityLabel, size: job.total, date: job.finishedAt,
          },
          job.thumbnail,
        );
      } else if (!job.usedFallback && /HTTP Error 403/.test(rt.errTail.join('\n'))) {
        logger.warn(tag, 'Link direto recusado (403). Tentando de novo pelo método alternativo (HLS)…');
        job.usedFallback = true;
        job.status = 'queued';
        job.progress = 0;
        job.downloaded = 0;
        job.stage = 'Tentando outro método…';
        this.cleanupPartials(rt);
      } else {
        const detail = rt.errTail.join('\n');
        this.fail(job, code === 0 ? 'O download terminou, mas o arquivo final não foi encontrado.' : friendlyError(detail), detail, false);
      }
    }
    this.changed(true);
    if (job.status === 'completed' || job.status === 'error') this.hooks.onFinished(job);
    this.schedule();
  }

  private fail(job: Job, msg: string, detail?: string, notify = true) {
    job.status = 'error';
    job.error = msg;
    job.errorDetail = detail;
    job.stage = undefined;
    job.speed = undefined;
    job.eta = undefined;
    logger.error(`job:${job.id.slice(0, 6)}`, `${msg}${detail ? '\n' + detail : ''}`);
    if (notify) { this.changed(true); this.hooks.onFinished(job); this.schedule(); }
  }

  private cleanupPartials(rt: Runtime) {
    for (const name of rt.files.keys()) {
      const dir = path.dirname(name);
      const base = path.basename(name);
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith(base) && /\.(part|ytdl)$|\.part-Frag\d+|\.temp$/.test(f.slice(base.length) || '')) {
            fs.rmSync(path.join(dir, f), { force: true });
          }
        }
        // the finished-but-unmerged stream file (e.g. "x.f137.mp4") is useless after cancel
        if (/\.f[\w-]+\.\w+$/.test(base) && fs.existsSync(name)) fs.rmSync(name, { force: true });
      } catch {}
    }
  }

  async pause(id: string) {
    const rt = this.running.get(id);
    const job = this.find(id);
    if (!job) return;
    if (rt) { rt.stopReason = 'pause'; await killTree(rt.child); }
    else if (job.status === 'queued') { job.status = 'paused'; this.changed(true); }
  }

  resume(id: string) {
    const job = this.find(id);
    if (!job || job.status !== 'paused') return;
    job.status = 'queued';
    job.stage = undefined;
    this.changed(true);
    this.schedule();
  }

  async cancel(id: string) {
    const rt = this.running.get(id);
    const job = this.find(id);
    if (!job) return;
    if (rt) { rt.stopReason = 'cancel'; await killTree(rt.child); }
    else if (['queued', 'paused', 'error'].includes(job.status)) {
      job.status = 'canceled';
      this.changed(true);
    }
  }

  retry(id: string) {
    const job = this.find(id);
    if (!job || this.running.has(id)) return;
    Object.assign(job, { status: 'queued', usedFallback: false, nameSuffix: undefined, progress: 0, downloaded: 0, total: undefined, error: undefined, errorDetail: undefined, stage: undefined });
    this.changed(true);
    this.schedule();
  }

  remove(id: string) {
    if (this.running.has(id)) return;
    this.store.set(this.jobs.filter((j) => j.id !== id));
    this.changed(true);
  }

  clearFinished() {
    this.store.set(this.jobs.filter((j) => !['completed', 'canceled', 'error'].includes(j.status)));
    this.changed(true);
  }

  activeCount() { return this.running.size; }

  async shutdown() {
    for (const [id, rt] of this.running) {
      rt.stopReason = 'pause';
      const j = this.find(id);
      if (j) j.status = 'paused';
      await killTree(rt.child);
    }
    this.store.saveNow();
  }
}
