import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, FolderOpen, Moon, Monitor, Sun, XCircle } from 'lucide-react';
import type { Settings, ToolStatus } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Button, Card, PageHeader, Row, Segmented, Select, Toggle, cx } from '../components/ui';
import { UpdatePanel } from '../components/UpdatePanel';
import { AboutPanel } from '../components/AboutPanel';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">{title}</h2>
      <Card className="divide-y divide-line/60 px-5">{children}</Card>
    </section>
  );
}

function PathField({ value, onPick, onOpen }: { value: string; onPick: () => void; onOpen?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="selectable h-9 w-[340px] truncate rounded-lg border border-line/70 bg-elev/60 px-3 text-[13px] leading-9 text-muted" title={value}>{value}</div>
      {onOpen && <Button size="md" variant="ghost" onClick={onOpen} title="Abrir pasta"><FolderOpen size={15} /></Button>}
      <Button onClick={onPick}>Procurar…</Button>
    </div>
  );
}

export function SettingsPage() {
  const { settings: s, updateSettings: set, toast } = useStore();
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [advanced, setAdvanced] = useState(s?.cookiesFromBrowser !== 'none');
  useEffect(() => { if (s) api.checkTools().then(setTools); }, [s?.ytdlpPath, s?.ffmpegPath]);
  if (!s) return null;
  const save = (p: Partial<Settings>) => set(p).then(() => toast({ kind: 'ok', title: 'Configuração salva' }));

  const ToolLine = ({ t }: { t?: ToolStatus['ytdlp'] }) =>
    !t ? null : t.ok ? (
      <span className="flex items-center gap-1 text-[12px] text-ok"><CheckCircle2 size={13} /> Encontrado · versão {t.version}</span>
    ) : (
      <span className="flex items-center gap-1 text-[12px] text-bad"><XCircle size={13} /> {t.error}</span>
    );

  return (
    <div>
      <PageHeader title="Configurações" subtitle="As mudanças são salvas automaticamente." />

      <Section title="Downloads">
        <Row label="Pasta de download preferida" hint="Todo download novo começa nesta pasta.">
          <PathField value={s.downloadDir} onOpen={() => api.openFolder(s.downloadDir)} onPick={async () => { const p = await api.pickFolder(s.downloadDir); if (p) save({ downloadDir: p }); }} />
        </Row>
        <Row label="Nome dos arquivos" hint="Como cada arquivo baixado será nomeado.">
          <Select
            className="w-[260px]"
            value={s.filenameStyle}
            onChange={(v) => save({ filenameStyle: v })}
            options={[
              { value: 'title', label: 'Título' },
              { value: 'title-id', label: 'Título [ID do vídeo]' },
              { value: 'channel-title', label: 'Canal - Título' },
              { value: 'date-title', label: 'Data - Título' },
            ]}
          />
        </Row>
        <Row label="Downloads simultâneos" hint="Quantos arquivos baixar ao mesmo tempo. Os demais esperam na fila.">
          <Select className="w-[120px]" value={s.maxConcurrent} onChange={(v) => save({ maxConcurrent: v })} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
        </Row>
        <Row label="Abrir a pasta ao concluir" hint="Mostra o arquivo no Explorador quando o download terminar.">
          <Toggle checked={s.openFolderAfter} onChange={(v) => save({ openFolderAfter: v })} />
        </Row>
      </Section>

      <Section title="Qualidade padrão">
        <Row label="Tipo padrão" hint="O que vem selecionado depois de analisar um link.">
          <Segmented size="sm" value={s.defaultMode} onChange={(v) => save({ defaultMode: v })} options={[{ value: 'video', label: 'Vídeo' }, { value: 'audio', label: 'Áudio' }]} />
        </Row>
        <Row label="Qualidade de vídeo" hint="Se não existir, usa a maior abaixo dela.">
          <Select
            className="w-[200px]"
            value={s.defaultVideoQuality}
            onChange={(v) => save({ defaultVideoQuality: v })}
            options={[
              { value: 'best', label: 'Melhor disponível' },
              { value: '2160', label: '2160p (4K)' },
              { value: '1440', label: '1440p' },
              { value: '1080', label: '1080p' },
              { value: '720', label: '720p' },
              { value: '480', label: '480p' },
              { value: '360', label: '360p' },
            ]}
          />
        </Row>
        <Row label="Formato de áudio">
          <Segmented size="sm" value={s.defaultAudioFormat} onChange={(v) => save({ defaultAudioFormat: v })} options={[{ value: 'mp3', label: 'MP3' }, { value: 'audio', label: 'Original' }]} />
        </Row>
        <Row label="Bitrate do MP3">
          <Segmented size="sm" value={String(s.defaultBitrate) as '128'} onChange={(v) => save({ defaultBitrate: Number(v) as Settings['defaultBitrate'] })} options={['128', '192', '256', '320'].map((b) => ({ value: b as '128', label: `${b} kbps` }))} />
        </Row>
      </Section>

      <Section title="Aparência e comportamento">
        <Row label="Tema">
          <Segmented
            size="sm"
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'dark', label: 'Escuro', icon: <Moon size={13} /> },
              { value: 'light', label: 'Claro', icon: <Sun size={13} /> },
              { value: 'system', label: 'Sistema', icon: <Monitor size={13} /> },
            ]}
          />
        </Row>
        <Row label="Detectar links copiados" hint="Oferece colar automaticamente quando você copia um link.">
          <Toggle checked={s.clipboardWatch} onChange={(v) => save({ clipboardWatch: v })} />
        </Row>
        <Row label="Notificações do Windows" hint="Avisa quando um download termina ou falha com o app em segundo plano.">
          <Toggle checked={s.notifications} onChange={(v) => save({ notifications: v })} />
        </Row>
        <Row label="Gravar título, capa e informações no arquivo" hint="Metadados no arquivo e capa embutida no MP3.">
          <Toggle checked={s.embedMetadata} onChange={(v) => save({ embedMetadata: v })} />
        </Row>
      </Section>

      <Section title="Programas">
        <Row label="Localizar automaticamente" hint={"Procura o yt-dlp e o FFmpeg no PATH, em C:\\yt-dlp, C:\\ffmpeg, winget, Scoop e Chocolatey."}>
          <Button onClick={async () => { const before = s; const after = await api.detectTools(); await set({}); toast(after.ytdlpPath !== before.ytdlpPath || after.ffmpegPath !== before.ffmpegPath ? { kind: 'ok', title: 'Caminhos atualizados' } : { kind: 'info', title: 'Nenhum caminho diferente encontrado' }); }}>Detectar</Button>
        </Row>
        <div className="py-3.5">
          <div className="flex items-center justify-between gap-6">
            <div><div className="text-[13.5px] font-medium">yt-dlp</div><ToolLine t={tools?.ytdlp} /></div>
            <PathField value={s.ytdlpPath} onPick={async () => { const p = await api.pickFile(s.ytdlpPath); if (p) save({ ytdlpPath: p }); }} />
          </div>
        </div>
        <div className="py-3.5">
          <div className="flex items-center justify-between gap-6">
            <div><div className="text-[13.5px] font-medium">FFmpeg</div><ToolLine t={tools?.ffmpeg} /></div>
            <PathField value={s.ffmpegPath} onPick={async () => { const p = await api.pickFile(s.ffmpegPath); if (p) save({ ffmpegPath: p }); }} />
          </div>
        </div>
      </Section>

      <section className="mb-6">
        <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">Sobre e atualizações</h2>
        <UpdatePanel />
        <AboutPanel />
      </section>

      <section>
        <button onClick={() => setAdvanced((v) => !v)} className="mb-2 flex items-center gap-1 text-[12px] font-medium uppercase tracking-wider text-faint hover:text-muted">
          Avançado <ChevronDown size={14} className={cx('transition-transform', advanced && 'rotate-180')} />
        </button>
        {advanced && (
          <Card className="divide-y divide-line/60 px-5 animate-in">
            <Row label="Usar cookies do navegador" hint="Necessário para vídeos com restrição de idade, privados ou quando o site pede login. Use um navegador onde você está logado.">
              <Select
                className="w-[160px]"
                value={s.cookiesFromBrowser}
                onChange={(v) => save({ cookiesFromBrowser: v })}
                options={[
                  { value: 'none', label: 'Não usar' },
                  { value: 'firefox', label: 'Firefox' },
                  { value: 'chrome', label: 'Chrome' },
                  { value: 'edge', label: 'Edge' },
                  { value: 'brave', label: 'Brave' },
                  { value: 'opera', label: 'Opera' },
                ]}
              />
            </Row>
          </Card>
        )}
      </section>
    </div>
  );
}
