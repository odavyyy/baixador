import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import type { LegalDoc } from '@shared/types';
import { api } from '../lib/store';
import { Button, Card, Modal } from './ui';

const DOCS: { id: LegalDoc; label: string }[] = [
  { id: 'privacy', label: 'Privacidade' },
  { id: 'terms', label: 'Termos de uso' },
  { id: 'notices', label: 'Conteúdo e marcas' },
  { id: 'license', label: 'Licença (MIT)' },
  { id: 'thirdParty', label: 'Licenças de terceiros' },
  { id: 'signing', label: 'Assinatura de código' },
];

/** Documents are shown as plain text from the files shipped with the app, so they work offline. */
export function AboutPanel() {
  const [doc, setDoc] = useState<{ title: string; text: string } | null>(null);
  return (
    <Card className="mt-3 p-5">
      <p className="text-[13px] text-muted">
        O Baixador é um projeto independente de código aberto. Não é afiliado, patrocinado nem aprovado pelo YouTube, WhatsApp, Discord ou qualquer outro serviço citado.
        Baixe e converta apenas conteúdo que você tem direito de usar.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {DOCS.map((d) => (
          <Button key={d.id} size="sm" icon={<FileText size={13} />} onClick={async () => setDoc({ title: d.label, text: await api.readDoc(d.id) })}>{d.label}</Button>
        ))}
        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => api.openProjectLink('repo')}>Código-fonte</Button>
        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => api.openProjectLink('issues')}>Suporte (GitHub Issues)</Button>
      </div>
      <Modal open={!!doc} onClose={() => setDoc(null)} title={doc?.title ?? ''}>
        <div className="selectable max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{doc?.text}</div>
      </Modal>
    </Card>
  );
}
