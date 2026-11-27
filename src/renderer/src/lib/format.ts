export function bytes(n?: number): string {
  if (n === undefined || n === null || !isFinite(n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}
export const speed = (n?: number) => (n ? `${bytes(n)}/s` : '');
export function duration(sec?: number): string {
  if (!sec && sec !== 0) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function eta(sec?: number): string {
  if (sec === undefined || sec === null || !isFinite(sec)) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s restantes`;
  if (sec < 3600) return `${Math.round(sec / 60)} min restantes`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min restantes`;
}
export function date(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Hoje, ${hm}`;
  if (d.toDateString() === y.toDateString()) return `Ontem, ${hm}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) + `, ${hm}`;
}
export const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());
export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
export const modeLabel: Record<string, string> = { video: 'MP4', 'video-original': 'MKV', mp3: 'MP3', audio: 'Áudio original' };
export const isAudioMode = (m: string) => m === 'mp3' || m === 'audio';
