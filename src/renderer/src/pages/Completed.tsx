import { useState } from 'react';
import { CircleCheckBig, FolderOpen, Play, Trash2 } from 'lucide-react';
import type { HistoryItem } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, Empty, IconButton, PageHeader, Thumb } from '../components/ui';
import { bytes, date, isAudioMode, modeLabel } from '../lib/format';
import { RemoveDialog } from './History';

const WEEK = 7 * 24 * 3600 * 1000;

export function CompletedPage() {
  const { history, settings, go } = useStore();
  const [removing, setRemoving] = useState<HistoryItem | null>(null);
  const recent = history.filter((h) => Date.now() - h.date < WEEK);

  return (
    <div>
      <PageHeader
        title="Concluídos"
        subtitle="Arquivos baixados nos últimos 7 dias."
        right={settings && <Button icon={<FolderOpen size={15} />} onClick={() => api.openFolder(settings.downloadDir)}>Abrir pasta de downloads</Button>}
      />
      {recent.length === 0 ? (
        <Empty icon={<CircleCheckBig size={24} />} title="Nada concluído recentemente" msg="Seus downloads finalizados aparecem aqui." action={<Button variant="primary" onClick={() => go('home')}>Novo download</Button>} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {recent.map((h) => (
            <Card key={h.id} className="group overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-line hover:shadow-xl">
              <button className="relative block w-full" onClick={() => api.openFile(h.filePath)} title="Abrir arquivo">
                <Thumb src={h.thumbnail} audio={isAudioMode(h.mode)} className="aspect-video w-full" />
                <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-black"><Play size={18} className="ml-0.5" fill="currentColor" /></div>
                </div>
              </button>
              <div className="p-3.5">
                <div className="line-clamp-2 min-h-[38px] text-[13.5px] font-medium leading-snug" title={h.title}>{h.title}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Badge>{modeLabel[h.mode]}</Badge>
                  <Badge>{h.qualityLabel}</Badge>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[12px] text-faint">{date(h.date)}{h.size ? ` · ${bytes(h.size)}` : ''}</span>
                  <div className="flex">
                    <IconButton title="Mostrar na pasta" onClick={() => api.showInFolder(h.filePath)}><FolderOpen size={15} /></IconButton>
                    <IconButton title="Remover" tone="bad" onClick={() => setRemoving(h)}><Trash2 size={14} /></IconButton>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <RemoveDialog item={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
