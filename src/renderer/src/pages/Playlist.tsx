import { useEffect, useState } from 'react';
import { Download, Film, Layers, ListMusic, Loader2, Music } from 'lucide-react';
import type { DownloadRequest, PlaylistInfo, Settings } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, Segmented, Select, Thumb, Toggle, cx } from '../components/ui';
import { duration } from '../lib/format';
import { FailedLinks } from '../components/BatchInput';
import { FolderPicker } from '../components/FolderPicker';

type Kind = 'video' | 'audio';
type AudioFmt = 'mp3' | 'original';

/** Makes a playlist title safe to use as a Windows folder name. */
function folderName(title: string): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[. ]+$/, '');
  if (!clean) return 'Playlist';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `_${clean}` : clean;
}

export function PlaylistResult({ playlist, settings }: { playlist: PlaylistInfo; settings: Settings }) {
  const { toast, go } = useStore();
  const [selected, setSelected] = useState(() => new Set(playlist.entries.map((_, i) => i)));
  const [kind, setKind] = useState<Kind>(/music\.youtube\.com/.test(playlist.entries[0]?.url ?? '') ? 'audio' : settings.defaultMode);
  const [audioFmt, setAudioFmt] = useState<AudioFmt>(settings.defaultAudioFormat === 'audio' ? 'original' : 'mp3');
  const [bitrate, setBitrate] = useState(0);
  const [container, setContainer] = useState<'mp4' | 'mkv'>('mp4');
  const [height, setHeight] = useState<string>(settings.defaultVideoQuality);
  const isList = !!playlist.isList;
  const [subfolder, setSubfolder] = useState(!isList);
  const [outDir, setOutDir] = useState(settings.downloadDir);
  useEffect(() => setOutDir(settings.downloadDir), [settings.downloadDir]);
  const [sending, setSending] = useState(false);

  const count = selected.size;
  const all = count === playlist.entries.length;
  const total = playlist.entries.reduce((s, e) => s + (e.duration ?? 0), 0);
  const finalDir = subfolder ? `${outDir.replace(/[\\/]+$/, '')}\\${folderName(playlist.title)}` : outDir;

  const toggle = (i: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  const options = (): Pick<DownloadRequest, 'mode' | 'formatSpec' | 'formatSort' | 'qualityLabel' | 'bitrate' | 'height'> => {
    if (kind === 'audio') {
      if (audioFmt === 'original') return { mode: 'audio', formatSpec: 'bestaudio/best', qualityLabel: 'Melhor original' };
      return { mode: 'mp3', formatSpec: 'bestaudio/best', bitrate, qualityLabel: bitrate ? `${bitrate} kbps` : 'VBR máxima' };
    }
    const h = height === 'best' ? undefined : Number(height);
    const limit = h ? `[height<=?${h}]` : '';
    const label = h ? `até ${h}p` : 'Melhor';
    if (container === 'mkv') return { mode: 'video-original', formatSpec: `bv*${limit}+ba/b${limit}/b`, qualityLabel: label, height: h };
    return {
      mode: 'video',
      formatSpec: `bv*${limit}+ba[ext=m4a]/bv*${limit}+ba/b${limit}/b`,
      formatSort: 'res,fps,vcodec:h264',
      qualityLabel: label,
      height: h,
    };
  };

  const download = async () => {
    setSending(true);
    try {
      const batchId = `${Date.now()}`;
      const opts = options();
      const chosen = playlist.entries.filter((_, i) => selected.has(i));
      // different videos with the same title would otherwise write to the same file
      const key = (t: string) => t.trim().toLowerCase();
      const titles = new Map<string, number>();
      chosen.forEach((e) => titles.set(key(e.title), (titles.get(key(e.title)) ?? 0) + 1));
      const batchTitle = isList ? `Lote de ${chosen.length} ${chosen.length === 1 ? 'item' : 'itens'}` : playlist.title;
      const reqs: DownloadRequest[] = chosen.map((e) => ({
          ...opts,
          url: e.url,
          title: e.title,
          uploader: e.uploader,
          duration: e.duration,
          thumbnail: e.thumbnail,
          outputDir: finalDir,
          batchId,
          batchTitle,
          batchKind: isList ? 'list' : undefined,
          nameWithId: titles.get(key(e.title))! > 1 || undefined,
        }));
      await api.enqueueMany(reqs);
      toast({ kind: 'info', title: isList ? 'Lote adicionado aos downloads' : 'Playlist adicionada aos downloads', msg: `${reqs.length} ${reqs.length === 1 ? 'item' : 'itens'} · ${opts.qualityLabel}` });
      go('downloads');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 animate-in">
      {playlist.failed?.length ? <FailedLinks items={playlist.failed} /> : null}
      <Card className="flex items-center gap-5 p-4">
        <Thumb src={playlist.entries[0]?.thumbnail} audio className="aspect-video w-[168px] shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-accent">{isList ? <><Layers size={14} />Download em lote</> : <><ListMusic size={14} />Playlist</>}</div>
          <h2 className="selectable mt-1 line-clamp-2 text-[17px] font-semibold leading-snug">{playlist.title}</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>{playlist.entries.length} {playlist.entries.length === 1 ? 'item' : 'itens'}</Badge>
            {total > 0 && <Badge>{duration(total)} no total</Badge>}
            {playlist.skipped > 0 && <Badge tone="warn">{playlist.skipped} indisponíveis</Badge>}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'audio', label: 'Áudio', icon: <Music size={15} /> },
              { value: 'video', label: 'Vídeo', icon: <Film size={15} /> },
            ]}
          />
          {kind === 'audio' ? (
            <div className="flex items-center gap-2">
              <Segmented<AudioFmt> size="sm" value={audioFmt} onChange={setAudioFmt} options={[{ value: 'mp3', label: 'MP3' }, { value: 'original', label: 'Original, sem conversão' }]} />
              {audioFmt === 'mp3' && (
                <Select
                  className="w-[190px]"
                  value={bitrate}
                  onChange={setBitrate}
                  options={[{ value: 0, label: 'Máxima (VBR)' }, ...[320, 256, 192, 128].map((b) => ({ value: b, label: `${b} kbps` }))]}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Segmented size="sm" value={container} onChange={setContainer} options={[{ value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }]} />
              <Select
                className="w-[190px]"
                value={height}
                onChange={setHeight}
                options={[{ value: 'best', label: 'Melhor disponível' }, ...['2160', '1440', '1080', '720', '480', '360'].map((h) => ({ value: h, label: `Até ${h}p` }))]}
              />
            </div>
          )}
        </div>
        {kind === 'video' && <p className="mt-3 text-[12.5px] text-faint">{isList ? 'No lote' : 'Em playlists'}, a qualidade é um limite: cada vídeo usa a melhor opção que tiver até esse valor.</p>}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] font-medium uppercase tracking-wider text-faint">{count} de {playlist.entries.length} selecionados</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(all ? new Set() : new Set(playlist.entries.map((_, i) => i)))}>
            {all ? 'Desmarcar todos' : 'Selecionar todos'}
          </Button>
        </div>
        <div className="mt-2 max-h-[300px] divide-y divide-line/50 overflow-y-auto rounded-lg border border-line/70">
          {playlist.entries.map((e, i) => (
            <label key={`${e.id}-${i}`} className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-elev/60', !selected.has(i) && 'opacity-55')}>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" />
              <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-faint">{i + 1}</span>
              <Thumb src={e.thumbnail} audio className="aspect-video w-[60px] shrink-0 rounded" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{e.title}</span>
                {e.uploader && <span className="block truncate text-[12px] text-faint">{e.uploader}</span>}
              </span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-muted">{duration(e.duration)}</span>
            </label>
          ))}
        </div>

        {!isList && (
          <label className="mt-4 flex items-center gap-3 text-[13px] text-muted">
            <Toggle checked={subfolder} onChange={setSubfolder} />
            Salvar em uma pasta com o nome da playlist
          </label>
        )}

        <div className="mt-4 flex items-center gap-3 border-t border-line/60 pt-4">
          <FolderPicker value={outDir} onChange={setOutDir} shown={finalDir} />
          <Button size="lg" variant="primary" onClick={download} disabled={sending || count === 0} icon={sending ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}>
            Baixar {count} {count === 1 ? 'item' : 'itens'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
