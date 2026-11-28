import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { UpdateState } from '@shared/update';
import { api, useStore } from '../lib/store';
import { Button, Card, Progress } from './ui';
import { bytes, date, speed } from '../lib/format';

const KIND = { installed: 'versão instalada', portable: 'versão portátil', dev: 'modo de desenvolvimento' };

export function UpdatePanel() {
  const { toast } = useStore();
  const [u, setU] = useState<UpdateState | null>(null);
  useEffect(() => { api.getUpdate().then(setU); return api.onUpdate(setU); }, []);
  if (!u) return null;
  const busy = u.status === 'checking' || u.status === 'verifying' || u.status === 'installing';
  const pct = u.total && u.received ? Math.min(100, (u.received / u.total) * 100) : 0;
  const info = u.info && u.status !== 'uptodate' && u.status !== 'checking' ? u.info : undefined;
  const size = info?.asset?.size ? ` (${bytes(info.asset.size)})` : '';

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    const r = await action();
    if (!r.ok) toast({ kind: 'error', title: 'A atualização não foi instalada', msg: r.error });
  };

  return (
    <Card className="p-5" data-testid="update-panel" data-status={u.status}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Baixador {u.current}</div>
          <div className="text-[12.5px] text-muted">{KIND[u.kind]} · nada é verificado ou instalado sem você clicar</div>
        </div>
        {u.status !== 'downloading' && (
          <Button variant={info ? 'ghost' : 'secondary'} onClick={() => api.checkUpdate()} disabled={busy} icon={u.status === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}>
            {u.status === 'checking' ? 'Verificando…' : 'Só verificar'}
          </Button>
        )}
        {!info && u.kind !== 'dev' && (
          <Button variant="primary" onClick={() => run(api.updateNow)} disabled={busy} icon={<Download size={15} />}>Atualizar app</Button>
        )}
      </div>
      {u.kind !== 'dev' && (
        <p className="mt-2 text-[12.5px] text-muted" data-testid="update-explain">
          Um clique baixa, confere (SHA-256) e instala a versão nova. O Baixador fecha e abre de novo; downloads, histórico e configurações não são alterados.
          {u.kind === 'portable' ? ' A pasta da versão atual é guardada ao lado, com ".anterior" no nome.' : ' O instalador não tem assinatura digital; o Windows pode pedir confirmação.'}
        </p>
      )}

      {u.lastResult && (
        <p className={`mt-3 text-[13px] ${u.lastResult.ok ? 'text-ok' : 'text-bad'}`}>{u.lastResult.message}</p>
      )}
      {u.status === 'uptodate' && <p className="mt-3 flex items-center gap-2 text-[13.5px] text-ok"><CheckCircle2 size={16} />Você está usando a versão mais recente.</p>}
      {u.status === 'error' && (
        <div className="mt-3 flex items-start gap-2 text-[13.5px] text-bad"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span data-testid="update-error">{u.error}</span></div>
      )}
      {u.status === 'error' && !info && (
        <Button className="mt-2" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => api.openReleasePage()}>Ver no GitHub</Button>
      )}

      {info && (
        <div className="mt-4 border-t border-line/60 pt-4">
          <div className="text-[14px] font-semibold">Nova versão {info.version}{info.publishedAt ? <span className="ml-2 text-[12.5px] font-normal text-faint">{date(Date.parse(info.publishedAt))}</span> : null}</div>
          {info.notes
            ? <div className="selectable mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-bg p-3 text-[12.5px] leading-relaxed text-muted">{info.notes}</div>
            : <p className="mt-2 text-[12.5px] text-muted">Veja as novidades no GitHub.</p>}
          {u.manualReason && <p className="mt-2 text-[13px] text-warn">{u.manualReason}</p>}

          {u.status === 'downloading' && (
            <div className="mt-3">
              <Progress value={pct} />
              <div className="mt-1.5 flex items-center justify-between text-[12.5px] tabular-nums text-muted">
                <span>{u.total ? `${Math.floor(pct)}% · ${bytes(u.received)} de ${bytes(u.total)}` : bytes(u.received)}{u.speed ? ` · ${speed(u.speed)}` : ''}</span>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => api.cancelUpdate()}>Cancelar</Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!u.manualReason && u.status === 'available' && <Button variant="primary" icon={<Download size={15} />} onClick={() => run(api.updateNow)}>Atualizar agora{size}</Button>}
            {!u.manualReason && u.status === 'error' && <Button variant="primary" icon={<RotateCcw size={15} />} onClick={() => run(api.updateNow)}>Tentar de novo</Button>}
            {u.status === 'verifying' && <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" />Conferindo o arquivo (SHA-256)…</span>}
            {u.status === 'ready' && (
              <>
                <span className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 size={15} />Download conferido (SHA-256).</span>
                <Button variant="primary" onClick={() => run(api.installUpdate)}>Instalar e reiniciar</Button>
              </>
            )}
            {u.status === 'installing' && <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={15} className="animate-spin" />Fechando o app para instalar. Ele abre de novo sozinho…</span>}
            <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => api.openReleasePage()}>Ver no GitHub</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
