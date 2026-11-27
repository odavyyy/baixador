import { AlertCircle, CheckCircle2, CircleCheckBig, Download, History, Home, Info, Settings, Stethoscope, X } from 'lucide-react';
import { useStore, type Page } from './lib/store';
import { cx } from './components/ui';
import { HomePage } from './pages/Home';
import { DownloadsPage } from './pages/Downloads';
import { CompletedPage } from './pages/Completed';
import { HistoryPage } from './pages/History';
import { SettingsPage } from './pages/Settings';
import { DiagnosticsPage } from './pages/Diagnostics';

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Início', icon: Home },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'completed', label: 'Concluídos', icon: CircleCheckBig },
  { id: 'history', label: 'Histórico', icon: History },
];
const NAV_BOTTOM: typeof NAV = [
  { id: 'diagnostics', label: 'Diagnóstico', icon: Stethoscope },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-gradient-to-br from-accent to-[#b45cff] shadow-[0_6px_18px_-6px_rgb(var(--accent)/.9)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></svg>
      </div>
      <div className="leading-tight">
        <div className="text-[14.5px] font-semibold tracking-tight">Baixador</div>
        <div className="text-[11px] text-faint">yt-dlp · FFmpeg</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { page, go, jobs, settings } = useStore();
  const active = jobs.filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued').length;
  const errors = jobs.filter((j) => j.status === 'error').length;
  const item = (n: (typeof NAV)[number]) => {
    const Icon = n.icon;
    const on = page === n.id;
    return (
      <button
        key={n.id}
        onClick={() => go(n.id)}
        className={cx(
          'focus-ring group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors',
          on ? 'bg-elev text-fg' : 'text-muted hover:bg-elev/60 hover:text-fg',
        )}
      >
        <span className={cx('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-all duration-200', on ? 'opacity-100' : 'opacity-0 h-2')} />
        <Icon size={17} strokeWidth={on ? 2.2 : 1.9} className={on ? 'text-accent' : ''} />
        <span className="flex-1 text-left">{n.label}</span>
        {n.id === 'downloads' && active > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{active}</span>}
        {n.id === 'downloads' && !active && errors > 0 && <span className="h-2 w-2 rounded-full bg-bad" />}
      </button>
    );
  };
  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-line/60 bg-panel px-3 pb-3">
      <div className="drag flex h-[64px] items-center pt-3"><Logo /></div>
      <nav className="mt-4 space-y-1">{NAV.map(item)}</nav>
      <div className="flex-1" />
      <nav className="space-y-1">{NAV_BOTTOM.map(item)}</nav>
      {settings && (
        <button
          onClick={() => window.api.openFolder(settings.downloadDir)}
          title="Abrir pasta de downloads"
          className="mt-3 truncate rounded-lg border border-line/60 px-3 py-2 text-left text-[11.5px] text-faint transition-colors hover:text-muted"
        >
          <div className="text-[10.5px] uppercase tracking-wider">Salvando em</div>
          <div className="truncate text-muted">{settings.downloadDir}</div>
        </button>
      )}
    </aside>
  );
}

function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[360px] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === 'ok' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info;
        return (
          <div key={t.id} className="pointer-events-auto flex gap-3 rounded-xl border border-line bg-card/95 p-3.5 shadow-2xl backdrop-blur animate-in">
            <Icon size={18} className={cx('mt-0.5 shrink-0', t.kind === 'ok' ? 'text-ok' : t.kind === 'error' ? 'text-bad' : 'text-accent')} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{t.title}</div>
              {t.msg && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{t.msg}</div>}
              {t.action && (
                <button onClick={() => { t.action!.run(); dismiss(t.id); }} className="mt-2 text-[12.5px] font-medium text-accent hover:underline">
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="h-6 w-6 shrink-0 rounded text-faint hover:text-fg"><X size={14} className="mx-auto" /></button>
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const { page, settings } = useStore();
  if (!settings) return <div className="h-full bg-bg" />;
  const Page = { home: HomePage, downloads: DownloadsPage, completed: CompletedPage, history: HistoryPage, settings: SettingsPage, diagnostics: DiagnosticsPage }[page];
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag h-10 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={page} className="mx-auto w-full max-w-[1060px] px-8 pb-12 pt-2 animate-in">
            <Page />
          </div>
        </div>
      </main>
      <Toasts />
    </div>
  );
}
