// Converter rules shared by the UI and the main process: presets, codec/container compatibility,
// size-target bitrate math and the "plan" (what will actually be produced). Pure functions only.

export type Container = 'mp4' | 'mkv' | 'webm' | 'mp3';
export type VideoCodec = 'h264' | 'hevc' | 'av1' | 'vp9';
export type AudioCodec = 'aac' | 'mp3' | 'opus';
export type EncoderId = 'libx264' | 'h264_nvenc' | 'libx265' | 'hevc_nvenc' | 'libsvtav1' | 'av1_nvenc' | 'libvpx-vp9';
/** auto = GPU only if the user enabled it and the NVENC test passed */
export type EncoderPref = 'auto' | 'gpu' | 'cpu';

export interface MediaProbe {
  path: string;
  name: string;
  size: number;
  duration?: number;
  /** display size (rotation already applied) */
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  pixFmt?: string;
  videoKbps?: number;
  totalKbps?: number;
  acodec?: string;
  audioKbps?: number;
  channels?: number;
  hdr: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface EncoderStatus {
  id: EncoderId;
  label: string;
  /** present in `ffmpeg -encoders` */
  listed: boolean;
  /** a short real encode succeeded */
  works: boolean;
  error?: string;
}

export interface Hardware {
  testedAt: number;
  ffmpegPath: string;
  encoders: EncoderStatus[];
  /** zscale + tonemap filters available (needed to convert HDR properly) */
  canTonemap: boolean;
}

export const ENCODERS: { id: EncoderId; codec: VideoCodec; gpu: boolean; label: string }[] = [
  { id: 'h264_nvenc', codec: 'h264', gpu: true, label: 'NVIDIA NVENC (H.264)' },
  { id: 'hevc_nvenc', codec: 'hevc', gpu: true, label: 'NVIDIA NVENC (H.265)' },
  { id: 'av1_nvenc', codec: 'av1', gpu: true, label: 'NVIDIA NVENC (AV1)' },
  { id: 'libx264', codec: 'h264', gpu: false, label: 'CPU H.264 (libx264)' },
  { id: 'libx265', codec: 'hevc', gpu: false, label: 'CPU H.265 (libx265)' },
  { id: 'libsvtav1', codec: 'av1', gpu: false, label: 'CPU AV1 (SVT-AV1)' },
  { id: 'libvpx-vp9', codec: 'vp9', gpu: false, label: 'CPU VP9 (libvpx)' },
];
export const encoderInfo = (id: EncoderId) => ENCODERS.find((e) => e.id === id)!;

/** The single source of truth for what may go into each container. */
export const COMPAT: Record<Container, { video: VideoCodec[]; audio: AudioCodec[]; label: string }> = {
  mp4: { video: ['h264', 'hevc', 'av1'], audio: ['aac', 'mp3'], label: 'MP4' },
  mkv: { video: ['h264', 'hevc', 'av1', 'vp9'], audio: ['aac', 'mp3', 'opus'], label: 'MKV' },
  webm: { video: ['vp9', 'av1'], audio: ['opus'], label: 'WebM' },
  mp3: { video: [], audio: ['mp3'], label: 'MP3 (só áudio)' },
};
export const AUDIO_BITRATES: Record<AudioCodec, number[]> = {
  aac: [64, 96, 128, 160, 192, 256, 320],
  mp3: [64, 96, 128, 160, 192, 256, 320],
  opus: [64, 96, 128, 160, 192, 256],
};
export const CODEC_LABEL: Record<VideoCodec, string> = { h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9' };

export interface ConvertSettings {
  container: Container;
  /** 'copy' = remux without re-encoding; 'none' = audio only */
  video: VideoCodec | 'copy' | 'none';
  /** limit on the shorter side ("1080p"); portrait videos work the same way */
  shortSide: number | 'original';
  /** custom bounding box; overrides shortSide */
  custom?: { width: number; height: number };
  keepAspect: boolean;
  allowUpscale: boolean;
  fps: number | 'original';
  allowFpsIncrease: boolean;
  rate: 'quality' | 'size' | 'bitrate';
  /** 0..100, higher = better picture and larger file */
  quality: number;
  videoKbps?: number;
  targetBytes?: number;
  /** pick a lower resolution automatically when the size target needs it */
  autoResolution?: boolean;
  /** never spend more than this fraction of the source video bitrate (quality mode) */
  sourceCap?: number;
  audio: AudioCodec | 'copy' | 'none';
  audioKbps: number;
  channels: 'original' | 1 | 2;
  stripMetadata: boolean;
  /** conservative H.264 profile/level for old devices */
  legacyProfile?: boolean;
}

export const DEFAULT_SETTINGS: ConvertSettings = {
  container: 'mp4',
  video: 'h264',
  shortSide: 'original',
  keepAspect: true,
  allowUpscale: false,
  fps: 'original',
  allowFpsIncrease: false,
  rate: 'quality',
  quality: 65,
  audio: 'aac',
  audioKbps: 160,
  channels: 'original',
  stripMetadata: false,
};

/** 180 "MB" is treated as 180,000,000 bytes: under the limit whichever definition of MB the other app uses. */
export const MB = 1_000_000;
export const WHATSAPP_LIMIT = 180 * MB;

export interface Preset {
  id: string;
  group: 'Compartilhar' | 'Compatibilidade' | 'Qualidade' | 'Resolução e FPS' | 'Outras ferramentas';
  name: string;
  description: string;
  /** suffix for the output file name */
  suffix: string;
  settings: Partial<ConvertSettings>;
  /** the UI lets the user type a size limit */
  sizeLimit?: 'required' | 'optional';
}

const res = (id: string, name: string, shortSide: number, fps: number, description: string): Preset => ({
  id, group: 'Resolução e FPS', name, description, suffix: name.replace(' FPS', 'fps'),
  settings: { shortSide, fps },
});

export const PRESETS: Preset[] = [
  {
    id: 'whatsapp', group: 'Compartilhar', name: 'WhatsApp — até 180 MB', suffix: 'WhatsApp', sizeLimit: 'required',
    description: 'MP4 que roda em celulares. Ajusta o bitrate para ficar abaixo de 180 MB.',
    settings: { rate: 'size', targetBytes: WHATSAPP_LIMIT, autoResolution: true, fps: 60, audioKbps: 128, channels: 2, stripMetadata: true },
  },
  {
    id: 'discord', group: 'Compartilhar', name: 'Discord', suffix: 'Discord', sizeLimit: 'optional',
    description: 'Arquivo reduzido em até 1080p. Informe o limite do seu servidor, se quiser um tamanho máximo.',
    settings: { shortSide: 1080, fps: 60, quality: 45, sourceCap: 0.8, autoResolution: true, audioKbps: 128, channels: 2, stripMetadata: true },
  },
  {
    id: 'social', group: 'Compartilhar', name: 'Redes sociais', suffix: 'Social',
    description: 'MP4 compatível, até 1080p e 60 FPS. Não segue regras específicas de nenhuma plataforma.',
    settings: { shortSide: 1080, fps: 60, quality: 65, audioKbps: 160, channels: 2, stripMetadata: true },
  },
  {
    id: 'universal', group: 'Compatibilidade', name: 'MP4 universal', suffix: 'MP4',
    description: 'H.264 + AAC, mantendo resolução e FPS. Para celulares, TVs e navegadores atuais.',
    settings: { quality: 65 },
  },
  {
    id: 'legacy', group: 'Compatibilidade', name: 'Alta compatibilidade', suffix: 'Compativel',
    description: 'Até 720p e 30 FPS, perfil H.264 conservador. Para aparelhos antigos.',
    settings: { shortSide: 720, fps: 30, quality: 65, audioKbps: 128, channels: 2, legacyProfile: true },
  },
  { id: 'balanced', group: 'Qualidade', name: 'Equilibrado', suffix: 'Equilibrado', description: 'Boa imagem em um tamanho razoável. Recomendado.', settings: { quality: 65 } },
  { id: 'high', group: 'Qualidade', name: 'Alta qualidade', suffix: 'Alta qualidade', description: 'Prioriza a imagem. O arquivo fica maior, às vezes maior que o original.', settings: { quality: 85, audioKbps: 256 } },
  { id: 'small', group: 'Qualidade', name: 'Arquivo menor', suffix: 'Menor', description: 'Reduz o tamanho mantendo a resolução. Há perda visível em cenas difíceis.', settings: { quality: 40, sourceCap: 0.65, audioKbps: 128 } },
  { id: 'orig', group: 'Resolução e FPS', name: 'Original', suffix: 'Convertido', description: 'Mantém a resolução e o FPS do vídeo.', settings: {} },
  res('2160p60', '2160p 60 FPS', 2160, 60, '4K. Só reduz ou mantém, nunca amplia.'),
  res('1440p60', '1440p 60 FPS', 1440, 60, 'Quad HD, até 60 FPS.'),
  res('1080p60', '1080p 60 FPS', 1080, 60, 'Full HD, até 60 FPS.'),
  res('1080p30', '1080p 30 FPS', 1080, 30, 'Full HD, até 30 FPS.'),
  res('1080p24', '1080p 24 FPS', 1080, 24, 'Full HD, até 24 FPS.'),
  res('720p60', '720p 60 FPS', 720, 60, 'HD, até 60 FPS.'),
  res('720p30', '720p 30 FPS', 720, 30, 'HD, até 30 FPS.'),
  res('720p24', '720p 24 FPS', 720, 24, 'HD, até 24 FPS.'),
  res('480p30', '480p 30 FPS', 480, 30, 'Leve, para arquivos pequenos.'),
  { id: 'remux', group: 'Outras ferramentas', name: 'Trocar formato (rápido)', suffix: 'Remux', description: 'Muda para MP4 sem recodificar. Instantâneo e sem perda, quando os codecs permitem.', settings: { video: 'copy', audio: 'copy' } },
  { id: 'mp3', group: 'Outras ferramentas', name: 'Extrair áudio MP3', suffix: 'Audio', description: 'Salva só o áudio em MP3.', settings: { container: 'mp3', video: 'none', audio: 'mp3', audioKbps: 192 } },
  { id: 'webm', group: 'Outras ferramentas', name: 'WebM', suffix: 'WebM', description: 'VP9 + Opus, para sites. A conversão é mais lenta.', settings: { container: 'webm', video: 'vp9', audio: 'opus', audioKbps: 128, quality: 60 } },
];

export function presetSettings(id: string): ConvertSettings {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS.find((x) => x.id === 'balanced')!;
  return { ...DEFAULT_SETTINGS, ...p.settings };
}

// ---------------------------------------------------------------- compatibility

const SOURCE_VIDEO: Record<string, VideoCodec> = { h264: 'h264', hevc: 'hevc', av1: 'av1', vp9: 'vp9' };
const SOURCE_AUDIO: Record<string, AudioCodec> = { aac: 'aac', mp3: 'mp3', opus: 'opus' };

export const canCopyVideo = (p: MediaProbe, c: Container) => !!p.vcodec && !!SOURCE_VIDEO[p.vcodec] && COMPAT[c].video.includes(SOURCE_VIDEO[p.vcodec]);
export const canCopyAudio = (p: MediaProbe, c: Container) => !!p.acodec && !!SOURCE_AUDIO[p.acodec] && COMPAT[c].audio.includes(SOURCE_AUDIO[p.acodec]);

// ---------------------------------------------------------------- size math

/** Part of the target that is left unused: container overhead plus encoder inaccuracy. */
export const SIZE_MARGIN = 0.05;
/** bits per pixel per frame (H.264 reference): below COMFORT we try a smaller picture; below FLOOR we refuse. */
const BPP_COMFORT = 0.05;
const BPP_FLOOR = 0.022;
const MIN_VIDEO_KBPS = 90;
const EFFICIENCY: Record<VideoCodec, number> = { h264: 1, hevc: 0.7, vp9: 0.75, av1: 0.62 };

export interface SizeBudget {
  totalKbps: number;
  audioKbps: number;
  videoKbps: number;
}

export function sizeBudget(targetBytes: number, duration: number, audioKbps: number): SizeBudget {
  const totalKbps = (targetBytes * (1 - SIZE_MARGIN) * 8) / duration / 1000;
  let a = audioKbps;
  // long videos: audio must not eat the budget
  while (a > 64 && a > totalKbps * 0.2) a = a > 128 ? 128 : a > 96 ? 96 : 64;
  return { totalKbps, audioKbps: a, videoKbps: Math.floor(totalKbps - a) };
}

/** A bitrate above this brings no visible gain, so short videos don't get inflated up to the size limit. */
export function usefulKbps(width: number, height: number, fps: number, codec: VideoCodec): number {
  return Math.round(((width * height * Math.min(fps, 60) * 0.14) / 1000) * EFFICIENCY[codec]);
}

const bpp = (kbps: number, w: number, h: number, fps: number, codec: VideoCodec) => (kbps * 1000) / (w * h * fps) / EFFICIENCY[codec];

// ---------------------------------------------------------------- plan

export interface Plan {
  settings: ConvertSettings;
  encoder?: EncoderId;
  usesGpu: boolean;
  width?: number;
  height?: number;
  /** true when the picture is resized */
  scaled: boolean;
  fps?: number;
  /** only set when the frame rate really changes */
  fpsFilter?: number;
  videoKbps?: number;
  audioKbps?: number;
  audio: AudioCodec | 'copy' | 'none';
  /** known estimate in bytes (size and bitrate modes) */
  estimate?: { min: number; max: number };
  tonemap: boolean;
  notes: string[];
  /** the conversion can't be done as asked */
  blocked?: string;
  /** one-click ways out of `blocked` */
  suggestions?: { label: string; patch: Partial<ConvertSettings> }[];
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function fit(p: { width: number; height: number }, s: ConvertSettings, shortSide: number | 'original'): { width: number; height: number } {
  const { width: w, height: h } = p;
  if (s.custom) {
    let W = s.custom.width, H = s.custom.height;
    if (!s.allowUpscale) { W = Math.min(W, w); H = Math.min(H, h); }
    if (!s.keepAspect) return { width: even(W), height: even(H) };
    const k = Math.min(W / w, H / h);
    return { width: even(w * k), height: even(h * k) };
  }
  const short = Math.min(w, h);
  if (shortSide === 'original' || (shortSide >= short && !s.allowUpscale)) return { width: even(w), height: even(h) };
  const k = shortSide / short;
  return { width: even(w * k), height: even(h * k) };
}

export function chooseEncoder(codec: VideoCodec, pref: EncoderPref, gpuEnabled: boolean, hw?: Hardware | null): { id?: EncoderId; usesGpu: boolean; note?: string } {
  const works = (id: EncoderId) => !!hw?.encoders.find((e) => e.id === id)?.works;
  const gpu = ENCODERS.find((e) => e.codec === codec && e.gpu);
  const cpu = ENCODERS.find((e) => e.codec === codec && !e.gpu);
  const wantGpu = pref === 'gpu' || (pref === 'auto' && gpuEnabled);
  if (wantGpu && gpu && works(gpu.id)) return { id: gpu.id, usesGpu: true };
  if (cpu && works(cpu.id)) {
    return { id: cpu.id, usesGpu: false, note: wantGpu ? 'A GPU não está disponível para este formato. Será usada a CPU.' : undefined };
  }
  return { usesGpu: false, note: undefined };
}

export function buildPlan(probe: MediaProbe, input: ConvertSettings, pref: EncoderPref, gpuEnabled: boolean, hw?: Hardware | null): Plan {
  const s: ConvertSettings = { ...input };
  const plan: Plan = { settings: s, usesGpu: false, scaled: false, tonemap: false, notes: [], audio: s.audio };
  const block = (msg: string) => { plan.blocked ??= msg; return plan; };

  // ---- audio
  if (!probe.hasAudio) {
    plan.audio = 'none';
    if (s.video === 'none') return block('Este arquivo não tem áudio para extrair.');
    if (s.audio !== 'none') plan.notes.push('O vídeo não tem áudio.');
  } else if (s.audio === 'copy') {
    if (!canCopyAudio(probe, s.container)) {
      const fallback = COMPAT[s.container].audio[0];
      plan.audio = fallback;
      plan.notes.push(`O áudio ${probe.acodec?.toUpperCase()} não cabe em ${COMPAT[s.container].label} sem conversão; será convertido para ${fallback.toUpperCase()}.`);
      plan.audioKbps = s.audioKbps;
    } else plan.audioKbps = probe.audioKbps;
  } else if (s.audio !== 'none') {
    if (!COMPAT[s.container].audio.includes(s.audio)) return block(`${COMPAT[s.container].label} não aceita áudio ${s.audio.toUpperCase()}.`);
    plan.audioKbps = s.audioKbps;
  }

  // ---- audio-only output
  if (s.video === 'none') {
    if (s.container !== 'mp3') return block('A saída somente com áudio disponível é MP3.');
    if (probe.duration && plan.audioKbps) {
      const bytes = (plan.audioKbps * 1000 * probe.duration) / 8;
      plan.estimate = { min: bytes * 0.97, max: bytes * 1.05 };
    }
    return plan;
  }
  if (!probe.hasVideo || !probe.width || !probe.height) return block('Não encontrei uma faixa de vídeo neste arquivo.');
  if (s.container === 'mp3') return block('MP3 guarda apenas áudio. Escolha MP4, MKV ou WebM.');

  // ---- stream copy
  if (s.video === 'copy') {
    if (!canCopyVideo(probe, s.container)) {
      return block(`O vídeo ${(probe.vcodec ?? 'desconhecido').toUpperCase()} não pode ir para ${COMPAT[s.container].label} sem recodificar. Use "MP4 universal" ou escolha MKV no modo Personalizado.`);
    }
    plan.width = probe.width; plan.height = probe.height; plan.fps = probe.fps;
    plan.estimate = { min: probe.size * 0.95, max: probe.size * 1.02 };
    return plan;
  }

  const codec = s.video;
  if (!COMPAT[s.container].video.includes(codec)) return block(`${COMPAT[s.container].label} não aceita vídeo ${CODEC_LABEL[codec]}.`);

  // ---- frame rate
  plan.fps = probe.fps;
  if (s.fps !== 'original') {
    if (!probe.fps || s.fps < probe.fps - 0.5) { plan.fps = s.fps; plan.fpsFilter = s.fps; }
    else if (s.fps > probe.fps + 0.5) {
      if (s.allowFpsIncrease) { plan.fps = s.fps; plan.fpsFilter = s.fps; plan.notes.push('Aumentar o FPS apenas repete quadros; não deixa o movimento mais fluido.'); }
      else plan.notes.push(`O vídeo tem ${Math.round(probe.fps)} FPS; o FPS original será mantido.`);
    }
  }

  // ---- resolution
  const src = { width: probe.width, height: probe.height };
  let size = fit(src, s, s.shortSide);
  const short = Math.min(src.width, src.height);
  if (!s.custom && s.shortSide !== 'original' && s.shortSide > short && !s.allowUpscale) {
    plan.notes.push(`O vídeo tem ${short}p; a resolução não será aumentada para ${s.shortSide}p.`);
  }

  // ---- encoder
  const enc = chooseEncoder(codec, pref, gpuEnabled, hw);
  plan.encoder = enc.id; plan.usesGpu = enc.usesGpu;
  if (enc.note) plan.notes.push(enc.note);
  if (hw && !enc.id) return block(`Nenhum encoder ${CODEC_LABEL[codec]} funcionou neste computador.`);

  if (probe.hdr) {
    plan.tonemap = hw?.canTonemap ?? true;
    plan.notes.push(plan.tonemap ? 'Vídeo HDR: as cores serão convertidas para SDR. O resultado pode ficar um pouco diferente do original.' : 'Vídeo HDR: este FFmpeg não consegue converter as cores; a imagem pode ficar lavada.');
  }

  const frameRate = plan.fps ?? 30;

  // ---- bitrate
  if (s.rate === 'size') {
    const target = s.targetBytes ?? 0;
    if (target < MB) return block('Informe um tamanho máximo de pelo menos 1 MB.');
    if (!probe.duration) return block('Não foi possível ler a duração deste vídeo, então não dá para calcular um tamanho máximo. Escolha um preset de qualidade.');
    const budget = sizeBudget(target, probe.duration, plan.audio === 'none' ? 0 : s.audioKbps);
    if (plan.audio !== 'none') { plan.audioKbps = budget.audioKbps; if (plan.audio === 'copy') plan.audio = 'aac'; }
    const sourceKbps = probe.videoKbps ?? probe.totalKbps;

    if (s.autoResolution && !s.custom) {
      // largest picture (never above the requested one) that still gets a comfortable number of bits per pixel
      const start = Math.min(size.width, size.height);
      const ladder = [start, 1440, 1080, 720, 540, 480, 360].filter((v, i) => i === 0 || v < start);
      let chosen = ladder[ladder.length - 1];
      for (const v of ladder) {
        const c = fit(src, s, v === short ? 'original' : v);
        // enough bits, or already as many as the source had: no reason to shrink
        if (bpp(budget.videoKbps, c.width, c.height, frameRate, codec) >= BPP_COMFORT || (sourceKbps && budget.videoKbps >= sourceKbps)) { chosen = v; break; }
      }
      const next = fit(src, s, chosen === short ? 'original' : chosen);
      if (next.width !== size.width) plan.notes.push(`Resolução reduzida para ${Math.min(next.width, next.height)}p para manter a qualidade dentro do limite.`);
      size = next;
    }

    const tooLow = budget.videoKbps < MIN_VIDEO_KBPS || (bpp(budget.videoKbps, size.width, size.height, frameRate, codec) < BPP_FLOOR && !(sourceKbps && budget.videoKbps >= sourceKbps));
    // no point in spending more than the source or than what the picture can use
    const ceiling = Math.min(usefulKbps(size.width, size.height, frameRate, codec), sourceKbps ? Math.max(MIN_VIDEO_KBPS, Math.round(sourceKbps * (codec === 'h264' && probe.vcodec !== 'h264' ? 1.5 : 1.1))) : Infinity);
    plan.videoKbps = Math.min(budget.videoKbps, ceiling);
    if (plan.videoKbps < budget.videoKbps) plan.notes.push('O vídeo é curto ou leve: o arquivo deve ficar bem abaixo do limite, sem aumentar o tamanho à toa.');
    if (tooLow) {
      const needed = Math.ceil((((BPP_FLOOR * 1.15 * size.width * size.height * frameRate * EFFICIENCY[codec]) / 1000 + budget.audioKbps) * 1000 * probe.duration) / 8 / (1 - SIZE_MARGIN) / MB);
      plan.suggestions = [];
      if (Math.min(size.width, size.height) > 360) plan.suggestions.push({ label: 'Usar 360p e 30 FPS', patch: { shortSide: 360, fps: 30, autoResolution: false } });
      plan.suggestions.push({ label: `Aceitar até ${needed} MB`, patch: { targetBytes: needed * MB } });
      block(`Para caber em ${Math.round(target / MB)} MB, a qualidade ficaria muito ruim (vídeo longo demais para esse limite).`);
    }
  } else if (s.rate === 'bitrate') {
    if (!s.videoKbps || s.videoKbps < 50 || s.videoKbps > 200_000) return block('Informe um bitrate de vídeo entre 50 e 200000 kbps.');
    plan.videoKbps = s.videoKbps;
  }

  plan.width = size.width;
  plan.height = size.height;
  plan.scaled = size.width !== src.width || size.height !== src.height;

  if (plan.videoKbps && probe.duration) {
    const bytes = ((plan.videoKbps + (plan.audio === 'none' ? 0 : plan.audioKbps ?? 128)) * 1000 * probe.duration) / 8;
    const cap = s.rate === 'size' ? s.targetBytes! : Infinity;
    plan.estimate = { min: Math.min(bytes * 0.88, cap), max: Math.min(bytes * 1.06, cap) };
  }
  return plan;
}

/** Bitrate for another attempt after the output came out above the limit. */
export function retryKbps(previousKbps: number, producedBytes: number, targetBytes: number): number | null {
  const next = Math.floor(previousKbps * (targetBytes / producedBytes) * 0.93);
  return next >= MIN_VIDEO_KBPS ? next : null;
}
export const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------- job state

export interface ConvertRequest {
  input: string;
  settings: ConvertSettings;
  pref: EncoderPref;
  gpuEnabled: boolean;
  outputDir?: string;
  /** appended to the output file name: "video (suffix).mp4" */
  suffix: string;
}

export interface ConvertState {
  status: 'idle' | 'running' | 'done' | 'error' | 'canceled';
  input?: string;
  output?: string;
  encoderLabel?: string;
  usesGpu?: boolean;
  stage?: string;
  progress: number;
  startedAt?: number;
  elapsed?: number;
  eta?: number;
  speed?: number;
  attempt?: number;
  inputSize?: number;
  outputSize?: number;
  targetBytes?: number;
  overLimit?: boolean;
  error?: string;
  errorDetail?: string;
  /** the GPU encode failed; the UI may offer a CPU retry (never automatic) */
  canRetryCpu?: boolean;
}
