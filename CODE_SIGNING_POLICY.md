# Code signing policy

> **Current status: Baixador binaries are NOT code-signed.** The project has not been accepted by any code
> signing program. This document describes how builds are made today and what is planned.
>
> **Situação atual: os executáveis do Baixador NÃO têm assinatura digital.** O projeto não foi aceito em
> nenhum programa de assinatura. Este documento descreve como os builds são feitos hoje e o que está planejado.

## Project and roles

- Repository: <https://github.com/odavyyy/baixador> (MIT License)
- Maintainer: [@odavyyy](https://github.com/odavyyy). The project has a single maintainer.

| Role | Who | Responsibility |
|---|---|---|
| Authors (committers) | @odavyyy | Can change the source code in the repository |
| Reviewers | @odavyyy | Review every change proposed by someone else (pull requests) before it is merged |
| Approvers | @odavyyy | Approve each release and, once signing exists, each signing request manually |

AI tools were used to write much of the code and documentation. They have no repository, signing or approval
rights; the maintainer is responsible for what is published.

## How builds are produced

- **Releases published so far** were built on the maintainer's Windows computer from the tagged source with
  `npm ci` and `npm run dist`. Each release lists SHA-256 checksums in `SHA256SUMS.txt`. This only shows that a
  download matches the published file; it does not prove how the file was built.
- **Planned:** release binaries built by GitHub Actions on GitHub-hosted Windows runners, using
  [`.github/workflows/build.yml`](.github/workflows/build.yml). The workflow only uploads build artifacts. It
  never publishes a release by itself.
- Dependencies are pinned by `package-lock.json`.

## What would be signed

Only binaries built from this repository: `Baixador.exe` and the installer `Baixador-Setup-<version>.exe`.
Upstream binaries that are part of Electron (such as `ffmpeg.dll`) are not signed with this project's
certificate. yt-dlp and FFmpeg are not distributed with the app. All signed files must carry the product name
`Baixador` and the release version in their file metadata.

## Planned signing process (only after approval)

1. A version tag is pushed; GitHub Actions builds from that commit on a GitHub-hosted runner.
2. The unsigned build is uploaded as a workflow artifact and submitted for signing.
3. The approver reviews the commit and approves the signing request **manually**.
4. The workflow verifies the signature (`Get-AuthenticodeSignature`) and fails if it is not valid.
5. Packages and `SHA256SUMS.txt` are created from the signed files.
6. The maintainer checks the artifacts and publishes the GitHub release manually.

## Protection of certificates and credentials

- No private key, certificate or token is stored in the repository or in the app.
- With a hosted signing service, the private key stays with the service and the maintainer never receives it.
- The service API token would be kept only as a GitHub Actions secret, used only by the signing job. Pull
  requests from forks do not receive repository secrets.
- Multi-factor authentication is required on every account that can change the repository or approve signing.

## Privacy

[Privacy policy](PRIVACY.md). This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it. Third-party services contacted at
the user's request are listed in the privacy policy.

## Installing, system changes and removal

The installer asks where to install and creates Start menu and desktop shortcuts. It can be removed from
Windows *Settings → Apps*. The portable version is removed by deleting its folder. Settings and history in
`%APPDATA%\Baixador` are kept unless you delete that folder.

## Reporting a problem

See [SECURITY.md](SECURITY.md). If you believe a distributed binary was not built from this source or was
tampered with, report it before running it.
