// Local video conversion with the user's FFmpeg: probing, encoder tests, argument building and one job at a time.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPlan, encoderInfo, ENCODERS, MAX_ATTEMPTS, MB, retryKbps,
  type ConvertRequest, type ConvertSettings, type ConvertState, type EncoderId, type EncoderPref, type Hardware, type MediaProbe, type Plan,
} from '../shared/convert';
import type { Settings } from '../shared/types';
import { logger } from './logger';
import { killTree } from './ytdlp';

export const ffprobePath = (s: Settings) => path.join(path.dirname(s.ffmpegPath), 'ffprobe.exe');

function run(exe: string, args: string[], timeout = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (err: any, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) || err?.message || '' });
    });
  });
}

function requireTools(s: Settings) {
  if (!fs.existsSync(s.ffmpegPath)) throw new Error('O FFmpeg não foi encontrado. Indique o caminho em Configurações › Programas.');
  if (!fs.existsSync(ffprobePath(s))) throw new Error('O ffprobe.exe não está na mesma pasta do ffmpeg.exe. Ele faz parte do pacote do FFmpeg e é necessário para o conversor.');
}

// ---------------------------------------------------------------- probe

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
const ratio = (v?: string) => { if (!v) return undefined; const [a, b] = v.split('/').map(Number); return a > 0 && b > 0 ? a / b : undefined; };

export async function probeFile(s: Settings, file: string): Promise<MediaProbe> {
  requireTools(s);
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { throw new Error('Arquivo não encontrado.'); }
  if (!stat.isFile() || stat.size === 0) throw new Error('O arquivo está vazio ou não é um arquivo válido.');
  const r = await run(ffprobePath(s), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 60_000);
  let j: any;
  try { j = JSON.parse(r.stdout); } catch { j = undefined; }
  const streams: any[] = j?.streams ?? [];
  if (r.code !== 0 || !streams.length) {
    logger.warn('convert', `ffprobe falhou em "${path.basename(file)}": ${r.stderr.trim()}`);
    throw new Error('Não foi possível ler este arquivo. Ele pode estar corrompido ou não ser um vídeo.');
  }
  const v = streams.find((x) => x.codec_type === 'video' && !x.disposition?.attached_pic);
  const a = streams.find((x) => x.codec_type === 'audio');
  if (!v && !a) throw new Error('Este arquivo não tem vídeo nem áudio.');
  const rotation = Math.abs(Number(v?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0)) % 180;
  const duration = num(j.format?.duration) ?? num(v?.duration) ?? num(a?.duration);
  const totalKbps = num(j.format?.bit_rate) ? Math.round(Number(j.format.bit_rate) / 1000) : duration ? Math.round((stat.size * 8) / duration / 1000) : undefined;
  const audioKbps = num(a?.bit_rate) ? Math.round(Number(a.bit_rate) / 1000) : undefined;
  let videoKbps = num(v?.bit_rate) ? Math.round(Number(v.bit_rate) / 1000) : undefined;
  if (!videoKbps && v && totalKbps) videoKbps = Math.max(1, totalKbps - (a ? audioKbps ?? 128 : 0));
  const fps = ratio(v?.avg_frame_rate) ?? ratio(v?.r_frame_rate);
  return {
    path: file,
    name: path.basename(file),
    size: stat.size,
    duration,
    width: v ? (rotation === 90 ? v.height : v.width) : undefined,
    height: v ? (rotation === 90 ? v.width : v.height) : undefined,
    fps: fps && fps < 1000 ? Math.round(fps * 100) / 100 : undefined,
    vcodec: v?.codec_name,
    pixFmt: v?.pix_fmt,
    videoKbps,
    totalKbps,
    acodec: a?.codec_name,
    audioKbps,
    channels: a?.channels,
    hdr: /smpte2084|arib-std-b67/.test(v?.color_transfer ?? ''),
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

// ---------------------------------------------------------------- encoder detection

let hardware: Hardware | null = null;

/** An encoder counts as available only after a real (short, output-less) encode succeeds. */
export async function detectHardware(s: Settings, force = false): Promise<Hardware> {
  if (!force && hardware && hardware.ffmpegPath === s.ffmpegPath) return hardware;
  requireTools(s);
  const [list, filters] = await Promise.all([run(s.ffmpegPath, ['-hide_banner', '-encoders']), run(s.ffmpegPath, ['-hide_banner', '-filters'])]);
  const encoders: Hardware['encoders'] = [];
  // one at a time: consumer GPUs limit simultaneous NVENC sessions
  for (const e of ENCODERS) {
    const listed = new RegExp(`\\s${e.id}\\s`).test(list.stdout);
    let works = false;
    let error: string | undefined;
    if (listed) {
      const r = await run(s.ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30', '-frames:v', '5', '-pix_fmt', 'yuv420p', '-c:v', e.id, '-f', 'null', '-'], 30_000);
      works = r.code === 0;
      if (!works) error = r.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
    }
    encoders.push({ id: e.id, label: e.label, listed, works, error });
    logger.info('hardware', `${e.id}: ${!listed ? 'não listado' : works ? 'testado com sucesso' : 'listado, mas falhou: ' + error}`);
  }
  hardware = { testedAt: Date.now(), ffmpegPath: s.ffmpegPath, encoders, canTonemap: /\szscale\s/.test(filters.stdout) && /\stonemap\s/.test(filters.stdout) };
  return hardware;
}

// ---------------------------------------------------------------- arguments

/** Quality slider (0..100) to the libx264 CRF scale; other encoders are offset from it. */
export const crfFor = (quality: number) => Math.round(38 - 0.23 * Math.max(0, Math.min(100, quality)));

function videoFilters(plan: Plan, probe: MediaProbe): string[] {
  const f: string[] = [];
  if (plan.tonemap) f.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  if (plan.fpsFilter) f.push(`fps=${plan.fpsFilter}`);
  if (plan.scaled || (probe.width ?? 0) % 2 || (probe.height ?? 0) % 2) f.push(`scale=${plan.width}:${plan.height}:flags=lanczos`, 'setsar=1');
  f.push('format=yuv420p');
  return f;
}

function encoderArgs(plan: Plan, probe: MediaProbe): string[] {
  const s = plan.settings;
  const id = plan.encoder as EncoderId;
  const { codec, gpu } = encoderInfo(id);
  const a = ['-c:v', id];
  const kbps = plan.videoKbps;
  const crf = crfFor(s.quality);
  const cap = !kbps && s.sourceCap && probe.videoKbps ? Math.max(150, Math.round(probe.videoKbps * s.sourceCap)) : undefined;
  const capArgs = (k: number) => ['-maxrate', `${k}k`, '-bufsize', `${k * 2}k`];

  if (gpu) {
    a.push('-preset', 'p5', '-tune', 'hq');
    if (kbps) {
      a.push('-rc', 'vbr', '-multipass', 'fullres', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * (s.rate === 'size' ? 1.25 : 1.5))}k`, '-bufsize', `${kbps * 2}k`);
    } else {
      const cq = codec === 'av1' ? crf + 9 : codec === 'hevc' ? crf + 5 : crf + 3;
      a.push('-rc', 'vbr', '-cq', String(cq), '-b:v', '0', ...(cap ? capArgs(cap) : []));
    }
  } else if (id === 'libx264' || id === 'libx265') {
    a.push('-preset', 'medium');
    if (kbps) a.push('-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.45)}k`, '-bufsize', `${kbps * 2}k`);
    else a.push('-crf', String(id === 'libx265' ? crf + 4 : crf), ...(cap ? capArgs(cap) : []));
  } else if (id === 'libsvtav1') {
    a.push('-preset', '8');
    if (kbps) a.push('-b:v', `${kbps}k`);
    else a.push('-crf', String(crf + 10), ...(cap ? capArgs(cap) : []));
  } else {
    a.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', '3');
    if (kbps) a.push('-b:v', `${kbps}k`);
    else a.push('-crf', String(crf + 10), '-b:v', cap ? `${cap}k` : '0');
  }

  if (codec === 'h264') {
    if (s.legacyProfile) a.push('-profile:v', 'main', '-level:v', '3.1');
    else a.push('-profile:v', 'high');
  }
  if (codec === 'hevc' && s.container === 'mp4') a.push('-tag:v', 'hvc1'); // required by Apple players
  return a;
}

function audioArgs(plan: Plan): string[] {
  if (plan.audio === 'none') return ['-an'];
  if (plan.audio === 'copy') return ['-c:a', 'copy'];
  const lib = { aac: 'aac', mp3: 'libmp3lame', opus: 'libopus' }[plan.audio];
  const a = ['-c:a', lib, '-b:a', `${plan.audioKbps ?? 160}k`];
  const ch = plan.settings.channels;
  // "2" means "at most stereo": a mono source is left mono
  if (ch === 1) a.push('-ac', '1');
  else if (ch === 2) a.push('-ac:a', '2');
  if (plan.audio === 'aac' || plan.audio === 'mp3') a.push('-ar', '48000');
  return a;
}

export interface BuildArgsOptions {
  output: string;
  /** two-pass libx264: 1 = analysis, 2 = final */
  pass?: 1 | 2;
  passlog?: string;
  /** encode only a slice (size estimate) */
  slice?: { start: number; length: number };
}

export function buildArgs(probe: MediaProbe, plan: Plan, o: BuildArgsOptions): string[] {
  const s = plan.settings;
  const a = ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1'];
  if (o.slice) a.push('-ss', o.slice.start.toFixed(2), '-t', o.slice.length.toFixed(2));
  a.push('-i', probe.path);

  if (s.video === 'none') {
    a.push('-map', '0:a:0', '-vn', ...audioArgs({ ...plan, settings: { ...s, channels: s.channels } }));
  } else if (s.video === 'copy') {
    a.push('-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', ...audioArgs(plan));
    if (probe.vcodec === 'hevc' && s.container === 'mp4') a.push('-tag:v', 'hvc1');
  } else {
    a.push('-map', '0:v:0');
    if (o.pass !== 1) a.push('-map', '0:a:0?');
    a.push('-vf', videoFilters(plan, probe).join(','), ...encoderArgs(plan, probe));
    if (plan.tonemap) a.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    // ":v" matters: a bare -pass is also applied to the audio stream, which then fails to find its log
    if (o.pass) a.push('-pass:v', String(o.pass), '-passlogfile:v', o.passlog!);
    if (o.pass === 1) return [...a, '-an', '-f', 'null', '-'];
    a.push(...audioArgs(plan));
  }
  a.push('-sn', '-dn');
  a.push('-map_metadata', s.stripMetadata ? '-1' : '0');
  if (s.stripMetadata) a.push('-map_chapters', '-1');
  if (s.container === 'mp4') a.push('-movflags', '+faststart');
  a.push(o.output);
  return a;
}

/** "video (WhatsApp).mp4", never overwriting anything (the source included). */
export function freeOutputPath(dir: string, input: string, suffix: string, ext: string): string {
  const base = path.basename(input, path.extname(input)).slice(0, 150);
  const safe = suffix.replace(/[<>:"/\\|?*]/g, '').trim();
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${base} (${safe}${i > 1 ? ` ${i}` : ''}).${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------- running a job

export class Converter {
  state: ConvertState = { status: 'idle', progress: 0 };
  private child: ChildProcess | null = null;
  private canceled = false;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private settings: () => Settings, private emit: (s: ConvertState) => void, private finished: (s: ConvertState) => void = () => {}) {}

  get running() { return this.busy; }

  private update(patch: Partial<ConvertState>) {
    this.state = { ...this.state, ...patch };
    if (this.state.startedAt && this.state.status === 'running') this.state.elapsed = (Date.now() - this.state.startedAt) / 1000;
    this.emit(this.state);
  }

  async start(req: ConvertRequest): Promise<{ ok: boolean; error?: string }> {
    if (this.busy) return { ok: false, error: 'Já existe uma conversão em andamento.' };
    this.busy = true;
    this.canceled = false;
    try {
      const s = this.settings();
      const probe = await probeFile(s, req.input);
      const hw = await detectHardware(s);
      const plan = buildPlan(probe, req.settings, req.pref, req.gpuEnabled, hw);
      if (plan.blocked) { this.busy = false; return { ok: false, error: plan.blocked }; }
      const dir = req.outputDir || path.dirname(req.input);
      fs.mkdirSync(dir, { recursive: true });
      const output = freeOutputPath(dir, req.input, req.suffix, plan.settings.container);
      const need = plan.estimate?.max ?? probe.size;
      try {
        const st = fs.statfsSync(dir);
        if (st.bavail * st.bsize < need * 1.1) { this.busy = false; return { ok: false, error: 'Pode não haver espaço suficiente no disco de destino.' }; }
      } catch {}
      this.state = { status: 'idle', progress: 0 };
      this.update({
        status: 'running', input: req.input, output, startedAt: Date.now(), progress: 0, stage: 'Preparando…', attempt: 1,
        inputSize: probe.size, targetBytes: plan.settings.rate === 'size' ? plan.settings.targetBytes : undefined,
        usesGpu: plan.usesGpu,
        encoderLabel: plan.settings.video === 'copy' ? 'Sem recodificar (cópia)' : plan.settings.video === 'none' ? 'CPU (somente áudio)' : encoderInfo(plan.encoder!).label,
      });
      this.timer = setInterval(() => this.update({}), 1000);
      void this.execute(probe, plan, output).finally(() => {
        if (this.timer) clearInterval(this.timer);
        this.busy = false;
        this.finished(this.state);
      });
      return { ok: true };
    } catch (e: any) {
      this.busy = false;
      return { ok: false, error: e.message };
    }
  }

  private async execute(probe: MediaProbe, plan: Plan, output: string) {
    const s = this.settings();
    const ext = path.extname(output);
    const temp = output.slice(0, -ext.length) + '.convertendo' + ext;
    const passDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baixador-conv-'));
    const target = plan.settings.rate === 'size' && plan.settings.video !== 'copy' && plan.settings.video !== 'none' ? plan.settings.targetBytes! : undefined;
    let current = plan;
    try {
      for (let attempt = 1; ; attempt++) {
        const twoPass = current.encoder === 'libx264' && !!target;
        const passes: (1 | 2 | undefined)[] = twoPass ? [1, 2] : [undefined];
        for (const pass of passes) {
          const stage = plan.settings.video === 'copy' ? 'Trocando o formato' : plan.settings.video === 'none' ? 'Extraindo o áudio'
            : pass === 1 ? 'Analisando o vídeo (1ª passagem)' : 'Convertendo';
          const label = attempt > 1 ? `${stage} · tentativa ${attempt} de ${MAX_ATTEMPTS}` : stage;
          this.update({ stage: label, attempt });
          const args = buildArgs(probe, current, { output: temp, pass, passlog: path.join(passDir, 'x264') });
          const range: [number, number] = !twoPass ? [0, 100] : pass === 1 ? [0, 40] : [40, 100];
          const result = await this.ffmpeg(s.ffmpegPath, args, probe.duration, range);
          if (this.canceled) throw new Error('canceled');
          if (result.code !== 0) {
            logger.error('convert', `FFmpeg saiu com código ${result.code}\n${result.stderr}`);
            this.update({
              status: 'error', canRetryCpu: current.usesGpu, errorDetail: result.stderr,
              error: current.usesGpu ? 'A codificação pela GPU NVIDIA falhou. Você pode tentar de novo usando a CPU.' : friendlyFfmpegError(result.stderr),
              eta: undefined, speed: undefined,
            });
            return;
          }
        }
        // FFmpeg can exit successfully after reading only part of a damaged file
        const check = await probeFile(s, temp).catch(() => null);
        if (!check || (probe.duration && check.duration && check.duration < probe.duration * 0.95 - 1)) {
          logger.error('convert', `Saída incompleta: ${check?.duration?.toFixed(1) ?? '?'} s de ${probe.duration?.toFixed(1)} s`);
          this.update({ status: 'error', error: 'O arquivo de entrada parece estar corrompido: só uma parte dele pôde ser lida. Nenhum arquivo foi salvo.', eta: undefined });
          return;
        }
        const size = fs.statSync(temp).size;
        if (target && size > target && attempt < MAX_ATTEMPTS) {
          const next = retryKbps(current.videoKbps!, size, target);
          if (next) {
            logger.warn('convert', `Saída com ${(size / MB).toFixed(1)} MB, acima de ${(target / MB).toFixed(0)} MB. Nova tentativa com ${next} kbps (antes ${current.videoKbps}).`);
            current = { ...current, videoKbps: next };
            continue;
          }
        }
        fs.renameSync(temp, output);
        const over = !!target && size > target;
        logger.info('convert', `Concluído: ${path.basename(output)} · ${(size / MB).toFixed(1)} MB (original ${(probe.size / MB).toFixed(1)} MB) · ${((Date.now() - this.state.startedAt!) / 1000).toFixed(1)} s${over ? ' · ACIMA DO LIMITE' : ''}`);
        this.update({ status: 'done', progress: 100, outputSize: size, overLimit: over, stage: undefined, eta: undefined, elapsed: (Date.now() - this.state.startedAt!) / 1000 });
        return;
      }
    } catch (e: any) {
      if (this.canceled) this.update({ status: 'canceled', stage: undefined, eta: undefined, speed: undefined });
      else {
        logger.error('convert', e.stack || e.message);
        this.update({ status: 'error', error: 'Não foi possível salvar o arquivo convertido.', errorDetail: e.message });
      }
    } finally {
      // only files this job created are removed; the source is never touched
      try { fs.rmSync(temp, { force: true }); } catch {}
      try { fs.rmSync(passDir, { recursive: true, force: true }); } catch {}
    }
  }

  private ffmpeg(exe: string, args: string[], duration: number | undefined, [from, to]: [number, number]): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
      logger.info('convert', `ffmpeg ${args.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`);
      const child = spawn(exe, args, { windowsHide: true });
      this.child = child;
      let stderr = '';
      let buf = '';
      let last = 0;
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        let time: number | undefined, speed: number | undefined;
        for (const line of lines) {
          const [k, v] = line.split('=');
          if (k === 'out_time_us' && Number(v) > 0) time = Number(v) / 1e6;
          if (k === 'speed') speed = parseFloat(v) || undefined;
        }
        if (time !== undefined && duration && Date.now() - last > 250) {
          last = Date.now();
          const frac = Math.min(1, time / duration);
          const remaining = speed ? Math.max(0, duration - time) / speed : undefined;
          // during the first of two passes the remaining time of the second one is still unknown
          this.update({ progress: Math.min(99.5, from + frac * (to - from)), speed, eta: to < 100 ? undefined : remaining });
        }
      });
      child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-6000); });
      child.on('error', (e) => resolve({ code: 1, stderr: e.message }));
      child.on('close', (code) => { this.child = null; resolve({ code: code ?? 1, stderr: stderr.trim() }); });
    });
  }

  async cancel() {
    if (!this.busy) return;
    this.canceled = true;
    await killTree(this.child);
  }

  /** Size estimate for quality mode: encodes three short samples with the real settings and extrapolates. */
  async estimate(input: string, settings: ConvertSettings, pref: EncoderPref, gpuEnabled: boolean): Promise<{ min: number; max: number } | { error: string }> {
    if (this.busy) return { error: 'Aguarde a conversão terminar.' };
    this.busy = true;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baixador-est-'));
    try {
      const s = this.settings();
      const probe = await probeFile(s, input);
      const plan = buildPlan(probe, settings, pref, gpuEnabled, await detectHardware(s));
      if (plan.blocked) return { error: plan.blocked };
      if (!probe.duration || probe.duration < 12) return { error: 'Vídeo curto demais para estimar por amostras.' };
      const length = 3;
      const rates: number[] = [];
      for (const [i, at] of [0.15, 0.5, 0.82].entries()) {
        const out = path.join(dir, `s${i}.${plan.settings.container}`);
        const r = await run(s.ffmpegPath, buildArgs(probe, plan, { output: out, slice: { start: probe.duration * at, length } }).filter((x) => x !== '-nostats'), 180_000);
        if (r.code !== 0) return { error: 'Não foi possível gerar a amostra.' };
        rates.push(fs.statSync(out).size / length);
      }
      const mean = (rates.reduce((x, y) => x + y, 0) / rates.length) * probe.duration;
      return { min: mean * 0.75, max: mean * 1.3 };
    } catch (e: any) {
      return { error: e.message };
    } finally {
      this.busy = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}

export function friendlyFfmpegError(stderr: string): string {
  if (/No space left|not enough space/i.test(stderr)) return 'Sem espaço em disco.';
  if (/Permission denied|Access is denied/i.test(stderr)) return 'Sem permissão para gravar na pasta de destino.';
  if (/Invalid data found|moov atom not found|error while decoding|corrupt/i.test(stderr)) return 'O arquivo de entrada parece estar corrompido.';
  return 'A conversão falhou. Veja os detalhes em Diagnóstico.';
}
