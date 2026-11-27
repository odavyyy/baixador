// Writes THIRD_PARTY_NOTICES.md from the license files of the packages that ship inside the app.
// Usage: node scripts/notices.mjs   (run after `npm ci`)
import fs from 'node:fs';
import path from 'node:path';

const SHIPPED = [
  ['electron', 'Base do aplicativo (inclui Chromium e Node.js; os avisos vão em LICENSES.chromium.html, ao lado do app)'],
  ['react', 'Interface'],
  ['react-dom', 'Interface'],
  ['scheduler', 'Dependência do react-dom'],
  ['lucide-react', 'Ícones'],
  ['@fontsource-variable/inter', 'Fonte Inter (arquivos incluídos no app)'],
];

const findLicense = (dir) => fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.md|\.txt)?$/i.test(f));

let out = `# Avisos de terceiros

O Baixador é distribuído sob a Licença MIT (veja LICENSE). O app empacotado também contém os programas
de terceiros listados abaixo. Os textos das licenças ficam no original, em inglês. Este arquivo é gerado
por \`scripts/notices.mjs\`.

Não incluídos: o **yt-dlp** e as ferramentas de linha de comando do **FFmpeg** (ffmpeg.exe e ffprobe.exe)
*não* são incluídos nem redistribuídos com o Baixador. O app usa as cópias que você instalou, sob as
licenças delas (yt-dlp: Unlicense; FFmpeg: LGPL ou GPL, conforme a compilação).

Observação: o próprio Electron inclui o \`ffmpeg.dll\`, a compilação LGPL das bibliotecas do FFmpeg que o
Chromium usa para reproduzir mídia. O Baixador não o chama; ele faz parte do Electron e está coberto por
LICENSES.chromium.html.

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
`;
const texts = [];
for (const [name, use] of SHIPPED) {
  const dir = path.join('node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  out += `| ${name} | ${pkg.version} | ${pkg.license} | ${use} |\n`;
  const lic = findLicense(dir);
  texts.push(`## ${name} ${pkg.version}\n\n\`\`\`\n${lic ? fs.readFileSync(path.join(dir, lic), 'utf8').trim() : `License: ${pkg.license} (no license file in package)`}\n\`\`\`\n`);
}
out += '\n' + texts.join('\n');
fs.writeFileSync('THIRD_PARTY_NOTICES.md', out);
console.log('THIRD_PARTY_NOTICES.md written');
