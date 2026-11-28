// Types shared between the Electron main process and the React UI.

import type { UpdateState } from './update';
import type { ConvertRequest, ConvertSettings, ConvertState, EncoderPref, Hardware, MediaProbe } from './convert';

export type Theme = 'dark' | 'light' | 'system';
export type DownloadMode = 'video' | 'mp3' | 'audio' | 'video-original';
export type FilenameStyle = 'title' | 'title-id' | 'channel-title' | 'date-title';
export type CookieBrowser = 'none' | 'firefox' | 'chrome' | 'edge' | 'brave' | 'opera';

export interface Settings {
  ytdlpPath: string;
  ffmpegPath: string;
  downloadDir: string;
  defaultMode: 'video' | 'audio';
  defaultVideoQuality: 'best' | '2160' | '1440' | '1080' | '720' | '480' | '360';
  defaultAudioFormat: 'mp3' | 'audio';
  defaultBitrate: 128 | 192 | 256 | 320;
  filenameStyle: FilenameStyle;
  openFolderAfter: boolean;
  maxConcurrent: number;
  theme: Theme;
  clipboardWatch: boolean;
  notifications: boolean;
  embedMetadata: boolean;
  cookiesFromBrowser: CookieBrowser;
  /** use NVIDIA NVENC in the converter (only after it passes the test) */
  useGpu: boolean;
}

export interface VideoOption {
  key: string;
  height: number;
  width?: number;
  fps?: number;
  label: string; // "1080p"
  codec: string; // "H.264", "VP9", "AV1"
  /** format id used for MP4 (prefers H.264 for compatibility) */
  mp4FormatId: string;
  mp4Codec: string;
  mp4Size?: number;
  mp4HasAudio: boolean;
  /** best format id at this resolution, any codec (for MKV) */
  bestFormatId: string;
  bestSize?: number;
  bestHasAudio: boolean;
}

export interface AudioOption {
  formatId: string;
  ext: string;
  codec: string;
  abr?: number;
  size?: number;
  note?: string;
}

export interface MediaInfo {
  url: string;
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  site: string;
  isLive: boolean;
  videoOptions: VideoOption[];
  audioOptions: AudioOption[];
  bestAudioSize?: number; // size of the audio track merged into MP4
  bestAudioSizeAny?: number;
  formatCount: number;
  /** set when a single-video link also points to a playlist (…watch?v=X&list=Y) */
  playlistUrl?: string;
  /** set when yt-dlp warns that its YouTube challenge solver failed (usually: yt-dlp outdated) */
  outdatedWarning?: boolean;
}

export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

export interface PlaylistInfo {
  url: string;
  title: string;
  uploader?: string;
  entries: PlaylistEntry[];
  /** private / deleted items that were left out */
  skipped: number;
  /** a list of links pasted by the user, not a real playlist */
  isList?: boolean;
  /** pasted links that could not be read */
  failed?: FailedLink[];
}

export interface FailedLink { url: string; error: string }

export type BatchResult = { ok: true; playlist: PlaylistInfo } | { ok: false; error: string; failed?: FailedLink[] };

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'paused' | 'completed' | 'error' | 'canceled';

export interface DownloadRequest {
  url: string;
  title: string;
  thumbnail?: string;
  uploader?: string;
  duration?: number;
  mode: DownloadMode;
  formatSpec: string;
  qualityLabel: string; // "1080p 60fps", "320 kbps", "M4A 129 kbps"
  bitrate?: number;
  expectedSize?: number;
  outputDir?: string;
  height?: number;
  /** yt-dlp -S expression */
  formatSort?: string;
  /** items queued together (a playlist) are announced once, when all of them end */
  batchId?: string;
  batchTitle?: string;
  batchKind?: 'list';
  /** puts the video id in the file name, for items of a batch that share a title */
  nameWithId?: boolean;
}

export interface Job extends DownloadRequest {
  id: string;
  status: JobStatus;
  progress: number; // 0..100
  downloaded: number;
  total?: number;
  speed?: number;
  eta?: number;
  stage?: string; // "Baixando vídeo", "Convertendo para MP3"...
  filePath?: string;
  error?: string;
  errorDetail?: string;
  createdAt: number;
  finishedAt?: number;
  outputDir: string;
  usedFallback?: boolean;
  nameSuffix?: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  filePath: string;
  thumbnail?: string; // local cached thumb (thumb://) or remote url
  uploader?: string;
  mode: DownloadMode;
  qualityLabel: string;
  size?: number;
  date: number;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'warn' | 'error';
  scope: string;
  msg: string;
}

export interface ToolStatus {
  ytdlp: { ok: boolean; path: string; version?: string; error?: string };
  ffmpeg: { ok: boolean; path: string; version?: string; error?: string };
}

export type AnalyzeResult =
  | { ok: true; info: MediaInfo; playlist?: undefined }
  | { ok: true; playlist: PlaylistInfo; info?: undefined }
  | { ok: false; error: string; detail?: string };

export type ProbeResult = { ok: true; probe: MediaProbe } | { ok: false; error: string };
export type HardwareResult = { ok: true; hardware: Hardware } | { ok: false; error: string };

export type LegalDoc = 'privacy' | 'terms' | 'notices' | 'license' | 'thirdParty' | 'signing';

export interface Api {
  getUpdate(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  cancelUpdate(): Promise<void>;
  installUpdate(): Promise<{ ok: boolean; error?: string }>;
  openReleasePage(): Promise<void>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  readDoc(doc: LegalDoc): Promise<string>;
  openProjectLink(link: 'issues' | 'repo'): Promise<void>;

  pickVideo(): Promise<string | null>;
  /** real path of a dropped or picked File (Electron no longer exposes File.path) */
  pathForFile(file: File): string;
  probeVideo(path: string): Promise<ProbeResult>;
  detectHardware(force: boolean): Promise<HardwareResult>;
  startConversion(req: ConvertRequest): Promise<{ ok: boolean; error?: string }>;
  cancelConversion(): Promise<void>;
  estimateConversion(input: string, settings: ConvertSettings, pref: EncoderPref, gpuEnabled: boolean): Promise<{ min: number; max: number } | { error: string }>;
  getConversion(): Promise<ConvertState>;
  onConversion(cb: (s: ConvertState) => void): () => void;

  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  pickFolder(current?: string): Promise<string | null>;
  pickFile(current?: string): Promise<string | null>;
  checkTools(): Promise<ToolStatus>;
  detectTools(): Promise<Settings>;
  updateYtdlp(): Promise<{ ok: boolean; output: string }>;

  analyze(url: string): Promise<AnalyzeResult>;
  cancelAnalyze(): Promise<void>;
  analyzeBatch(urls: string[]): Promise<BatchResult>;
  onBatchProgress(cb: (p: { done: number; total: number }) => void): () => void;

  enqueue(req: DownloadRequest): Promise<Job>;
  enqueueMany(reqs: DownloadRequest[]): Promise<number>;
  listJobs(): Promise<Job[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  removeJob(id: string): Promise<void>;
  clearFinished(): Promise<void>;
  onJobs(cb: (jobs: Job[]) => void): () => void;

  listHistory(): Promise<HistoryItem[]>;
  removeHistory(id: string, deleteFile: boolean): Promise<{ ok: boolean; error?: string }>;
  clearHistory(): Promise<void>;
  onHistory(cb: (items: HistoryItem[]) => void): () => void;

  openFile(p: string): Promise<string>;
  showInFolder(p: string): Promise<void>;
  openFolder(p: string): Promise<string>;
  fileExists(p: string): Promise<boolean>;

  getLogs(): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  onLog(cb: (e: LogEntry) => void): () => void;
  exportLogs(): Promise<string | null>;

  onClipboardUrl(cb: (url: string) => void): () => void;
  readClipboard(): Promise<string>;
  onNavigate(cb: (page: string) => void): () => void;
  setTitleBarTheme(dark: boolean): void;
}
