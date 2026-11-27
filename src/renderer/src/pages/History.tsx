import { useEffect, useMemo, useState } from 'react';
import { FileVideo, FolderOpen, History as HistoryIcon, Search, Trash2 } from 'lucide-react';
import type { HistoryItem } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, Empty, IconButton, Modal, PageHeader, Segmented, Thumb, cx } from '../components/ui';
import { basename, bytes, date, dirname, isAudioMode, modeLabel } from '../lib/format';

/** Confirmation dialog: removing a record never deletes the file unless the box is ticked AND confirmed. */
export function RemoveDialog({ item, onClose }: { item: HistoryItem | null; onClose: () => void }) {
  const { toast } = useStore();
  const [alsoFile, setAlsoFile] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAlsoFile(false), [item]);
  if (!item) return null;
  const go = async () => {
    setBusy(true);
    const r = await api.removeHistory(item.id, alsoFile);
    setBusy(false);
    if (r.ok) toast({ kind: 'info', title: alsoFile ? 'Arquivo enviado para a Lixeira' : 'Removido do histórico', msg: item.title });
    else toast({ kind: 'error', title: 'Não foi possível remover', msg: r.error });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Remover do histórico"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant={alsoFile ? 'danger' : 'primary'} onClick={go} disabled={busy}>{alsoFile ? 'Remover e apagar arquivo' : 'Remover registro'}</Button>
        </>
      }
    >
      <p>O registro de <span className="font-medium text-fg">{item.title}</span> será removido do histórico. O arquivo continua no seu computador.</p>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line/70 p-3 hover:bg-elev/50">
        <input type="checkbox" checked={alsoFile} onChange={(e) => setAlsoFile(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--bad))]" />
        <span>
          <span className="block font-medium text-fg">Também apagar o arquivo do computador</span>
          <span className="block text-[12.5px]">Ele será movido para a Lixeira do Windows.</span>
        </span>
      </label>
    </Modal>
  );
}

function useExists(items: HistoryItem[]) {
  const [missing, setMissing] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    Promise.all(items.map(async (i) => [i.id, await api.fileExists(i.filePath)] as const)).then((r) => {
      if (alive) setMissing(new Set(r.filter(([, ok]) => !ok).map(([id]) => id)));
    });
    return () => { alive = false; };
  }, [items]);
  return missing;
}

export function HistoryPage() {
  const { history, go } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'video' | 'audio'>('all');
  const [removing, setRemoving] = useState<HistoryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const items = useMemo(
    () =>
      history.filter((h) => {
        if (filter === 'video' && isAudioMode(h.mode)) return false;
        if (filter === 'audio' && !isAudioMode(h.mode)) return false;
        const s = q.trim().toLowerCase();
        return !s || h.title.toLowerCase().includes(s) || (h.uploader ?? '').toLowerCase().includes(s) || h.filePath.toLowerCase().includes(s);
      }),
    [history, q, filter],
  );
  const missing = useExists(items);

  return (
    <div>
      <PageHeader
        title="Histórico"
        subtitle={`${history.length} ${history.length === 1 ? 'download' : 'downloads'} registrados`}
        right={history.length > 0 && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)}>Limpar histórico</Button>}
      />
      {history.length === 0 ? (
        <Empty icon={<HistoryIcon size={24} />} title="Histórico vazio" msg="Os arquivos que você baixar aparecem aqui." action={<Button variant="primary" onClick={() => go('home')}>Baixar algo</Button>} />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-line/70 bg-elev/60 px-3 focus-within:border-accent/60">
              <Search size={15} className="text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, canal ou pasta" className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
            </div>
            <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Todos' }, { value: 'video', label: 'Vídeos' }, { value: 'audio', label: 'Áudios' }]} />
          </div>
          <Card className="divide-y divide-line/60 overflow-hidden">
            {items.map((h) => {
              const gone = missing.has(h.id);
              return (
                <div key={h.id} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-elev/40">
                  <Thumb src={h.thumbnail} audio={isAudioMode(h.mode)} className={cx('aspect-video w-[96px] shrink-0 rounded-md', gone && 'opacity-40')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium" title={h.title}>{h.title}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge>{modeLabel[h.mode]}</Badge>
                      <Badge>{h.qualityLabel}</Badge>
                      {h.size ? <span className="text-[12px] text-faint">{bytes(h.size)}</span> : null}
                      {gone && <Badge tone="warn">Arquivo não encontrado</Badge>}
                    </div>
                    <div className="mt-1 truncate text-[12px] text-faint" title={h.filePath}>{basename(h.filePath)} · {dirname(h.filePath)}</div>
                  </div>
                  <div className="w-[130px] shrink-0 text-right text-[12.5px] text-muted">{date(h.date)}</div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton title="Abrir" tone="accent" disabled={gone} onClick={() => api.openFile(h.filePath)}><FileVideo size={16} /></IconButton>
                    <IconButton title="Mostrar na pasta" disabled={gone} onClick={() => api.showInFolder(h.filePath)}><FolderOpen size={16} /></IconButton>
                    <IconButton title="Remover do histórico" tone="bad" onClick={() => setRemoving(h)}><Trash2 size={15} /></IconButton>
                  </div>
                </div>
              );
            })}
            {items.length === 0 && <div className="p-8 text-center text-[13.5px] text-muted">Nada encontrado para essa busca.</div>}
          </Card>
        </>
      )}
      <RemoveDialog item={removing} onClose={() => setRemoving(null)} />
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Limpar todo o histórico?"
        footer={<><Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancelar</Button><Button variant="primary" onClick={async () => { await api.clearHistory(); setConfirmClear(false); }}>Limpar registros</Button></>}
      >
        Todos os registros serão apagados. Nenhum arquivo será removido do seu computador.
      </Modal>
    </div>
  );
}
