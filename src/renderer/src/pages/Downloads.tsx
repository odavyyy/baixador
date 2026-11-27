import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileVideo, FolderOpen, Pause, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { Job } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Badge, Button, Card, Empty, IconButton, PageHeader, Progress, Thumb, cx } from '../components/ui';
import { bytes, eta, isAudioMode, modeLabel, speed } from '../lib/format';

const STATUS: Record<Job['status'], { label: string; tone: 'muted' | 'accent' | 'ok' | 'bad' | 'warn' }> = {
  queued: { label: 'Aguardando', tone: 'muted' },
  downloading: { label: 'Baixando', tone: 'accent' },
  processing: { label: 'Convertendo', tone: 'warn' },
  paused: { label: 'Pausado', tone: 'muted' },
  completed: { label: 'Concluído', tone: 'ok' },
  error: { label: 'Erro', tone: 'bad' },
  canceled: { label: 'Cancelado', tone: 'muted' },
};

export function DownloadsPage() {
  const { jobs, go } = useStore();
  const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing');
  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'paused');
  const done = jobs.filter((j) => j.status === 'completed' || j.status === 'error' || j.status === 'canceled');
  const totalSpeed = active.reduce((s, j) => s + (j.speed ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Downloads"
        subtitle={active.length ? `${active.length} em andamento${totalSpeed ? ` · ${speed(totalSpeed)}` : ''}${waiting.length ? ` · ${waiting.length} na fila` : ''}` : waiting.length ? `${waiting.length} na fila` : 'Acompanhe aqui tudo o que você está baixando.'}
        right={<Button variant="primary" icon={<Plus size={16} />} onClick={() => go('home')}>Novo download</Button>}
      />
      {!jobs.length && (
        <Empty icon={<Download size={24} />} title="Nenhum download ainda" msg="Cole um link na tela Início, escolha a qualidade e clique em Baixar." action={<Button variant="primary" onClick={() => go('home')}>Ir para o Início</Button>} />
      )}
      {active.length > 0 && <Section title="Em andamento">{active.map((j) => <JobCard key={j.id} job={j} />)}</Section>}
      {waiting.length > 0 && <Section title="Fila e pausados">{waiting.map((j) => <JobCard key={j.id} job={j} />)}</Section>}
      {done.length > 0 && (
        <Section title="Finalizados" right={<Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => api.clearFinished()}>Limpar lista</Button>}>
          {done.map((j) => <JobCard key={j.id} job={j} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[12px] font-medium uppercase tracking-wider text-faint">{title}</h2>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function JobCard({ job: j }: { job: Job }) {
  const { go } = useStore();
  const [showDetail, setShowDetail] = useState(false);
  const st = STATUS[j.status];
  const running = j.status === 'downloading' || j.status === 'processing';
  const processing = j.status === 'processing';
  const canPause = j.status === 'downloading' || j.status === 'queued';
  const finished = j.status === 'completed' || j.status === 'error' || j.status === 'canceled';

  const line = (() => {
    if (j.status === 'completed') return `${bytes(j.total)} · salvo em ${j.outputDir}`;
    if (j.status === 'error') return j.error;
    if (j.status === 'canceled') return 'Download cancelado.';
    if (j.status === 'queued') return 'Aguardando vaga na fila…';
    if (j.status === 'paused') return j.downloaded ? `Pausado em ${Math.floor(j.progress)}% · ${bytes(j.downloaded)} baixados` : 'Pausado';
    if (processing) return `${j.stage ?? 'Processando'}…`;
    return [j.stage, j.downloaded ? `${bytes(j.downloaded)} de ${bytes(j.total)}` : '', speed(j.speed), eta(j.eta)].filter(Boolean).join(' · ');
  })();

  return (
    <Card className={cx('p-3.5 transition-colors', j.status === 'error' && 'border-bad/30')}>
      <div className="flex items-center gap-4">
        <Thumb src={j.thumbnail} audio={isAudioMode(j.mode)} className="aspect-video w-[112px] shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[14px] font-medium" title={j.title}>{j.title}</div>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge tone={st.tone}>
              {j.status === 'completed' && <CheckCircle2 size={12} />}
              {j.status === 'error' && <AlertCircle size={12} />}
              {st.label}
            </Badge>
            <Badge>{modeLabel[j.mode]}</Badge>
            <Badge>{j.qualityLabel}</Badge>
            {running && !processing && <span className="ml-1 text-[12.5px] font-semibold tabular-nums text-fg">{Math.floor(j.progress)}%</span>}
          </div>
          {!finished && (
            <div className="mt-2.5">
              <Progress value={j.progress} tone={j.status === 'paused' || j.status === 'queued' ? 'muted' : 'accent'} indeterminate={processing} />
            </div>
          )}
          <div className={cx('mt-1.5 truncate text-[12.5px] tabular-nums', j.status === 'error' ? 'text-bad' : 'text-muted')} title={line}>{line}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canPause && <IconButton title="Pausar" onClick={() => api.pause(j.id)}><Pause size={16} /></IconButton>}
          {j.status === 'paused' && <IconButton title="Continuar" tone="accent" onClick={() => api.resume(j.id)}><Play size={16} /></IconButton>}
          {(j.status === 'error' || j.status === 'canceled') && <IconButton title="Tentar novamente" tone="accent" onClick={() => api.retry(j.id)}><RotateCcw size={16} /></IconButton>}
          {j.status === 'completed' && j.filePath && (
            <>
              <IconButton title="Abrir arquivo" tone="accent" onClick={() => api.openFile(j.filePath!)}><FileVideo size={16} /></IconButton>
              <IconButton title="Abrir pasta" onClick={() => api.showInFolder(j.filePath!)}><FolderOpen size={16} /></IconButton>
            </>
          )}
          {!finished && <IconButton title="Cancelar" tone="bad" onClick={() => api.cancel(j.id)}><X size={16} /></IconButton>}
          {finished && <IconButton title="Remover da lista" tone="bad" onClick={() => api.removeJob(j.id)}><Trash2 size={15} /></IconButton>}
        </div>
      </div>
      {j.status === 'error' && j.errorDetail && (
        <div className="mt-2 pl-[128px]">
          <button onClick={() => setShowDetail((v) => !v)} className="flex items-center gap-1 text-[12px] text-faint hover:text-muted">
            <ChevronDown size={13} className={cx('transition-transform', showDetail && 'rotate-180')} /> Detalhes técnicos
          </button>
          {showDetail && (
            <div className="mt-2 animate-in">
              <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-[11.5px] text-muted">{j.errorDetail.split('\n').slice(-8).join('\n')}</pre>
              <button onClick={() => go('diagnostics')} className="mt-1.5 text-[12px] text-accent hover:underline">Abrir Diagnóstico</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
