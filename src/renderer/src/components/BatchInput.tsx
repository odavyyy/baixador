import { useMemo } from 'react';
import { Clipboard, Loader2, Sparkles, X } from 'lucide-react';
import { extractUrls, MAX_BATCH_LINKS } from '@shared/links';
import type { FailedLink } from '@shared/types';
import { api, useStore } from '../lib/store';
import { Button } from './ui';

/** The "several links" box on the Início page. */
export function BatchInput() {
  const { home, setHome, analyzeList } = useStore();
  const text = home.batchText ?? '';
  const { urls, duplicates } = useMemo(() => extractUrls(text), [text]);
  const analyzing = home.phase === 'analyzing';
  const over = urls.length > MAX_BATCH_LINKS;
  // editing the list throws away the result of the previous one
  const setText = (t: string) => setHome({ url: '', batchMode: true, batchText: t, phase: 'idle' });

  return (
    <div className="mx-auto max-w-[820px]">
      <div className="rounded-2xl border border-line bg-card p-2 transition-colors focus-within:border-accent/60">
        <textarea
          autoFocus
          value={text}
          disabled={analyzing}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Cole vários links, um por linha\nhttps://www.youtube.com/watch?v=…\nhttps://www.youtube.com/watch?v=…'}
          spellCheck={false}
          rows={6}
          className="selectable block w-full resize-y bg-transparent px-2 py-1.5 text-[14px] leading-6 outline-none placeholder:text-faint disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
          <span className="flex-1 px-2 text-[12.5px] text-muted">
            {urls.length} {urls.length === 1 ? 'link' : 'links'}
            {duplicates > 0 && ` · ${duplicates} ${duplicates === 1 ? 'repetido ignorado' : 'repetidos ignorados'}`}
            {over && <span className="text-warn"> · só os primeiros {MAX_BATCH_LINKS} serão usados</span>}
          </span>
          {!analyzing && (
            <>
              <Button variant="ghost" icon={<Clipboard size={15} />} onClick={async () => { const t = (await api.readClipboard()).trim(); if (t) setText(text.trim() ? `${text.trimEnd()}\n${t}` : t); }}>Colar</Button>
              {text && <Button variant="ghost" icon={<X size={15} />} onClick={() => setText('')}>Limpar</Button>}
            </>
          )}
          {analyzing ? (
            <Button size="lg" onClick={() => api.cancelAnalyze()} icon={<Loader2 size={17} className="animate-spin" />}>Cancelar</Button>
          ) : (
            <Button size="lg" variant="primary" disabled={!urls.length} icon={<Sparkles size={17} />} onClick={() => analyzeList(urls.slice(0, MAX_BATCH_LINKS), text)}>
              {urls.length > 1 ? 'Analisar todos' : 'Analisar'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function FailedLinks({ items }: { items: FailedLink[] }) {
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-[13px]">
      <div className="font-medium">{items.length} {items.length === 1 ? 'link não pôde ser lido' : 'links não puderam ser lidos'}</div>
      <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
        {items.map((f) => (
          <li key={f.url} className="text-muted">
            <span className="selectable block truncate" title={f.url}>{f.url}</span>
            <span className="block text-[12px] text-faint">{f.error}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
