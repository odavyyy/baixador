import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import type { LogEntry, ToolStatus } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Button, Card, Modal, PageHeader, Segmented, cx } from '../components/ui';

export function DiagnosticsPage() {
  const { toast } = useStore();
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [q, setQ] = useState('');
  const [updating, setUpdating] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const check = async () => { setChecking(true); setTools(await api.checkTools()); setChecking(false); };
  useEffect(() => {
    void check();
    api.getLogs().then(setLogs);
    return api.onLog((e) => setLogs((l) => (l.length > 3000 ? [...l.slice(-2500), e] : [...l, e])));
  }, []);

  const shown = useMemo(
    () => logs.filter((l) => (level === 'all' || (level === 'warn' ? l.level !== 'info' : l.level === 'error')) && (!q || l.msg.toLowerCase().includes(q.toLowerCase()) || l.scope.includes(q))),
    [logs, level, q],
  );
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown]);

  const update = async () => {
    setConfirmUpdate(false);
    setUpdating(true);
    const r = await api.updateYtdlp();
    setUpdating(false);
    toast({ kind: r.ok ? 'ok' : 'error', title: r.ok ? 'yt-dlp verificado' : 'Falha ao atualizar o yt-dlp', msg: r.output.split('\n').filter(Boolean).pop() });
    void check();
  };

  const Tool = ({ name, t }: { name: string; t?: ToolStatus['ytdlp'] }) => (
    <Card className="flex-1 p-4">
      <div className="flex items-center gap-2">
        {!t ? <Loader2 size={16} className="animate-spin text-muted" /> : t.ok ? <CheckCircle2 size={16} className="text-ok" /> : <XCircle size={16} className="text-bad" />}
        <span className="text-[14px] font-medium">{name}</span>
        {t?.ok && <span className="ml-auto text-[12.5px] tabular-nums text-muted">{t.version}</span>}
      </div>
      <div className="selectable mt-1.5 truncate text-[12px] text-faint" title={t?.path}>{t?.path}</div>
      {t && !t.ok && <div className="mt-1 text-[12.5px] text-bad">{t.error}</div>}
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Diagnóstico"
        subtitle="Estado dos programas e registro técnico, útil para resolver problemas."
        right={
          <>
            <Button size="sm" icon={<RefreshCw size={14} className={checking ? 'animate-spin' : ''} />} onClick={check}>Verificar</Button>
            <Button size="sm" icon={updating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} disabled={updating} onClick={() => setConfirmUpdate(true)}>Atualizar yt-dlp</Button>
          </>
        }
      />
      <div className="mb-6 flex gap-3">
        <Tool name="yt-dlp" t={tools?.ytdlp} />
        <Tool name="FFmpeg" t={tools?.ffmpeg} />
      </div>

      <div className="mb-2.5 flex items-center gap-3">
        <h2 className="text-[12px] font-medium uppercase tracking-wider text-faint">Registro técnico</h2>
        <div className="flex-1" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" className="h-8 w-48 rounded-lg border border-line/70 bg-elev/60 px-3 text-[12.5px] outline-none focus:border-accent/60" />
        <Segmented size="sm" value={level} onChange={setLevel} options={[{ value: 'all', label: 'Tudo' }, { value: 'warn', label: 'Avisos' }, { value: 'error', label: 'Erros' }]} />
        <Button size="sm" variant="ghost" title="Copiar" onClick={() => { navigator.clipboard.writeText(shown.map((l) => `${new Date(l.t).toISOString()} [${l.level}] [${l.scope}] ${l.msg}`).join('\n')); toast({ kind: 'ok', title: 'Logs copiados' }); }}><Copy size={14} /></Button>
        <Button size="sm" variant="ghost" title="Exportar" onClick={async () => { const p = await api.exportLogs(); if (p) toast({ kind: 'ok', title: 'Logs exportados', msg: p }); }}><Download size={14} /></Button>
        <Button size="sm" variant="ghost" title="Limpar" onClick={async () => { await api.clearLogs(); setLogs([]); }}><Trash2 size={14} /></Button>
      </div>
      <Card>
        <div
          ref={box}
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
          className="selectable h-[420px] overflow-auto p-3 font-mono text-[11.5px] leading-[1.65]"
        >
          {shown.length === 0 && <div className="p-6 text-center font-sans text-[13px] text-muted">Sem registros.</div>}
          {shown.map((l, i) => (
            <div key={i} className="flex gap-3 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-faint">{new Date(l.t).toLocaleTimeString('pt-BR')}</span>
              <span className={cx('w-[86px] shrink-0 truncate', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-accent/80')}>{l.scope}</span>
              <span className={l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-muted'}>{l.msg}</span>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={confirmUpdate}
        onClose={() => setConfirmUpdate(false)}
        title="Atualizar o yt-dlp?"
        footer={<><Button variant="ghost" onClick={() => setConfirmUpdate(false)}>Cancelar</Button><Button variant="primary" onClick={update}>Atualizar</Button></>}
      >
        Executa <code className="text-fg">yt-dlp -U</code>, que atualiza o seu próprio yt-dlp em <span className="text-fg">{tools?.ytdlp.path}</span> pela versão oficial mais recente. Útil quando um site para de funcionar.
      </Modal>
    </div>
  );
}
