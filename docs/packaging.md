# Packaging

## Scope

Release packaging is driven by Wails v3 Taskfiles under `build/` and GitHub Actions on tags `v*`.

## Artifacts

- Linux amd64/arm64: binary/deb/rpm/AppImage/Flatpak published as `mssh-VERSION-linux-ARCH[.deb|.rpm|.AppImage|.flatpak]`
- Windows amd64/arm64: exe, NSIS installer
- macOS: arm64 + amd64 `.app` zip (native runners)

## Versioning

Git tag `vX.Y.Z` is the version source. CI injects:

- `github.com/xuthus5/mssh/internal/service.Version`
- package metadata in `build/config.yml`, nfpm, Windows resources, and macOS Info.plist

Local untagged builds default to `0.1.0`.

## Local commands

```bash
wails3 task build
wails3 task package
wails3 task package:linux:amd64
wails3 task package:linux:flatpak
```

Packages are unsigned in the first release pipeline.

## Flatpak

App ID: `io.github.xuthus5.mssh` (Flathub reverse-DNS for GitHub projects).

Native desktop product identifier remains `com.mssh.app` on Windows/macOS.

### Layout

| Path | Purpose |
|------|---------|
| `build/linux/flatpak/io.github.xuthus5.mssh.yml` | Local/CI source build inside GNOME SDK |
| `build/linux/flatpak/io.github.xuthus5.mssh.flathub.yml` | Flathub source-build template |
| `build/linux/flatpak/io.github.xuthus5.mssh.metainfo.xml` | AppStream metadata |
| `build/linux/flatpak/io.github.xuthus5.mssh.desktop` | Desktop entry |
| `build/linux/flatpak/icons/` | hicolor icons |
| `build/linux/flatpak/build.sh` | Build `.flatpak` bundle |

### Build a local bundle

```bash
# prerequisites: flatpak, flatpak-builder, GNOME Platform/SDK 49 (fallback 48)
# Optional: speed up Flathub downloads behind a proxy
export https_proxy=http://127.0.0.1:1080 http_proxy=http://127.0.0.1:1080
wails3 task linux:build PRODUCTION=true APP_VERSION=0.0.1
wails3 task linux:create:flatpak APP_VERSION=0.0.1
# → bin/mssh-0.0.1-linux-amd64.flatpak
flatpak install --user bin/mssh-0.0.1-linux-amd64.flatpak
flatpak run io.github.xuthus5.mssh
```

### finish-args rationale

- `network` — SSH/SFTP and optional Gist sync
- `wayland` / `fallback-x11` / `dri` — Wails WebView UI
- `org.freedesktop.secrets` — master key via secret service
- `ssh-auth` — host SSH agent
- `filesystem=home` — keys, known_hosts, downloads/uploads (SSH client workflows)

### Flathub submission

Flathub does **not** accept a random `.flatpak` upload. Submit a PR to [flathub/flathub](https://github.com/flathub/flathub):

1. Fork `flathub/flathub` and create branch `io.github.xuthus5.mssh`.
2. Copy `build/linux/flatpak/io.github.xuthus5.mssh.flathub.yml` as the root manifest
   (`io.github.xuthus5.mssh.yml`) plus desktop/metainfo/icons as needed.
3. Point the git source at a **signed release tag** and fill any archive sha256.
4. Prepare offline dependencies for Flathub bots:
   - Go: commit a `vendor/` directory, or generate a Flatpak `generated-sources.json`
     via [flatpak-go-mod](https://github.com/dennwc/flatpak-go-mod) / similar tooling.
   - npm: generate sources with [flatpak-node-generator](https://github.com/flatpak/flatpak-builder-tools)
     (or ship a release tarball that already contains `frontend/dist`).
5. Run validators locally:

```bash
appstreamcli validate build/linux/flatpak/io.github.xuthus5.mssh.metainfo.xml
flatpak-builder --user --force-clean /tmp/mssh-fp-build \
  build/linux/flatpak/io.github.xuthus5.mssh.flathub.yml
# optional: flatpak-builder-lint manifest ...
```

6. Open the Flathub PR; address review on permissions, metainfo screenshots, and
   runtime version. Screenshots can be added under `release` assets and referenced
   from metainfo once available.

7. After merge, Flathub builds and publishes `io.github.xuthus5.mssh`.

### Notes

- First packaging used prebuilt-binary bundling for release assets; Flathub prefers
  building from source inside the SDK (template provided).
- Keep metainfo `release` entries in sync with git tags.
