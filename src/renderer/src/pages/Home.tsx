import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Clipboard, Clock, Download, Film, FolderOpen, Link2, Loader2, Music, Sparkles, User, X } from 'lucide-react';
import type { DownloadMode, DownloadRequest, MediaInfo, Settings, VideoOption } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, Segmented, Thumb, cx } from '../components/ui';
import { bytes, duration, isUrl } from '../lib/format';
import { PlaylistResult } from './Playlist';

type Kind = 'video' | 'audio';
type Container = 'mp4' | 'mkv';
type AudioFmt = 'mp3' | 'original';
const BITRATES = [128, 192, 256, 320] as const;

export function HomePage() {
  const { home, setHome, analyzeUrl, settings, tools, go } = useStore();
  const missing = tools ? [!tools.ytdlp.ok && 'yt-dlp', !tools.ffmpeg.ok && 'FFmpeg'].filter(Boolean) : [];
  const [clip, setClip] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => api.onClipboardUrl((u) => { if (u !== home.url) setClip(u); }), [home.url]);
  useEffect(() => { if (home.phase === 'idle') inputRef.current?.focus(); }, [home.phase]);

  const submit = (u = home.url) => {
    if (!isUrl(u)) {
      setHome((h) => ({ ...h, url: u, phase: 'error', error: 'Isso não parece um link. Cole um endereço que comece com http:// ou https://' }));
      return;
    }
    setClip(null);
    void analyzeUrl(u);
  };
  const pasteAndGo = async () => {
    const t = (await api.readClipboard()).trim();
    if (!t) return;
    setHome((h) => ({ ...h, url: t }));
    if (isUrl(t)) submit(t);
  };
  const analyzing = home.phase === 'analyzing';

  return (
    <div>
      <div className={cx('transition-all duration-500', home.phase === 'idle' ? 'pt-[9vh]' : 'pt-2')}>
        {home.phase === 'idle' && (
          <div className="mb-7 text-center animate-in">
            <h1 className="text-[28px] font-semibold tracking-tight">Cole um link para começar</h1>
            <p className="mt-2 text-[14px] text-muted">YouTube, Instagram, TikTok, X, Vimeo e centenas de outros sites.</p>
          </div>
        )}

        {missing.length > 0 && (
          <div className="mx-auto mb-4 flex max-w-[820px] items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px] animate-in">
            <AlertCircle size={16} className="shrink-0 text-warn" />
            <span className="flex-1 text-muted"><span className="font-medium text-fg">{missing.join(' e ')} não {missing.length > 1 ? 'foram encontrados' : 'foi encontrado'}.</span> Instale ou indique o caminho em Configurações › Programas.</span>
            <Button size="sm" onClick={() => go('settings')}>Configurar</Button>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mx-auto max-w-[820px]">
          <div className="group flex items-center gap-2 rounded-2xl border border-line bg-card p-2 pl-4 shadow-[0_10px_40px_-20px_rgba(0,0,0,.6)] transition-colors focus-within:border-accent/60">
            <Link2 size={18} className="shrink-0 text-faint group-focus-within:text-accent" />
            <input
              ref={inputRef}
              value={home.url}
              onChange={(e) => setHome((h) => ({ ...h, url: e.target.value, phase: h.phase === 'error' ? 'idle' : h.phase }))}
              onPaste={(e) => {
                const t = e.clipboardData.getData('text').trim();
                if (isUrl(t)) { e.preventDefault(); setHome((h) => ({ ...h, url: t })); submit(t); }
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            {home.url && !analyzing && (
              <button type="button" title="Limpar" onClick={() => { setHome({ url: '', phase: 'idle' }); inputRef.current?.focus(); }} className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-elev hover:text-fg">
                <X size={16} />
              </button>
            )}
            {!home.url && (
              <Button type="button" variant="ghost" onClick={pasteAndGo} icon={<Clipboard size={15} />}>Colar</Button>
            )}
            {analyzing ? (
              <Button type="button" size="lg" variant="secondary" onClick={() => api.cancelAnalyze()} icon={<Loader2 size={17} className="animate-spin" />}>Cancelar</Button>
            ) : (
              <Button type="submit" size="lg" variant="primary" disabled={!home.url.trim()} icon={<Sparkles size={17} />}>Analisar</Button>
            )}
          </div>
        </form>

        {clip && !analyzing && (
          <div className="mx-auto mt-3 flex max-w-[820px] items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2.5 animate-in">
            <Clipboard size={16} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-[13px]">
              <span className="text-muted">Link copiado: </span>
              <span className="truncate font-medium">{clip}</span>
            </div>
            <Button size="sm" variant="primary" onClick={() => { setHome((h) => ({ ...h, url: clip })); submit(clip); }}>Colar e analisar</Button>
            <button onClick={() => setClip(null)} className="text-faint hover:text-fg"><X size={15} /></button>
          </div>
        )}
      </div>

      <div className="mx-auto mt-6 max-w-[820px]">
        {analyzing && <AnalyzingSkeleton />}
        {home.phase === 'error' && home.error && (
          <Card className="flex items-start gap-3 border-bad/30 bg-bad/[.06] p-4 animate-in">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-bad" />
            <div className="flex-1">
              <div className="text-[14px] font-medium">Não foi possível analisar</div>
              <div className="mt-0.5 text-[13.5px] text-muted">{home.error}</div>
            </div>
            {isUrl(home.url) && <Button size="sm" onClick={() => submit()}>Tentar de novo</Button>}
          </Card>
        )}
        {home.phase === 'ready' && home.info && settings && <Result key={home.info.url} info={home.info} settings={settings} />}
        {home.phase === 'ready' && home.playlist && settings && <PlaylistResult key={home.playlist.url} playlist={home.playlist} settings={settings} />}
      </div>
    </div>
  );
}

function AnalyzingSkeleton() {
  return (
    <Card className="p-5 animate-in">
      <div className="flex gap-5">
        <div className="skeleton aspect-video w-[260px] rounded-lg" />
        <div className="flex-1 space-y-3 pt-1">
          <div className="skeleton h-5 w-4/5 rounded" />
          <div className="skeleton h-4 w-2/5 rounded" />
          <div className="skeleton h-4 w-1/4 rounded" />
          <div className="pt-3 text-[13px] text-muted"><Loader2 size={14} className="mr-2 inline animate-spin" />Consultando o yt-dlp…</div>
        </div>
      </div>
    </Card>
  );
}

function pickDefault(opts: VideoOption[], q: Settings['defaultVideoQuality']): string {
  if (!opts.length || q === 'best') return 'best';
  const h = Number(q);
  const exact = opts.find((o) => o.height === h);
  if (exact) return exact.key;
  const lower = opts.find((o) => o.height < h);
  return lower ? lower.key : 'best';
}

const fpsLabel = (o: VideoOption) => (o.fps && o.fps > 30 ? `${o.fps} FPS` : o.fps ? `${o.fps} FPS` : '');

function Result({ info, settings }: { info: MediaInfo; settings: Settings }) {
  const { toast, go, analyzeUrl } = useStore();
  const hasVideo = info.videoOptions.length > 0;
  const hasAudio = info.audioOptions.length > 0 || info.videoOptions.some((o) => o.bestHasAudio);
  const [kind, setKind] = useState<Kind>(hasVideo ? settings.defaultMode : 'audio');
  const [container, setContainer] = useState<Container>('mp4');
  const [videoKey, setVideoKey] = useState(() => pickDefault(info.videoOptions, settings.defaultVideoQuality));
  const [audioFmt, setAudioFmt] = useState<AudioFmt>(settings.defaultAudioFormat === 'audio' && info.audioOptions.length ? 'original' : 'mp3');
  const [bitrate, setBitrate] = useState<number>(settings.defaultBitrate);
  const [audioId, setAudioId] = useState(info.audioOptions[0]?.formatId ?? '');
  const [outDir, setOutDir] = useState(settings.downloadDir);
  const [sending, setSending] = useState(false);

  useEffect(() => setOutDir(settings.downloadDir), [settings.downloadDir]);

  const top = info.videoOptions[0];
  const sourceAbr = info.audioOptions[0]?.abr;
  const maxRes = top ? `${top.label}${top.fps && top.fps > 30 ? ` ${top.fps}` : ''}` : null;

  const req = useMemo((): DownloadRequest => {
    const base = { url: info.url, title: info.title, thumbnail: info.thumbnail, uploader: info.uploader, duration: info.duration };
    if (kind === 'video') {
      const o = videoKey === 'best' ? top : info.videoOptions.find((x) => x.key === videoKey) ?? top;
      const mode: DownloadMode = container === 'mp4' ? 'video' : 'video-original';
      if (!o) return { ...base, mode, formatSpec: 'bv*+ba/b', qualityLabel: 'Melhor qualidade' };
      const id = container === 'mp4' ? o.mp4FormatId : o.bestFormatId;
      const withAudio = container === 'mp4' ? o.mp4HasAudio : o.bestHasAudio;
      const spec = withAudio ? id : container === 'mp4' ? `${id}+bestaudio[ext=m4a]/${id}+bestaudio/${id}` : `${id}+bestaudio/${id}`;
      return {
        ...base, mode, formatSpec: spec,
        qualityLabel: `${o.label}${o.fps && o.fps > 30 ? ` ${o.fps}fps` : ''}`,
        height: o.height || undefined,
        expectedSize: container === 'mp4' ? o.mp4Size : o.bestSize,
      };
    }
    if (audioFmt === 'mp3') {
      return {
        ...base, mode: 'mp3', formatSpec: 'bestaudio/best', bitrate, qualityLabel: `${bitrate} kbps`,
        expectedSize: info.duration ? Math.round((bitrate * 1000 / 8) * info.duration) : undefined,
      };
    }
    const a = info.audioOptions.find((x) => x.formatId === audioId) ?? info.audioOptions[0];
    return {
      ...base, mode: 'audio', formatSpec: a ? a.formatId : 'bestaudio/best',
      qualityLabel: a ? `${a.codec}${a.abr ? ` ${a.abr} kbps` : ''}` : 'Original', expectedSize: a?.size,
    };
  }, [info, kind, container, videoKey, audioFmt, bitrate, audioId, top]);

  const download = async () => {
    setSending(true);
    try {
      await api.enqueue({ ...req, outputDir: outDir });
      toast({ kind: 'info', title: 'Adicionado aos downloads', msg: `${info.title} · ${req.qualityLabel}`, action: { label: 'Ver downloads', run: () => go('downloads') } });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 animate-in">
      {/* media header */}
      <Card className="flex gap-5 p-4">
        <div className="relative w-[256px] shrink-0">
          <Thumb src={info.thumbnail} audio={!hasVideo} className="aspect-video w-full rounded-lg" />
          {info.duration ? <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11.5px] font-medium text-white">{duration(info.duration)}</span> : null}
        </div>
        <div className="min-w-0 flex-1 py-1">
          <h2 className="selectable line-clamp-2 text-[17px] font-semibold leading-snug">{info.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            {info.uploader && <span className="flex items-center gap-1.5"><User size={14} />{info.uploader}</span>}
            {info.duration ? <span className="flex items-center gap-1.5"><Clock size={14} />{duration(info.duration)}</span> : null}
            {info.site && <span className="text-faint">{info.site}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {maxRes && <Badge tone="accent">Até {maxRes}{top?.fps && top.fps > 30 ? ' FPS' : ''}</Badge>}
            {hasVideo && <Badge>{info.videoOptions.length} {info.videoOptions.length === 1 ? 'resolução' : 'resoluções'}</Badge>}
            {info.audioOptions.length > 0 && <Badge>{info.audioOptions.length} {info.audioOptions.length === 1 ? 'faixa de áudio' : 'faixas de áudio'}</Badge>}
            <Badge>{info.formatCount} formatos no total</Badge>
          </div>
        </div>
      </Card>

      {info.playlistUrl && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2.5 text-[13px]">
          <span className="flex-1 text-muted">Este link também faz parte de uma playlist. Abaixo está só este vídeo.</span>
          <Button size="sm" variant="primary" onClick={() => analyzeUrl(info.playlistUrl!)}>Ver playlist inteira</Button>
        </div>
      )}

      {info.outdatedWarning && (
        <div className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2.5 text-[13px]">
          <AlertCircle size={16} className="shrink-0 text-warn" />
          <span className="flex-1 text-muted">O yt-dlp avisou que pode estar desatualizado para este site. Se o download falhar, atualize-o em Diagnóstico.</span>
          <Button size="sm" variant="ghost" onClick={() => go('diagnostics')}>Diagnóstico</Button>
        </div>
      )}

      {/* options */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              ...(hasVideo ? [{ value: 'video' as Kind, label: 'Vídeo', icon: <Film size={15} /> }] : []),
              ...(hasAudio ? [{ value: 'audio' as Kind, label: 'Áudio', icon: <Music size={15} /> }] : []),
            ]}
          />
          {kind === 'video' ? (
            <Segmented<Container> size="sm" value={container} onChange={setContainer} options={[{ value: 'mp4', label: 'MP4 · compatível' }, { value: 'mkv', label: 'MKV · original' }]} />
          ) : (
            <Segmented<AudioFmt>
              size="sm"
              value={audioFmt}
              onChange={setAudioFmt}
              options={[{ value: 'mp3', label: 'MP3' }, ...(info.audioOptions.length ? [{ value: 'original' as AudioFmt, label: 'Original, sem conversão' }] : [])]}
            />
          )}
        </div>

        <div className="mt-5">
          {kind === 'video' && (
            <>
              <div className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-faint">Qualidade</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {top && (
                  <OptionTile
                    active={videoKey === 'best'}
                    onClick={() => setVideoKey('best')}
                    title="Melhor"
                    sub={`${top.label}${top.fps && top.fps > 30 ? ` · ${top.fps} FPS` : ''}`}
                    meta={sizeText(container === 'mp4' ? top.mp4Size : top.bestSize)}
                    highlight
                  />
                )}
                {info.videoOptions.map((o) => (
                  <OptionTile
                    key={o.key}
                    active={videoKey === o.key}
                    onClick={() => setVideoKey(o.key)}
                    title={o.label}
                    sub={[fpsLabel(o), container === 'mp4' ? o.mp4Codec : o.codec].filter(Boolean).join(' · ')}
                    meta={sizeText(container === 'mp4' ? o.mp4Size : o.bestSize)}
                  />
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-faint">
                {container === 'mp4'
                  ? 'MP4 prioriza H.264, que abre em qualquer player. Acima de 1080p alguns sites só oferecem VP9/AV1.'
                  : 'MKV guarda o melhor vídeo e áudio exatamente como o site entrega, sem conversão.'}
              </p>
            </>
          )}

          {kind === 'audio' && audioFmt === 'mp3' && (
            <>
              <div className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-faint">Bitrate do MP3</div>
              <div className="grid grid-cols-4 gap-2">
                {BITRATES.map((b) => (
                  <OptionTile
                    key={b}
                    active={bitrate === b}
                    onClick={() => setBitrate(b)}
                    title={`${b} kbps`}
                    sub={b === 128 ? 'Menor arquivo' : b === 192 ? 'Bom' : b === 256 ? 'Ótimo' : 'Máxima'}
                    meta={info.duration ? `~${bytes((b * 1000 / 8) * info.duration)}` : ''}
                  />
                ))}
              </div>
              {sourceAbr ? (
                <p className="mt-3 text-[12.5px] text-faint">
                  O áudio original tem ~{sourceAbr} kbps ({info.audioOptions[0].codec}). Bitrates maiores que a fonte aumentam o arquivo, mas não a qualidade.
                </p>
              ) : null}
            </>
          )}

          {kind === 'audio' && audioFmt === 'original' && (
            <>
              <div className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-faint">Faixas de áudio disponíveis</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
                {info.audioOptions.map((a, i) => (
                  <OptionTile
                    key={a.formatId}
                    active={audioId === a.formatId}
                    onClick={() => setAudioId(a.formatId)}
                    title={`${a.codec}${a.abr ? ` · ${a.abr} kbps` : ''}`}
                    sub={[i === 0 ? 'Melhor' : '', a.ext === 'webm' ? '.opus' : `.${a.ext}`, a.note].filter(Boolean).join(' · ')}
                    meta={sizeText(a.size)}
                    highlight={i === 0}
                  />
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-faint">Baixa o áudio exatamente como está no site, sem perda por reconversão.</p>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3 border-t border-line/60 pt-4">
          <button
            onClick={async () => { const p = await api.pickFolder(outDir); if (p) setOutDir(p); }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-elev"
            title="Alterar pasta de destino deste download"
          >
            <FolderOpen size={16} className="shrink-0" />
            <span className="truncate">{outDir}</span>
            <span className="shrink-0 text-[12px] text-accent">Alterar</span>
          </button>
          <div className="text-right text-[12.5px] text-muted">
            <div className="font-medium text-fg">{req.qualityLabel}{kind === 'video' ? ` · ${container.toUpperCase()}` : audioFmt === 'mp3' ? ' · MP3' : ''}</div>
            {req.expectedSize ? <div>~{bytes(req.expectedSize)}</div> : null}
          </div>
          <Button size="lg" variant="primary" onClick={download} disabled={sending} icon={sending ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}>
            Baixar
          </Button>
        </div>
      </Card>

      <button onClick={() => go('downloads')} className="mx-auto flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        Ver downloads <ArrowRight size={13} />
      </button>
    </div>
  );
}

const sizeText = (n?: number) => (n ? `~${bytes(n)}` : 'Tamanho desconhecido');

function OptionTile({ active, onClick, title, sub, meta, highlight }: { active: boolean; onClick: () => void; title: string; sub?: string; meta?: string; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'focus-ring relative rounded-lg border px-3.5 py-3 text-left transition-all duration-150',
        active ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/70 bg-elev/40 hover:border-line hover:bg-elev',
      )}
    >
      <div className="flex items-center gap-1.5 text-[14.5px] font-semibold">
        {title}
        {highlight && <Sparkles size={13} className="text-accent" />}
      </div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>}
      {meta && <div className="mt-1.5 text-[11.5px] text-faint">{meta}</div>}
    </button>
  );
}
