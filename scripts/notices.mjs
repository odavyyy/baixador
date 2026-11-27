// Writes THIRD_PARTY_NOTICES.md. The list of packages is taken from what the bundlers really include,
// so a new dependency can't be left out by accident. Usage: npm run notices
import fs from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const found = new Set();
const packageOf = (id) => {
  const i = id.replace(/\\/g, '/').lastIndexOf('node_modules/');
  if (i < 0) return;
  const parts = id.replace(/\\/g, '/').slice(i + 13).split('/');
  found.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
};

for (const entry of ['src/main/main.ts', 'src/main/preload.ts']) {
  const r = await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', external: ['electron'], write: false, metafile: true, logLevel: 'silent' });
  Object.keys(r.metafile.inputs).forEach(packageOf);
}
await vite({
  configFile: 'vite.config.mts', logLevel: 'silent', build: { write: false },
  plugins: [{ name: 'collect', buildEnd() { for (const id of this.getModuleIds()) if (!id.startsWith('\0')) packageOf(id); } }],
});
// not visible as modules: the runtime itself, and the base CSS Tailwind writes into the stylesheet
found.add('electron');
found.add('tailwindcss');

const USE = {
  electron: 'Base do aplicativo (inclui Chromium e Node.js; os avisos vão em LICENSES.chromium.html, ao lado do app)',
  react: 'Interface', 'react-dom': 'Interface', scheduler: 'Dependência do react-dom', 'lucide-react': 'Ícones',
  '@fontsource-variable/inter': 'Fonte Inter (arquivos incluídos no app)', tailwindcss: 'CSS base incluído na folha de estilos',
};

const findLicense = (dir) => fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.md|\.txt)?$/i.test(f));

let out = `# Avisos de terceiros

O Baixador é distribuído sob a Licença MIT (veja LICENSE). O app empacotado também contém os programas
de terceiros listados abaixo. Os textos das licenças ficam no original, em inglês. Este arquivo é gerado
por \`scripts/notices.mjs\`.

Não incluídos: o **yt-dlp** e as ferramentas de linha de comando do **FFmpeg** (ffmpeg.exe e ffprobe.exe)
*não* são incluídos nem redistribuídos com o Baixador. O app usa as cópias que você instalou, sob as
licenças delas (yt-dlp: Unlicense, com componentes de outras licenças em algumas distribuições;
FFmpeg: LGPL ou GPL, conforme a compilação).

Observação: o próprio Electron inclui o \`ffmpeg.dll\`, a compilação LGPL das bibliotecas do FFmpeg que o
Chromium usa para reproduzir mídia. O Baixador não o chama; ele faz parte do Electron e está coberto por
LICENSES.chromium.html.

O instalador é gerado com o NSIS (licença zlib/libpng), por meio do electron-builder (MIT).

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
`;
const texts = [];
for (const name of [...found].sort()) {
  const dir = path.join('node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  out += `| ${name} | ${pkg.version} | ${pkg.license} | ${USE[name] ?? 'Dependência incluída no app'} |\n`;
  const lic = findLicense(dir);
  if (!lic) console.warn('sem arquivo de licença:', name);
  texts.push(`## ${name} ${pkg.version}\n\n\`\`\`\n${lic ? fs.readFileSync(path.join(dir, lic), 'utf8').trim() : `License: ${pkg.license} (no license file in package)`}\n\`\`\`\n`);
}
out += '\n' + texts.join('\n');
fs.writeFileSync('THIRD_PARTY_NOTICES.md', out);
console.log(`THIRD_PARTY_NOTICES.md: ${[...found].sort().join(', ')}`);
