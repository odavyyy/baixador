import React, { useEffect, useState } from 'react';
import { ChevronDown, ImageOff, Music2, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
};
export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[.97] disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-9 px-4 text-[13.5px]',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' && 'bg-accent text-white shadow-[0_6px_20px_-8px_rgb(var(--accent)/.8)] hover:brightness-110',
        variant === 'secondary' && 'bg-elev text-fg hover:bg-line/70 border border-line/60',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-elev',
        variant === 'danger' && 'bg-bad/15 text-bad hover:bg-bad/25',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ title, onClick, children, tone, disabled }: { title: string; onClick?: () => void; children: React.ReactNode; tone?: 'bad' | 'accent'; disabled?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'focus-ring grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-elev disabled:opacity-40 disabled:pointer-events-none',
        tone === 'bad' ? 'hover:text-bad' : tone === 'accent' ? 'hover:text-accent' : 'hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-xl border border-line/70 bg-card', className)}>{children}</div>;
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-line/70 bg-elev/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'focus-ring inline-flex items-center gap-2 rounded-md font-medium transition-all duration-200',
            size === 'md' ? 'h-9 px-4 text-[13.5px]' : 'h-7 px-3 text-[12.5px]',
            value === o.value ? 'bg-card text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('focus-ring relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={cx('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200', checked ? 'left-[19px]' : 'left-[3px]')} />
    </button>
  );
}

export function Select<T extends string | number>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <select
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        className="focus-ring h-9 w-full cursor-pointer appearance-none rounded-lg border border-line/70 bg-elev/60 pl-3 pr-9 text-[13.5px] text-fg hover:border-line"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-card">{o.label}</option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Progress({ value, tone = 'accent', indeterminate }: { value: number; tone?: 'accent' | 'ok' | 'bad' | 'muted'; indeterminate?: boolean }) {
  const color = { accent: 'bg-accent', ok: 'bg-ok', bad: 'bg-bad', muted: 'bg-faint' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-elev">
      <div
        className={cx('h-full rounded-full transition-[width] duration-300 ease-out', color, indeterminate && 'stripes')}
        style={{ width: `${indeterminate ? 100 : Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Thumb({ src, className, audio }: { src?: string; className?: string; audio?: boolean }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  return (
    <div className={cx('relative overflow-hidden bg-elev', className)}>
      {src && !err ? (
        <img src={src} onError={() => setErr(true)} className="h-full w-full object-cover" draggable={false} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="grid h-full w-full place-items-center text-faint">{audio ? <Music2 size={20} /> : <ImageOff size={20} />}</div>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'muted', className }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'ok' | 'bad' | 'warn'; className?: string }) {
  const t = {
    muted: 'bg-elev text-muted',
    accent: 'bg-accent/15 text-accent',
    ok: 'bg-ok/15 text-ok',
    bad: 'bg-bad/15 text-bad',
    warn: 'bg-warn/15 text-warn',
  }[tone];
  return <span className={cx('inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11.5px] font-medium', t, className)}>{children}</span>;
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Empty({ icon, title, msg, action }: { icon: React.ReactNode; title: string; msg?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center animate-in">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-elev text-muted">{icon}</div>
      <div className="text-[15px] font-medium">{title}</div>
      {msg && <div className="mt-1 max-w-sm text-[13.5px] text-muted">{msg}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px] animate-in" onMouseDown={onClose}>
      <div className="w-[440px] max-w-[92vw] rounded-xl border border-line bg-card p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <IconButton title="Fechar" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="text-[13.5px] text-muted">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
