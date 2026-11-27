// Renders the project artwork with Electron's offscreen renderer:
//   build/icon.svg        -> build/icon.png, src/renderer/public/icon.png (512x512)
//   docs/art/banner.html  -> docs/banner.png (1280x640, GitHub social preview)
// Usage: npx electron scripts/render-art.cjs
// (build/icon.ico is assembled from icon.png; see README > "Regenerating the artwork")
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep running between captures

async function capture(target, width, height) {
  const w = new BrowserWindow({ width, height, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  w.webContents.setZoomFactor(1);
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => console.warn('load failed', code, desc, url, isMain));
  try {
    if (target.file) await w.loadFile(target.file); else await w.loadURL(target);
  } catch (e) {
    console.warn(String(e));
  }
  await new Promise((r) => setTimeout(r, 1500)); // fonts + images
  const img = await w.capturePage({ x: 0, y: 0, width, height });
  w.destroy();
  return img.resize({ width, height, quality: 'best' }).toPNG();
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');
  const icon = await capture('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`), 512, 512);
  fs.writeFileSync(path.join(root, 'build/icon.png'), icon);
  fs.writeFileSync(path.join(root, 'src/renderer/public/icon.png'), icon);

  const banner = await capture({ file: path.join(root, 'docs/art/banner.html') }, 1280, 640);
  fs.writeFileSync(path.join(root, 'docs/banner.png'), banner);
  console.log('artwork written');
  app.quit();
});
