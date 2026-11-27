import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { UpdateState } from '@shared/update';
import { api, useStore } from '../lib/store';
import { Button, Card, Modal, Progress } from './ui';
import { bytes, date, speed } from '../lib/format';

const KIND = { installed: 'versão instalada', portable: 'versão portátil', dev: 'modo de desenvolvimento' };

export function UpdatePanel() {
  const { toast } = useStore();
  const [u, setU] = useState<UpdateState | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { api.getUpdate().then(setU); return api.onUpdate(setU); }, []);
  if (!u) return null;
  const busy = u.status === 'checking' || u.status === 'verifying' || u.status === 'installing';
  const pct = u.total && u.received ? Math.min(100, (u.received / u.total) * 100) : 0;
  const info = u.info;

  const install = async () => {
    setConfirm(false);
    const r = await api.installUpdate();
    if (!r.ok) toast({ kind: 'error', title: 'A atualização não foi instalada', msg: r.error });
  };

  return (
    <Card className="p-5" data-testid="update-panel" data-status={u.status}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Baixador {u.current}</div>
          <div className="text-[12.5px] text-muted">{KIND[u.kind]} · a verificação só acontece quando você clica</div>
        </div>
        {u.status !== 'downloading' && (
          <Button onClick={() => api.checkUpdate()} disabled={busy} icon={u.status === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}>
            {u.status === 'checking' ? 'Verificando…' : 'Verificar atualizações'}
          </Button>
        )}
      </div>

      {u.lastResult && (
        <p className={`mt-3 text-[13px] ${u.lastResult.ok ? 'text-ok' : 'text-bad'}`}>{u.lastResult.message}</p>
      )}
      {u.status === 'uptodate' && <p className="mt-3 flex items-center gap-2 text-[13.5px] text-ok"><CheckCircle2 size={16} />Você está usando a versão mais recente.</p>}
      {u.status === 'error' && (
        <div className="mt-3 flex items-start gap-2 text-[13.5px] text-bad"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span data-testid="update-error">{u.error}</span></div>
      )}

      {info && u.status !== 'uptodate' && u.status !== 'checking' && (
        <div className="mt-4 border-t border-line/60 pt-4">
          <div className="text-[14px] font-semibold">Nova versão {info.version}{info.publishedAt ? <span className="ml-2 text-[12.5px] font-normal text-faint">{date(Date.parse(info.publishedAt))}</span> : null}</div>
          {info.notes && <div className="selectable mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[12.5px] leading-relaxed text-muted">{info.notes}</div>}
          {u.manualReason && <p className="mt-2 text-[13px] text-warn">{u.manualReason}</p>}

          {u.status === 'downloading' && (
            <div className="mt-3">
              <Progress value={pct} />
              <div className="mt-1.5 flex items-center justify-between text-[12.5px] tabular-nums text-muted">
                <span>{Math.floor(pct)}% · {bytes(u.received)} de {bytes(u.total)}{u.speed ? ` · ${speed(u.speed)}` : ''}</span>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => api.cancelUpdate()}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!u.manualReason && u.status === 'available' && <Button variant="primary" icon={<Download size={15} />} onClick={() => api.downloadUpdate()}>Baixar atualização{info.asset ? ` (${bytes(info.asset.size)})` : ''}</Button>}
            {!u.manualReason && u.status === 'error' && <Button variant="primary" icon={<RotateCcw size={15} />} onClick={() => api.downloadUpdate()}>Tentar baixar de novo</Button>}
            {u.status === 'verifying' && <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" />Conferindo o arquivo (SHA-256)…</span>}
            {u.status === 'ready' && (
              <>
                <span className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={15} />Download conferido (SHA-256).</span>
                <Button variant="primary" onClick={() => setConfirm(true)}>Instalar atualização</Button>
              </>
            )}
            {u.status === 'installing' && <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" />Fechando o app para instalar…</span>}
            <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => api.openReleasePage()}>Ver no GitHub</Button>
          </div>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Instalar a versão ${info?.version}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Agora não</Button><Button variant="primary" onClick={install}>Fechar e instalar</Button></>}
      >
        {u.kind === 'portable'
          ? 'O Baixador vai fechar, trocar a pasta do aplicativo pela nova versão e abrir de novo. A pasta da versão atual é guardada ao lado, com ".anterior" no nome. Seus downloads, histórico e configurações não são alterados.'
          : 'O Baixador vai fechar, o instalador conferido será executado e o app abrirá de novo. Seus downloads, histórico e configurações não são alterados. O Windows pode pedir confirmação, porque o instalador não tem assinatura digital.'}
      </Modal>
    </Card>
  );
}
