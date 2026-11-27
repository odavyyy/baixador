// Update rules: which releases count, which files are expected and how they are verified. Pure functions.

export const REPO = 'odavyyy/baixador';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export type InstallKind = 'installed' | 'portable' | 'dev';

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  /** "sha256:…" as reported by the GitHub API */
  digest?: string;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  publishedAt?: string;
  page: string;
  /** the file that matches how this copy is installed */
  asset?: ReleaseAsset;
  sums?: ReleaseAsset;
}

export type UpdateStatus =
  | 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  current: string;
  kind: InstallKind;
  info?: UpdateInfo;
  received?: number;
  total?: number;
  speed?: number;
  error?: string;
  /** why this copy can't install by itself (the release page is offered instead) */
  manualReason?: string;
  /** message about the previous update attempt, shown once */
  lastResult?: { ok: boolean; message: string };
  checkedAt?: number;
}

const STABLE = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

export function parseVersion(v: string): [number, number, number] | null {
  const m = STABLE.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0 when a is newer than b. Throws on invalid input so nothing is compared by accident. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error('versão inválida');
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export const assetName = (kind: InstallKind, version: string) =>
  kind === 'installed' ? `Baixador-Setup-${version}.exe` : `Baixador-${version}-win-x64.zip`;

/**
 * Turns the GitHub "latest release" JSON into an UpdateInfo. Drafts, prereleases and tags that aren't
 * plain vX.Y.Z are ignored. Asset URLs must point to this repository's release downloads.
 */
export function readRelease(json: any, kind: InstallKind, downloadBase = `https://github.com/${REPO}/releases/download/`): UpdateInfo | { ignored: string } {
  if (!json || typeof json !== 'object') return { ignored: 'resposta inválida' };
  if (json.draft !== false) return { ignored: 'rascunho' };
  if (json.prerelease !== false) return { ignored: 'pré-lançamento' };
  const tag = String(json.tag_name ?? '');
  if (!/^v\d/.test(tag) || !parseVersion(tag)) return { ignored: `tag fora do padrão: ${tag.slice(0, 40)}` };
  const version = tag.slice(1);
  const find = (name: string): ReleaseAsset | undefined => {
    const a = (Array.isArray(json.assets) ? json.assets : []).find((x: any) => x?.name === name && x.state !== 'starter');
    if (!a || a.browser_download_url !== `${downloadBase}${tag}/${name}` || !(Number(a.size) > 0)) return undefined;
    return { name, size: Number(a.size), url: a.browser_download_url, digest: typeof a.digest === 'string' ? a.digest : undefined };
  };
  return {
    version,
    notes: String(json.body ?? '').slice(0, 20000),
    publishedAt: typeof json.published_at === 'string' ? json.published_at : undefined,
    page: `${RELEASES_PAGE}/tag/${tag}`,
    asset: find(assetName(kind, version)),
    sums: find('SHA256SUMS.txt'),
  };
}

/** The expected hash of `name` in a "sha256sum" style file. */
export function hashFromSums(text: string, name: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return undefined;
}
