import { FolderOpen, Star } from 'lucide-react';
import { api, useStore } from '../lib/store';
import { Button } from './ui';

/**
 * Folder for the download being prepared. Changing it counts only this time, unless the user
 * saves it as the preferred folder, which is the one every new download starts with.
 */
export function FolderPicker({ value, onChange, shown = value }: { value: string; onChange: (dir: string) => void; shown?: string }) {
  const { settings, updateSettings, toast } = useStore();
  const preferred = settings?.downloadDir ?? '';
  const isPreferred = value.toLowerCase() === preferred.toLowerCase();
  return (
    <div className="min-w-0 flex-1">
      <button
        onClick={async () => { const p = await api.pickFolder(value); if (p) onChange(p); }}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-elev"
        title={shown}
      >
        <FolderOpen size={16} className="shrink-0" />
        <span className="truncate">{shown}</span>
        <span className="shrink-0 text-[12px] text-accent">Alterar</span>
      </button>
      {!isPreferred && (
        <div className="mt-1 flex flex-wrap items-center gap-2 px-2 animate-in">
          <span className="text-[12px] text-faint">Só desta vez.</span>
          <Button
            size="sm"
            icon={<Star size={13} />}
            onClick={async () => { await updateSettings({ downloadDir: value }); toast({ kind: 'ok', title: 'Pasta preferida salva', msg: value }); }}
          >
            Usar sempre esta pasta
          </Button>
          <button onClick={() => onChange(preferred)} className="text-[12px] text-accent hover:underline" title={preferred}>Voltar à preferida</button>
        </div>
      )}
    </div>
  );
}
