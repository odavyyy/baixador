# Segurança

## Versões com correções

Apenas a versão mais recente recebe correções.

## Como avisar sobre uma falha

Abra uma [issue](https://github.com/odavyyy/baixador/issues) **sem detalhes que permitam explorar a falha**
(descreva só a área afetada e peça um canal privado). Não publique links privados, cookies, logs com dados
pessoais nem provas de conceito.

## O que o app faz para se proteger

- A interface roda isolada (`contextIsolation`, `sandbox`, sem Node.js), com política de conteúdo restritiva e
  sem permissão para navegar para outras páginas.
- O yt-dlp e o FFmpeg são chamados sem interpretador de comandos. Links são passados depois de `--`.
- O atualizador só aceita endereços do GitHub (inclusive após redirecionamentos), exige o `SHA256SUMS.txt`,
  não instala versões iguais ou antigas, confere o arquivo de novo antes de executar e pede confirmação.

## Limitações conhecidas

- Os executáveis não têm assinatura digital.
- O SHA-256 vem da mesma release que o arquivo. Se a conta do GitHub do projeto fosse invadida, o invasor
  poderia trocar os dois.
- O app executa o yt-dlp e o FFmpeg nos caminhos configurados. Use apenas cópias obtidas das fontes oficiais.
