# Histórico de versões

## 1.1.0 (27/11/2026)

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
