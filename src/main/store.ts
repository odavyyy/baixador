// Small JSON-file storage in %APPDATA%/Baixador. Writes are atomic (tmp + rename) and debounced.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';

export const dataDir = () => app.getPath('userData');

export class JsonFile<T> {
  private file: string;
  private timer: NodeJS.Timeout | null = null;
  value: T;
  /** false when the file did not exist yet (first run) */
  existed = false;

  constructor(name: string, fallback: T) {
    this.file = path.join(dataDir(), name);
    this.value = fallback;
    try {
      if (fs.existsSync(this.file)) {
        this.existed = true;
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.value = Array.isArray(fallback) ? raw : { ...fallback, ...raw };
      }
    } catch {
      // Corrupt file: keep a backup and start over.
      try { fs.copyFileSync(this.file, this.file + '.bak'); } catch {}
    }
  }

  set(v: T) {
    this.value = v;
    this.scheduleSave();
  }

  scheduleSave(delay = 400) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), delay);
  }

  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('save failed', this.file, e);
    }
  }
}

/** Default download folder: C:\yt-dlp\Downloads when that setup exists, otherwise <Downloads>\Baixador. */
export function defaultDownloadDir(): string {
  return fs.existsSync('C:\\yt-dlp') ? 'C:\\yt-dlp\\Downloads' : path.join(app.getPath('downloads'), 'Baixador');
}

export const defaultSettings: Settings = {
  ytdlpPath: 'C:\\yt-dlp\\yt-dlp.exe',
  ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe',
  downloadDir: 'C:\\yt-dlp\\Downloads',
  defaultMode: 'video',
  defaultVideoQuality: 'best',
  defaultAudioFormat: 'mp3',
  defaultBitrate: 320,
  filenameStyle: 'title',
  openFolderAfter: false,
  maxConcurrent: 2,
  theme: 'dark',
  clipboardWatch: true,
  notifications: true,
  embedMetadata: true,
  cookiesFromBrowser: 'none',
};
