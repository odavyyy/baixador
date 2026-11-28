import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Api } from '../shared/types';

const on = (ch: string) => (cb: (...a: any[]) => void) => {
  const fn = (_e: unknown, ...a: any[]) => cb(...a);
  ipcRenderer.on(ch, fn);
  return () => { ipcRenderer.removeListener(ch, fn); };
};
const inv = (ch: string) => (...a: any[]) => ipcRenderer.invoke(ch, ...a);

const api: Api = {
  getUpdate: inv('update:state'),
  checkUpdate: inv('update:check'),
  downloadUpdate: inv('update:download'),
  cancelUpdate: inv('update:cancel'),
  installUpdate: inv('update:install'),
  updateNow: inv('update:now'),
  openReleasePage: inv('update:page'),
  onUpdate: on('update:update'),
  readDoc: inv('docs:read'),
  openProjectLink: inv('project:link'),
  pickVideo: inv('convert:pick'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  probeVideo: inv('convert:probe'),
  detectHardware: inv('convert:hardware'),
  startConversion: inv('convert:start'),
  cancelConversion: inv('convert:cancel'),
  estimateConversion: inv('convert:estimate'),
  getConversion: inv('convert:state'),
  onConversion: on('convert:update'),
  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  pickFolder: inv('dialog:folder'),
  pickFile: inv('dialog:file'),
  checkTools: inv('tools:check'),
  detectTools: inv('tools:detect'),
  updateYtdlp: inv('tools:update'),
  analyze: inv('analyze'),
  cancelAnalyze: inv('analyze:cancel'),
  analyzeBatch: inv('analyze:batch'),
  onBatchProgress: on('batch:progress'),
  enqueue: inv('jobs:enqueue'),
  enqueueMany: inv('jobs:enqueueMany'),
  listJobs: inv('jobs:list'),
  pause: inv('jobs:pause'),
  resume: inv('jobs:resume'),
  cancel: inv('jobs:cancel'),
  retry: inv('jobs:retry'),
  removeJob: inv('jobs:remove'),
  clearFinished: inv('jobs:clear'),
  onJobs: on('jobs:update'),
  listHistory: inv('history:list'),
  removeHistory: inv('history:remove'),
  clearHistory: inv('history:clear'),
  onHistory: on('history:update'),
  openFile: inv('shell:openFile'),
  showInFolder: inv('shell:showInFolder'),
  openFolder: inv('shell:openFolder'),
  fileExists: inv('fs:exists'),
  getLogs: inv('logs:get'),
  clearLogs: inv('logs:clear'),
  onLog: on('log:entry'),
  exportLogs: inv('logs:export'),
  onClipboardUrl: on('clipboard:url'),
  readClipboard: inv('clipboard:read'),
  onNavigate: on('navigate'),
  setTitleBarTheme: (dark: boolean) => ipcRenderer.send('titlebar:theme', dark),
};

contextBridge.exposeInMainWorld('api', api);
