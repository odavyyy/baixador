# Histórico de versões

## 1.4.0 (28/11/2026)

- Novo: **atualização em um clique**. **Atualizar app** (ou **Atualizar agora**) baixa, confere o SHA-256,
  instala e reabre o Baixador, sem as etapas separadas de baixar, instalar e confirmar.
- Correção: quando o GitHub recusa a consulta pelo limite de pedidos, o app usa a página pública de releases.
  Nesse caso as notas da versão não aparecem no app; a conferência pelo `SHA256SUMS.txt` continua obrigatória.

## 1.3.0 (28/11/2026)

- Novo: **download em lote**. Cole vários links de uma vez (até 100), escolha os itens, o formato e a pasta.
  Links de playlist entram com todos os itens, links repetidos são ignorados e os que falham aparecem com o motivo.
- Novo: **pasta de download preferida**. Ao trocar a pasta na tela de download, o botão "Usar sempre esta pasta"
  a salva para os próximos. Sem clicar nele, a troca vale só daquela vez.
- Correção: vídeos diferentes com o mesmo título recebem o ID no nome, em vez de um deles aparecer como
  concluído apontando para o arquivo do outro.

## 1.2.0 (27/11/2026)

- Novo: **Conversor** de vídeos com FFmpeg, presets (incluindo WhatsApp até 180 MB), modo personalizado, teste real
  da aceleração NVIDIA NVENC e alternativa pela CPU.
- Novo: **atualização pelo próprio app** (instalada e portátil), com verificação SHA-256 e confirmação.
- Novo: política de privacidade, termos, avisos de conteúdo e marcas, política de assinatura e de segurança.
- Segurança: links passados ao yt-dlp depois de "--"; "Abrir arquivo" restrito a arquivos do próprio app;
  registros com mais de 14 dias são apagados; verificação ortográfica do Chromium desativada.
- Inclui as mudanças da 1.1.0, que não chegou a ser publicada:

### 1.1.0 (não publicada)


- Novo: download de playlists e álbuns, com seleção de itens, áudio ou vídeo e pasta com o nome da playlist.
- Novo: botão "Ver playlist inteira" em links de vídeo que também fazem parte de uma playlist.
- Novo: opção de MP3 em VBR máxima para playlists.
- A playlist gera um único aviso quando termina, e a pasta é aberta uma vez só (se essa opção estiver ativa).
- Correção: arquivos com acento no título eram baixados, mas apareciam como erro.

## 1.0.0 (27/11/2026)

Primeira versão pública.

- Cole um link, analise com o yt-dlp e escolha na lista real de resoluções, taxas de quadros e faixas de áudio.
- MP4 (priorizando H.264), MKV (vídeo e áudio originais), MP3 de 128 a 320 kbps com capa e áudio original sem conversão.
- Fila com downloads simultâneos, progresso, velocidade e tempo restante reais, pausar e continuar, cancelar e tentar de novo.
- Histórico, downloads recentes, detecção de links copiados e notificações do Windows.
- Configurações: pasta de destino, padrões, nome dos arquivos, tema e cookies do navegador (opcional).
- Detecção automática do yt-dlp e do FFmpeg (C:\yt-dlp, C:\ffmpeg, winget, Scoop, Chocolatey e PATH).
- Tela de diagnóstico com as versões das ferramentas, o botão "Atualizar yt-dlp" e o registro técnico.
- Instalador para Windows (NSIS) e versão portátil em zip.
