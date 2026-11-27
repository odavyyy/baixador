# Preparação para assinatura digital

Situação: **nada é assinado hoje**. Este guia lista o que fazer **se** o projeto for aprovado por um serviço
de assinatura como a SignPath Foundation. A regra completa está em
[CODE_SIGNING_POLICY.md](../CODE_SIGNING_POLICY.md).

## Já preparado no repositório

- Workflow [`build.yml`](../.github/workflows/build.yml) em runner do GitHub, sem publicação automática.
- Conferência do nome do produto e da versão gravados nos executáveis.
- Etapa de assinatura **desligada** até existirem as variáveis e o segredo.

> O workflow ainda não foi executado no GitHub. A etapa de assinatura só poderá ser testada com uma conta
> aprovada.

## Falta fazer depois de uma aprovação

1. Ativar autenticação em dois fatores no GitHub e na SignPath.
2. Instalar o app da SignPath no repositório e ligar o sistema de build "GitHub.com" ao projeto.
3. Na SignPath, criar o projeto, a política de assinatura com aprovação manual e verificação de origem, e duas
   configurações de artefato:
   - `app-folder`: assina somente `Baixador.exe` dentro da pasta do app. As DLLs do Electron são binários de
     terceiros e não devem ser assinadas.
   - `installer`: assina `Baixador-Setup-<versão>.exe`.
   As duas devem exigir o produto `Baixador` e a mesma versão.
4. Criar no GitHub as variáveis `SIGNPATH_ENABLED`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
   `SIGNPATH_POLICY_SLUG` e o segredo `SIGNPATH_API_TOKEN`.
5. Só então incluir no README, na página de download e nas notas de release o texto de atribuição exigido pela
   SignPath.

## Limitação conhecida

O desinstalador é criado pelo NSIS **dentro** do instalador, durante o empacotamento, então não passa pelas
duas assinaturas acima. Isso precisa ser resolvido com a SignPath (por exemplo, com a configuração de artefato
que eles indicarem para instaladores NSIS) antes de afirmar que todos os executáveis do projeto são assinados.

## Atualizador

Quando houver assinatura, vale fazer o atualizador exigir também uma assinatura válida do mesmo publicador,
além do SHA-256.
