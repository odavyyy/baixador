import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Cpu, FileVideo, FolderOpen, Loader2, RotateCcw, Upload, X, Zap } from 'lucide-react';
import {
  AUDIO_BITRATES, buildPlan, CODEC_LABEL, COMPAT, MB, PRESETS, presetSettings,
  type AudioCodec, type Container, type ConvertSettings, type ConvertState, type EncoderPref, type Hardware, type MediaProbe, type Plan, type VideoCodec,
} from '@shared/convert';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, PageHeader, Progress, Segmented, Select, Toggle, cx } from '../components/ui';
import { dirname, duration, eta } from '../lib/format';

const GROUPS = ['Compartilhar', 'Qualidade', 'Compatibilidade', 'Resolução e FPS', 'Outras ferramentas'] as const;
const mbText = (n?: number) => (n ? `${(n / MB).toLocaleString('pt-BR', { maximumFractionDigits: n < 10 * MB ? 1 : 0 })} MB` : '—');
const fpsText = (n?: number) => (n ? `${Math.round(n * 100) / 100} FPS`.replace('.', ',') : '');

export function ConverterPage() {
  const { settings, updateSettings, convert, conv, setConv, tools, go, toast } = useStore();
  const [hw, setHw] = useState<Hardware | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [hwError, setHwError] = useState('');
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const gpuEnabled = !!settings?.useGpu;
  const running = convert.status === 'running';

  const detect = async (force: boolean) => {
    setDetecting(true);
    setHwError('');
    const r = await api.detectHardware(force);
    setDetecting(false);
    if (r.ok) {
      setHw(r.hardware);
      if (force) {
        const nv = r.hardware.encoders.find((e) => e.id === 'h264_nvenc');
        toast(nv?.works ? { kind: 'ok', title: 'Aceleração NVIDIA disponível', msg: 'O teste de codificação funcionou.' } : { kind: 'info', title: 'Aceleração NVIDIA indisponível', msg: 'A conversão usará a CPU.' });
      }
    } else setHwError(r.error);
  };
  useEffect(() => { if (tools?.ffmpeg.ok) void detect(false); }, [tools?.ffmpeg.ok, settings?.ffmpegPath]);

  const load = async (path: string) => {
    if (!path || running) return;
    setReading(true);
    setReadError('');
    const r = await api.probeVideo(path);
    setReading(false);
    if (r.ok) setConv((c) => ({ ...c, probe: r.probe, custom: null }));
    else { setReadError(r.error); setConv((c) => ({ ...c, probe: undefined })); }
  };

  const pick = async () => { const p = await api.pickVideo(); if (p) void load(p); };

  if (!settings) return null;
  const { probe } = conv;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void load(api.pathForFile(f));
      }}
      className="min-h-[70vh]"
    >
      <PageHeader title="Conversor" subtitle="Converta e reduza vídeos do seu computador. Tudo é processado aqui, com o seu FFmpeg." />
      <input ref={fileInput} data-testid="video-input" type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(api.pathForFile(f)); e.target.value = ''; }} />

      {tools && !tools.ffmpeg.ok && (
        <Card className="mb-4 flex items-center gap-3 border-warn/30 bg-warn/10 p-4 text-[13.5px]">
          <AlertCircle size={18} className="text-warn" />
          <span className="flex-1">O FFmpeg não foi encontrado. O conversor usa o FFmpeg instalado no seu computador.</span>
          <Button size="sm" onClick={() => go('settings')}>Configurar</Button>
        </Card>
      )}

      {convert.status !== 'idle' && <JobPanel state={convert} onRetryCpu={conv.retryCpu} />}

      {!probe ? (
        <button
          onClick={pick}
          disabled={reading || !tools?.ffmpeg.ok}
          className={cx('focus-ring flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors disabled:opacity-60', dragging ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60 hover:bg-card')}
        >
          {reading ? <Loader2 size={28} className="animate-spin text-accent" /> : <Upload size={28} className="text-accent" />}
          <span className="mt-4 text-[16px] font-semibold">{reading ? 'Lendo o vídeo…' : 'Arraste um vídeo para cá'}</span>
          <span className="mt-1 text-[13.5px] text-muted">ou clique para escolher um arquivo</span>
        </button>
      ) : (
        <Editor probe={probe} hw={hw} gpuEnabled={gpuEnabled} onChangeFile={pick} dragging={dragging} />
      )}
      {readError && <Card className="mt-3 flex items-center gap-3 border-bad/30 bg-bad/[.06] p-3.5 text-[13.5px]"><AlertCircle size={17} className="text-bad" />{readError}</Card>}

      <HardwarePanel hw={hw} detecting={detecting} error={hwError} onDetect={() => detect(true)} enabled={gpuEnabled} onEnable={(v) => updateSettings({ useGpu: v })} disabled={!tools?.ffmpeg.ok} />
    </div>
  );
}

// ---------------------------------------------------------------- editor

function Editor({ probe, hw, gpuEnabled, onChangeFile, dragging }: { probe: MediaProbe; hw: Hardware | null; gpuEnabled: boolean; onChangeFile: () => void; dragging: boolean }) {
  const { settings, convert, conv, setConv, startConvert, toast } = useStore();
  const preset = PRESETS.find((p) => p.id === conv.presetId) ?? PRESETS[0];
  const custom = conv.custom;
  const [estimate, setEstimate] = useState<{ min: number; max: number } | string | null>(null);
  const [estimating, setEstimating] = useState(false);

  const effective: ConvertSettings = useMemo(() => {
    if (conv.mode === 'custom') return custom ?? presetSettings('balanced');
    const s = { ...presetSettings(conv.presetId), ...conv.overrides };
    if (preset.sizeLimit && conv.limitMB !== undefined) {
      if (conv.limitMB > 0) Object.assign(s, { rate: 'size', targetBytes: conv.limitMB * MB, autoResolution: true });
      else if (preset.sizeLimit === 'optional') s.rate = 'quality';
      else s.targetBytes = 0;
    }
    return s;
  }, [conv.mode, conv.presetId, conv.overrides, conv.limitMB, custom, preset.sizeLimit]);

  const plan: Plan = useMemo(() => buildPlan(probe, effective, conv.encoder, gpuEnabled, hw), [probe, effective, conv.encoder, gpuEnabled, hw]);
  useEffect(() => setEstimate(null), [probe, effective, conv.encoder, gpuEnabled]);

  const outDir = conv.outputDir || dirname(probe.path);
  const running = convert.status === 'running';

  const doEstimate = async () => {
    setEstimating(true);
    const r = await api.estimateConversion(probe.path, effective, conv.encoder, gpuEnabled);
    setEstimating(false);
    setEstimate('error' in r ? r.error : r);
  };

  const start = async (pref: EncoderPref = conv.encoder) => {
    const r = await startConvert({ input: probe.path, settings: effective, pref, gpuEnabled, outputDir: conv.outputDir, suffix: conv.mode === 'custom' ? 'Personalizado' : preset.suffix });
    if (!r.ok) toast({ kind: 'error', title: 'Não foi possível iniciar', msg: r.error });
  };

  const limitValue = conv.limitMB ?? (preset.id === 'whatsapp' ? 180 : 0);

  return (
    <div className="space-y-4 animate-in">
      <Card className={cx('flex items-center gap-4 p-4', dragging && 'border-accent bg-accent/10')}>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-elev text-accent"><FileVideo size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="selectable truncate text-[14.5px] font-semibold" title={probe.path}>{probe.name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="accent">{mbText(probe.size)}</Badge>
            {probe.width ? <Badge>{probe.width}×{probe.height}</Badge> : null}
            {probe.fps ? <Badge>{fpsText(probe.fps)}</Badge> : null}
            {probe.duration ? <Badge>{duration(probe.duration)}</Badge> : <Badge tone="warn">duração desconhecida</Badge>}
            {probe.vcodec ? <Badge>{probe.vcodec.toUpperCase()}{probe.acodec ? ` + ${probe.acodec.toUpperCase()}` : ' · sem áudio'}</Badge> : null}
            {probe.totalKbps ? <Badge>{(probe.totalKbps / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Mbps</Badge> : null}
            {probe.hdr && <Badge tone="warn">HDR</Badge>}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onChangeFile} disabled={running}>Trocar arquivo</Button>
      </Card>

      <Card className="p-5">
        <Segmented<'simple' | 'custom'>
          value={conv.mode}
          onChange={(mode) => setConv((c) => ({ ...c, mode, custom: mode === 'custom' ? c.custom ?? { ...presetSettings(c.presetId), ...c.overrides } : c.custom }))}
          options={[{ value: 'simple', label: 'Modo simples' }, { value: 'custom', label: 'Personalizado' }]}
        />

        {conv.mode === 'simple' ? (
          <div className="mt-4 space-y-4">
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">{g}</div>
                <div className={cx('grid gap-2', g === 'Resolução e FPS' ? 'grid-cols-[repeat(auto-fill,minmax(118px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(210px,1fr))]')}>
                  {PRESETS.filter((p) => p.group === g).map((p) => (
                    <button
                      key={p.id}
                      data-preset={p.id}
                      title={p.description}
                      onClick={() => setConv((c) => ({ ...c, presetId: p.id, overrides: {}, limitMB: undefined }))}
                      className={cx('focus-ring rounded-lg border px-3 py-2.5 text-left transition-all', conv.presetId === p.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/70 bg-elev/40 hover:bg-elev')}
                    >
                      <span className="block text-[13.5px] font-semibold">{p.name}</span>
                      {g !== 'Resolução e FPS' && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{p.description}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[12.5px] text-muted">{preset.description}</p>
            {preset.sizeLimit && (
              <label className="flex flex-wrap items-center gap-3 text-[13px]">
                Tamanho máximo
                <input
                  type="number" min={0} step={1}
                  value={limitValue || ''}
                  placeholder="sem limite"
                  onChange={(e) => setConv((c) => ({ ...c, limitMB: Math.max(0, Math.floor(Number(e.target.value) || 0)), overrides: {} }))}
                  className="focus-ring h-9 w-28 rounded-lg border border-line/70 bg-elev/60 px-3"
                />
                MB
                {preset.sizeLimit === 'optional' && <span className="text-faint">Deixe vazio para não limitar. O limite do Discord varia conforme o plano e o servidor.</span>}
              </label>
            )}
          </div>
        ) : (
          <CustomPanel value={effective} probe={probe} hw={hw} onChange={(v) => setConv((c) => ({ ...c, custom: v }))} encoder={conv.encoder} />
        )}
      </Card>

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Summary title="Seu vídeo" lines={[probe.width ? `${probe.width}×${probe.height}${probe.fps ? ` · ${fpsText(probe.fps)}` : ''}` : 'Somente áudio', mbText(probe.size)]} />
          <Summary title="Saída" lines={planLines(plan)} />
          <Summary
            title="Tamanho estimado"
            lines={
              plan.blocked ? ['—']
                : plan.estimate ? [`${mbText(plan.estimate.min)} a ${mbText(plan.estimate.max)}`, plan.settings.rate === 'size' ? `limite: ${mbText(plan.settings.targetBytes)} · estimativa` : 'estimativa']
                  : typeof estimate === 'object' && estimate ? [`${mbText(estimate.min)} a ${mbText(estimate.max)}`, 'estimativa por amostras']
                    : [typeof estimate === 'string' ? estimate : 'Sem estimativa']
            }
            action={!plan.blocked && !plan.estimate && !estimate ? <button disabled={estimating || running} onClick={doEstimate} className="mt-1 text-[12.5px] font-medium text-accent hover:underline disabled:opacity-50">{estimating ? 'Codificando amostras…' : 'Estimar com amostras'}</button> : null}
          />
        </div>

        {plan.notes.length > 0 && <ul className="mt-3 space-y-1 text-[12.5px] text-muted">{plan.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
        {plan.blocked && (
          <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 p-3 text-[13px]" data-testid="blocked">
            <div className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0 text-warn" />{plan.blocked}</div>
            {plan.suggestions && (
              <div className="mt-2 flex flex-wrap gap-2 pl-6">
                {plan.suggestions.map((sg) => (
                  <Button key={sg.label} size="sm" onClick={() => setConv((c) => (sg.patch.targetBytes ? { ...c, limitMB: sg.patch.targetBytes / MB, overrides: {} } : { ...c, overrides: { ...c.overrides, ...sg.patch } }))}>{sg.label}</Button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line/60 pt-4">
          <div className="flex items-center gap-2 text-[13px]">
            {plan.usesGpu ? <Zap size={16} className="text-ok" /> : <Cpu size={16} className="text-muted" />}
            <span className="text-muted">Encoder:</span>
            <span className="font-medium" data-testid="encoder">{plan.settings.video === 'copy' ? 'nenhum (cópia)' : plan.settings.video === 'none' ? 'CPU (áudio)' : !hw ? 'verificando…' : plan.usesGpu ? 'GPU NVIDIA (NVENC)' : 'CPU'}</span>
          </div>
          <button
            onClick={async () => { const p = await api.pickFolder(outDir); if (p) setConv((c) => ({ ...c, outputDir: p })); }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted hover:bg-elev" title={outDir}
          >
            <FolderOpen size={15} className="shrink-0" /><span className="truncate">{outDir}</span><span className="shrink-0 text-[12px] text-accent">Alterar</span>
          </button>
          <Button size="lg" variant="primary" disabled={!!plan.blocked || running || !hw || !settings} onClick={() => start()}>Converter</Button>
        </div>
      </Card>
    </div>
  );
}

function planLines(p: Plan): string[] {
  const s = p.settings;
  const container = COMPAT[s.container].label;
  if (p.blocked) return ['—'];
  if (s.video === 'none') return ['MP3', `${p.audioKbps} kbps`];
  if (s.video === 'copy') return [`${container} · sem recodificar`, 'mesma qualidade do original'];
  return [
    `${container} · ${CODEC_LABEL[s.video]} · ${Math.min(p.width!, p.height!)}p${p.fps ? ` · ${fpsText(p.fps)}` : ''}`,
    `${p.width}×${p.height} · ${p.audio === 'none' ? 'sem áudio' : `${p.audio === 'copy' ? 'áudio original' : p.audio.toUpperCase()}${p.audioKbps ? ` ${p.audioKbps} kbps` : ''}`}${p.videoKbps ? ` · vídeo ${p.videoKbps} kbps` : ''}`,
  ];
}

function Summary({ title, lines, action }: { title: string; lines: string[]; action?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-medium uppercase tracking-wider text-faint">{title}</div>
      {lines.map((l, i) => <div key={i} className={cx('mt-1', i === 0 ? 'text-[13.5px] font-semibold' : 'text-[12.5px] text-muted')}>{l}</div>)}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- custom mode

function Section({ title, open: initial, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initial);
  return (
    <div className="rounded-lg border border-line/70">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-[13.5px] font-semibold">
        {title}<ChevronDown size={15} className={cx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-3 border-t border-line/60 px-4 py-3">{children}</div>}
    </div>
  );
}
const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div><div className="text-[13px] font-medium">{label}</div>{hint && <div className="max-w-md text-[12px] text-faint">{hint}</div>}</div>
    {children}
  </div>
);
const NumberBox = ({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) => (
  <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Math.min(max, Math.max(0, Number(e.target.value) || 0)))} className="focus-ring h-9 w-24 rounded-lg border border-line/70 bg-elev/60 px-3 text-[13px]" />
);

function CustomPanel({ value: s, probe, hw, onChange, encoder }: { value: ConvertSettings; probe: MediaProbe; hw: Hardware | null; onChange: (s: ConvertSettings) => void; encoder: EncoderPref }) {
  const { setConv } = useStore();
  const set = (p: Partial<ConvertSettings>) => onChange({ ...s, ...p });
  const works = (c: VideoCodec) => !hw || hw.encoders.some((e) => e.works && (c === 'h264' ? /264/ : c === 'hevc' ? /265|hevc/ : c === 'av1' ? /av1/i : /vp9/).test(e.id));
  const codecs = COMPAT[s.container].video.filter(works);

  const setContainer = (container: Container) => {
    if (container === 'mp3') return set({ container, video: 'none', audio: 'mp3' });
    const video = s.video !== 'none' && s.video !== 'copy' && COMPAT[container].video.includes(s.video) ? s.video : s.video === 'copy' ? 'copy' : COMPAT[container].video[0];
    const audio = s.audio === 'none' || s.audio === 'copy' || COMPAT[container].audio.includes(s.audio) ? s.audio : COMPAT[container].audio[0];
    set({ container, video, audio });
  };
  const sizeMode = s.shortSide === 'original' && !s.custom ? 'original' : s.custom ? 'custom' : String(s.shortSide);
  const fpsPreset = s.fps === 'original' ? 'original' : [24, 30, 50, 60].includes(s.fps) ? String(s.fps) : 'custom';
  const videoOn = s.video !== 'none' && s.video !== 'copy';
  const audioCodec = s.audio !== 'copy' && s.audio !== 'none' ? s.audio : null;
  const gpuWorks = videoOn && hw?.encoders.some((e) => e.works && e.id === `${s.video === 'hevc' ? 'hevc' : s.video}_nvenc`);

  return (
    <div className="mt-4 space-y-2.5">
      <Section title="Formato" open>
        <Field label="Contêiner" hint="MP4 funciona em quase tudo. MKV aceita mais combinações. WebM é para a web.">
          <Select<Container> className="w-52" value={s.container} onChange={setContainer} options={(Object.keys(COMPAT) as Container[]).map((c) => ({ value: c, label: COMPAT[c].label }))} />
        </Field>
      </Section>

      {s.container !== 'mp3' && (
        <Section title="Vídeo" open>
          <Field label="Codec" hint="Só aparecem os codecs que cabem no formato e passaram no teste deste computador.">
            <Select<string> className="w-52" value={s.video} onChange={(v) => set({ video: v as ConvertSettings['video'] })} options={[...codecs.map((c) => ({ value: c as string, label: CODEC_LABEL[c] })), { value: 'copy', label: 'Copiar (sem recodificar)' }]} />
          </Field>
          {videoOn && (
            <>
              <Field label="Encoder" hint={gpuWorks ? 'Automático usa a GPU quando ela está ativada abaixo.' : 'A GPU não está disponível para este codec.'}>
                <Select<EncoderPref> className="w-52" value={encoder} onChange={(v) => setConv((c) => ({ ...c, encoder: v }))} options={[{ value: 'auto', label: 'Automático' }, ...(gpuWorks ? [{ value: 'gpu' as EncoderPref, label: 'GPU (NVIDIA NVENC)' }] : []), { value: 'cpu', label: 'CPU' }]} />
              </Field>
              <Field label="Resolução" hint="É o lado menor da imagem, então também vale para vídeos na vertical.">
                <div className="flex items-center gap-2">
                  <Select<string> className="w-40" value={sizeMode} onChange={(v) => set(v === 'custom' ? { custom: { width: probe.width ?? 1280, height: probe.height ?? 720 } } : { custom: undefined, shortSide: v === 'original' ? 'original' : Number(v) })} options={[{ value: 'original', label: 'Original' }, ...[2160, 1440, 1080, 720, 480].map((h) => ({ value: String(h), label: `${h}p` })), { value: 'custom', label: 'Dimensões…' }]} />
                  {s.custom && <><NumberBox value={s.custom.width} min={16} max={7680} onChange={(width) => set({ custom: { ...s.custom!, width } })} /><span className="text-faint">×</span><NumberBox value={s.custom.height} min={16} max={4320} onChange={(height) => set({ custom: { ...s.custom!, height } })} /></>}
                </div>
              </Field>
              <Field label="Preservar proporção"><Toggle checked={s.keepAspect} onChange={(v) => set({ keepAspect: v })} /></Field>
              <Field label="Não ampliar" hint="Impede aumentar a resolução acima do original."><Toggle checked={!s.allowUpscale} onChange={(v) => set({ allowUpscale: !v })} /></Field>
              <Field label="FPS">
                <div className="flex items-center gap-2">
                  <Select<string> className="w-40" value={fpsPreset} onChange={(v) => set({ fps: v === 'original' ? 'original' : v === 'custom' ? 25 : Number(v), allowFpsIncrease: true })} options={[{ value: 'original', label: 'Original' }, ...['24', '30', '50', '60'].map((v) => ({ value: v, label: v })), { value: 'custom', label: 'Outro…' }]} />
                  {fpsPreset === 'custom' && <NumberBox value={s.fps as number} min={1} max={240} onChange={(n) => set({ fps: Math.max(1, n) })} />}
                </div>
              </Field>
              <Field label="Controle de tamanho">
                <Select<ConvertSettings['rate']> className="w-52" value={s.rate} onChange={(rate) => set({ rate, autoResolution: false, videoKbps: rate === 'bitrate' ? s.videoKbps ?? 4000 : undefined, targetBytes: rate === 'size' ? s.targetBytes ?? 100 * MB : undefined, sourceCap: undefined })} options={[{ value: 'quality', label: 'Automático por qualidade' }, { value: 'bitrate', label: 'Bitrate manual' }, { value: 'size', label: 'Tamanho máximo' }]} />
              </Field>
              {s.rate === 'quality' && (
                <Field label="Qualidade" hint="Para a direita: imagem melhor e arquivo maior.">
                  <div className="flex items-center gap-2 text-[12px] text-faint">Arquivo menor<input type="range" min={20} max={95} value={s.quality} onChange={(e) => set({ quality: Number(e.target.value) })} className="w-44 accent-[rgb(var(--accent))]" />Mais qualidade</div>
                </Field>
              )}
              {s.rate === 'bitrate' && <Field label="Bitrate do vídeo (kbps)" hint="Dados por segundo. Mais bitrate = melhor imagem e arquivo maior."><NumberBox value={s.videoKbps ?? 4000} min={50} max={200000} onChange={(videoKbps) => set({ videoKbps })} /></Field>}
              {s.rate === 'size' && <Field label="Tamanho máximo (MB)"><NumberBox value={Math.round((s.targetBytes ?? 0) / MB)} min={1} max={100000} onChange={(n) => set({ targetBytes: n * MB })} /></Field>}
            </>
          )}
        </Section>
      )}

      <Section title="Áudio">
        <Field label="Codec">
          <Select<string> className="w-52" value={s.audio} onChange={(v) => set({ audio: v as ConvertSettings['audio'] })} options={[...(s.video !== 'none' ? [{ value: 'copy', label: 'Manter original se couber' }] : []), ...COMPAT[s.container].audio.map((a) => ({ value: a as string, label: a === 'opus' ? 'Opus' : a.toUpperCase() })), ...(s.video !== 'none' ? [{ value: 'none', label: 'Remover áudio' }] : [])]} />
        </Field>
        {audioCodec && (
          <>
            <Field label="Bitrate"><Select<number> className="w-40" value={s.audioKbps} onChange={(audioKbps) => set({ audioKbps })} options={AUDIO_BITRATES[audioCodec as AudioCodec].map((k) => ({ value: k, label: `${k} kbps` }))} /></Field>
            <Field label="Canais"><Select<string> className="w-40" value={String(s.channels)} onChange={(v) => set({ channels: v === 'original' ? 'original' : (Number(v) as 1 | 2) })} options={[{ value: 'original', label: 'Original' }, { value: '1', label: 'Mono' }, { value: '2', label: 'Estéreo' }]} /></Field>
          </>
        )}
        <Field label="Remover metadados" hint="Apaga informações como título, data e localização gravadas no arquivo."><Toggle checked={s.stripMetadata} onChange={(v) => set({ stripMetadata: v })} /></Field>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- hardware & progress

function HardwarePanel({ hw, detecting, error, onDetect, enabled, onEnable, disabled }: { hw: Hardware | null; detecting: boolean; error: string; onDetect: () => void; enabled: boolean; onEnable: (v: boolean) => void; disabled: boolean }) {
  const [details, setDetails] = useState(false);
  const nv = hw?.encoders.find((e) => e.id === 'h264_nvenc');
  return (
    <Card className="mt-5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Zap size={18} className={nv?.works ? 'text-ok' : 'text-faint'} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium" data-testid="gpu-status">
            {detecting ? 'Testando os encoders…' : !hw ? 'Aceleração por GPU ainda não verificada' : nv?.works ? 'Aceleração NVIDIA (NVENC) disponível' : 'Aceleração NVIDIA indisponível. A conversão usa a CPU.'}
          </div>
          {error && <div className="text-[12.5px] text-bad">{error}</div>}
          {nv && !nv.works && <div className="text-[12.5px] text-faint">{nv.listed ? 'O FFmpeg tem o encoder, mas ele não iniciou neste computador.' : 'Este FFmpeg não inclui o encoder NVENC.'}</div>}
        </div>
        {nv?.works && <label className="flex items-center gap-2 text-[13px] text-muted">Usar GPU<Toggle checked={enabled} onChange={onEnable} /></label>}
        <Button size="sm" onClick={onDetect} disabled={detecting || disabled} icon={detecting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}>Detectar aceleração GPU</Button>
      </div>
      {hw && (
        <>
          <button onClick={() => setDetails(!details)} className="mt-2 flex items-center gap-1 text-[12px] text-faint hover:text-muted"><ChevronDown size={13} className={cx(details && 'rotate-180')} />Todos os encoders testados</button>
          {details && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {hw.encoders.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-[12.5px]" title={e.error}>
                  {e.works ? <CheckCircle2 size={13} className="text-ok" /> : <X size={13} className="text-faint" />}
                  <span className={e.works ? '' : 'text-faint'}>{e.label} — {e.works ? 'testado e funcionando' : e.listed ? 'listado, mas não funcionou' : 'não incluído no FFmpeg'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function JobPanel({ state: j, onRetryCpu }: { state: ConvertState; onRetryCpu?: () => void }) {
  const { dismissConvert } = useStore();
  const name = j.output?.split(/[\\/]/).pop();
  const saved = j.inputSize && j.outputSize ? Math.round((1 - j.outputSize / j.inputSize) * 100) : 0;
  return (
    <Card className={cx('mb-4 p-4 animate-in', j.status === 'error' && 'border-bad/30', j.status === 'done' && (j.overLimit ? 'border-warn/40' : 'border-ok/30'))} data-testid="job" data-status={j.status}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {j.status === 'running' ? j.stage : j.status === 'done' ? (j.overLimit ? 'Concluído, mas acima do limite' : 'Conversão concluída') : j.status === 'canceled' ? 'Conversão cancelada' : 'A conversão falhou'}
          </div>
          <div className="truncate text-[12.5px] text-muted" title={j.output}>{j.status === 'error' ? j.error : name}</div>
        </div>
        {j.status === 'running' && <Button size="sm" variant="danger" icon={<X size={14} />} onClick={() => api.cancelConversion()}>Cancelar</Button>}
        {j.status === 'done' && <><Button size="sm" onClick={() => api.openFile(j.output!)}>Abrir</Button><Button size="sm" variant="primary" icon={<FolderOpen size={14} />} onClick={() => api.showInFolder(j.output!)}>Abrir pasta</Button></>}
        {j.status === 'error' && j.canRetryCpu && onRetryCpu && <Button size="sm" variant="primary" icon={<Cpu size={14} />} onClick={onRetryCpu}>Tentar na CPU</Button>}
        {j.status !== 'running' && <button onClick={dismissConvert} title="Fechar" className="text-faint hover:text-fg"><X size={15} /></button>}
      </div>
      {j.status === 'running' && (
        <>
          <div className="mt-3"><Progress value={j.progress} /></div>
          <div className="mt-1.5 text-[12.5px] tabular-nums text-muted">
            {[`${Math.floor(j.progress)}%`, j.encoderLabel, j.speed ? `${j.speed.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x` : '', `decorrido ${duration(j.elapsed ?? 0)}`, eta(j.eta)].filter(Boolean).join(' · ')}
          </div>
        </>
      )}
      {j.status === 'done' && (
        <div className="mt-2 text-[13px]" data-testid="result">
          {mbText(j.inputSize)} → <b>{mbText(j.outputSize)}</b> {saved > 0 ? `(${saved}% menor)` : saved < 0 ? `(${-saved}% maior)` : ''} · {duration(j.elapsed)} · {j.encoderLabel}
          {j.overLimit && <div className="mt-1 text-warn">O arquivo ficou com {mbText(j.outputSize)}, acima do limite de {mbText(j.targetBytes)}, mesmo após as tentativas. Reduza a resolução ou aceite um limite maior.</div>}
        </div>
      )}
    </Card>
  );
}
