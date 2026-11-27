import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ConvertRequest, ConvertSettings, ConvertState, EncoderPref, MediaProbe } from '@shared/convert';
import type { Api, HistoryItem, Job, MediaInfo, PlaylistInfo, Settings, ToolStatus } from '@shared/types';

declare global { interface Window { api: Api } }
export const api = window.api;

/** Converter page choices, kept here so they survive switching pages. */
export interface ConverterUi {
  probe?: MediaProbe;
  mode: 'simple' | 'custom';
  presetId: string;
  overrides: Partial<ConvertSettings>;
  limitMB?: number;
  custom: ConvertSettings | null;
  encoder: EncoderPref;
  outputDir?: string;
  retryCpu?: () => void;
}

export type Page = 'converter' | 'home' | 'downloads' | 'completed' | 'history' | 'settings' | 'diagnostics';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  msg?: string;
  action?: { label: string; run: () => void };
}

/** State of the Início page, kept here so it survives switching pages. */
export interface HomeState {
  url: string;
  phase: 'idle' | 'analyzing' | 'ready' | 'error';
  info?: MediaInfo;
  playlist?: PlaylistInfo;
  error?: string;
  errorDetail?: string;
}

interface Store {
  settings: Settings | null;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
  jobs: Job[];
  history: HistoryItem[];
  page: Page;
  go: (p: Page) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  dark: boolean;
  home: HomeState;
  setHome: React.Dispatch<React.SetStateAction<HomeState>>;
  analyzeUrl: (url: string) => Promise<void>;
  tools: ToolStatus | null;
  convert: ConvertState;
  conv: ConverterUi;
  setConv: React.Dispatch<React.SetStateAction<ConverterUi>>;
  startConvert: (req: ConvertRequest) => Promise<{ ok: boolean; error?: string }>;
  dismissConvert: () => void;
}

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState<Page>('home');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [home, setHome] = useState<HomeState>({ url: '', phase: 'idle' });
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [convert, setConvert] = useState<ConvertState>({ status: 'idle', progress: 0 });
  const [conv, setConv] = useState<ConverterUi>({ mode: 'simple', presetId: 'whatsapp', overrides: {}, custom: null, encoder: 'auto' });
  useEffect(() => { api.getConversion().then(setConvert); return api.onConversion(setConvert); }, []);
  const startConvert = useCallback(async (req: ConvertRequest) => {
    const r = await api.startConversion(req);
    // a CPU retry is offered after a GPU failure, never started on its own
    if (r.ok) setConv((c) => ({ ...c, retryCpu: () => { void startConvert({ ...req, pref: 'cpu' }); } }));
    return r;
  }, []);
  const dismissConvert = useCallback(() => setConvert({ status: 'idle', progress: 0 }), []);
  const prevStatus = useRef(new Map<string, string>());
  const tid = useRef(1);
  const announced = useRef(new Set<string>());

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = tid.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.kind === 'error' ? 8000 : 4500);
  }, [dismiss]);

  const go = useCallback((p: Page) => setPage(p), []);

  // initial load + subscriptions
  useEffect(() => {
    api.getSettings().then(setSettings);
    api.listJobs().then((j) => { j.forEach((x) => prevStatus.current.set(x.id, x.status)); setJobs(j); });
    api.listHistory().then(setHistory);
    const offs = [
      api.onJobs((j) => setJobs(j)),
      api.onHistory((h) => setHistory(h)),
      api.onNavigate((p) => setPage(p as Page)),
    ];
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onMq);
    return () => { offs.forEach((o) => o()); mq.removeEventListener('change', onMq); };
  }, []);

  // toasts on job transitions
  useEffect(() => {
    for (const j of jobs) {
      const before = prevStatus.current.get(j.id);
      if (before && before !== j.status && j.batchId) {
        const batch = jobs.filter((x) => x.batchId === j.batchId);
        const ended = ['completed', 'error'].includes(j.status) && batch.every((x) => ['completed', 'error', 'canceled'].includes(x.status));
        if (ended && !announced.current.has(j.batchId)) {
          announced.current.add(j.batchId);
          const ok = batch.filter((x) => x.status === 'completed').length;
          toast({ kind: ok === batch.length ? 'ok' : 'error', title: 'Playlist finalizada', msg: `${j.batchTitle} · ${ok} de ${batch.length} concluídos`, action: { label: 'Ver downloads', run: () => setPage('downloads') } });
        }
      } else if (before && before !== j.status) {
        if (j.status === 'completed') {
          toast({ kind: 'ok', title: 'Download concluído', msg: j.title, action: j.filePath ? { label: 'Abrir pasta', run: () => api.showInFolder(j.filePath!) } : undefined });
        } else if (j.status === 'error') {
          toast({ kind: 'error', title: 'Falha no download', msg: j.error, action: { label: 'Ver', run: () => setPage('downloads') } });
        }
      }
      prevStatus.current.set(j.id, j.status);
    }
  }, [jobs, toast]);

  // re-check yt-dlp / FFmpeg whenever their paths change
  useEffect(() => { if (settings) api.checkTools().then(setTools); }, [settings?.ytdlpPath, settings?.ffmpegPath]);

  const dark = settings ? settings.theme === 'dark' || (settings.theme === 'system' && systemDark) : true;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    api.setTitleBarTheme(dark);
  }, [dark]);

  const updateSettings = useCallback(async (p: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSettings(await api.setSettings(p));
  }, []);

  const analyzeUrl = useCallback(async (url: string) => {
    url = url.trim();
    setHome({ url, phase: 'analyzing' });
    setPage('home');
    const r = await api.analyze(url);
    setHome((h) => {
      if (h.url !== url || h.phase !== 'analyzing') return h; // user moved on
      return r.ok ? { url, phase: 'ready', info: r.info, playlist: r.playlist } : { url, phase: r.error === 'Análise cancelada.' ? 'idle' : 'error', error: r.error, errorDetail: r.detail };
    });
  }, []);

  const value = useMemo<Store>(
    () => ({ settings, updateSettings, jobs, history, page, go, toasts, toast, dismiss, dark, home, setHome, analyzeUrl, tools, convert, conv, setConv, startConvert, dismissConvert }),
    [convert, conv, startConvert, dismissConvert, settings, updateSettings, jobs, history, page, go, toasts, toast, dismiss, dark, home, analyzeUrl, tools],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
