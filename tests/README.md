# Testes

## Atualizador (`npm run test:updater`)

Cenários **simulados**: um servidor falso em `127.0.0.1` provoca rascunho, pré-lançamento, queda de conexão,
arquivo incompleto, hash errado, redirecionamento indevido e outros. Com `-- --real`, o mesmo código também
consulta e baixa a release publicada no GitHub (cerca de 270 MB).

A instalação em si (instalador e troca da pasta portátil) é testada manualmente com o app empacotado.

## Conversor (`npm run test:convert -- <pasta> [filtro]`)

Usa o FFmpeg instalado, sem simulações, e confere cada saída com o ffprobe. A pasta precisa ter:

| Arquivo | Conteúdo |
|---|---|
| `longo.mp4` | vídeo real de ~10 min, 720p60, com áudio |
| `curto.mp4` | trecho de ~15 s |
| `alta-resolucao-4k.mp4` | ~40 s em 4K60 com bitrate alto |
| `sem-audio.mp4` | vídeo sem áudio |
| `Vídeo de TESTE — ção & #1 [é] 'aspas' 100%.mp4` | nome com caracteres especiais |
| `invalido.mp4` | um arquivo de texto renomeado |
| `corrompido-sem-indice.mp4` | MP4 cortado antes do índice |
| `corrompido-truncado.mp4` | MP4 com índice no início, cortado no meio |
| `vertical-rotacionado.mp4` | vídeo com rotação de 90° nos metadados |
| `hdr-pq.mp4` | vídeo marcado como HDR (PQ) |
| `grande-5k.mp4` | 5120×2880 (acima do limite do H.264 NVENC) |
| `fonte.webm` | VP9 + Opus |

Os testes de GPU só rodam se o NVENC passar na detecção.
