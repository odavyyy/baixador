# Política de Privacidade do Baixador

Última atualização: 28 de novembro de 2026 (versão 1.4.0)

O Baixador é um programa que roda no seu computador. Ele **não tem servidor próprio, conta, cadastro,
anúncios, telemetria nem relatórios de erro automáticos**. O mantenedor do projeto não recebe, não vê e não
guarda nada do que você faz no app.

> This program will not transfer any information to other networked systems unless specifically requested by
> the user or the person installing or operating it.
>
> (Em resumo: o app só acessa a internet quando você pede algo que depende dela.)

## O que fica guardado no seu computador

Tudo fica na pasta `%APPDATA%\Baixador`:

| Dado | Para quê |
|---|---|
| `settings.json`: pastas, caminhos do yt-dlp e do FFmpeg, preferências | Lembrar suas configurações |
| `history.json` e pasta `thumbs`: título, link, canal, caminho do arquivo, data e capa de cada download | Tela Histórico |
| `jobs.json`: lista de downloads (links, títulos, caminhos e mensagens de erro) | Tela Downloads, inclusive depois de fechar o app |
| Pasta `logs`: registro técnico com links, comandos e caminhos de arquivos (que podem incluir o seu nome de usuário do Windows) | Diagnosticar problemas. Registros com mais de **14 dias** são apagados |
| Dados internos do Electron/Chromium (cache, armazenamento local) | Funcionamento da interface e cache das capas |

Nas conversões, os vídeos são lidos e gravados apenas no seu computador. Durante a conversão podem ser
criados arquivos temporários, que são apagados ao terminar ou cancelar. O histórico de conversões não é salvo
em um arquivo próprio, mas os nomes dos arquivos aparecem no registro técnico.

**Área de transferência:** com a opção "Detectar links copiados" ligada (padrão), o app lê o texto copiado
a cada segundo para saber se é um link. O conteúdo não é salvo nem enviado. Você pode desligar em
Configurações.

## Quando o app acessa a internet

| Ação sua | Quem recebe a conexão |
|---|---|
| Analisar um link ou uma lista de links, ou baixar | O site do link, por meio do **yt-dlp** instalado no seu computador |
| Analisar um link, uma lista de links ou uma playlist, ou baixar | O servidor de imagens do site, para carregar e salvar as capas. Depois de fechar o app, a lista de downloads e o histórico usam só as cópias salvas |
| **Atualizar app**, **Atualizar agora** ou **Só verificar** (botões em Configurações) | **GitHub** (`api.github.com`, `github.com` e `*.githubusercontent.com`) |
| **Atualizar yt-dlp** (Diagnóstico) | Os servidores usados pelo comando `yt-dlp -U` |
| Abrir um link do projeto | Seu navegador |

O app não verifica atualizações sozinho. Como em qualquer conexão, quem recebe vê o seu endereço IP e dados
técnicos do pedido. Esses serviços têm políticas próprias, que o Baixador não controla:
[GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[Google/YouTube](https://policies.google.com/privacy) e as dos outros sites que você acessar.

**Cookies:** o Baixador não cria cookies de rastreamento nem tem site próprio. A opção **Usar cookies do
navegador** vem desligada. Se você a ligar, o yt-dlp lê os cookies do navegador escolhido e os usa para
acessar o site do link, como se fosse você. Ligue apenas se precisar.

O yt-dlp e o FFmpeg são programas separados, instalados por você.

## Seus controles

- **Histórico → Limpar histórico** apaga os registros e as capas salvas. Os arquivos baixados não são apagados.
- **Downloads → Limpar lista** remove os itens finalizados.
- **Diagnóstico → Limpar** limpa o registro mostrado na tela. Os arquivos de log ficam em
  `%APPDATA%\Baixador\logs`.
- Para apagar tudo, feche o app e apague a pasta `%APPDATA%\Baixador`. **Desinstalar o app não apaga essa
  pasta** nem os seus downloads.

Antes de compartilhar um log (por exemplo, em uma issue), confira se não há links privados ou o seu nome em
caminhos de arquivos.

## Contato

Dúvidas e pedidos sobre privacidade podem ser enviados pelas
[Issues do projeto](https://github.com/odavyyy/baixador/issues). As issues são **públicas**: não escreva
dados pessoais nelas. Como o mantenedor não recebe dados do app, não há dados seus a consultar ou apagar do
lado dele.

Mudanças nesta política ficam registradas no histórico do repositório.
