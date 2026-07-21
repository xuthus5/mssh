# Packaging

## Scope

Release packaging is driven by Wails v3 Taskfiles under `build/` and GitHub Actions on tags `v*`.

## Artifacts

- Linux amd64/arm64: binary/deb/rpm/AppImage published as `mssh-VERSION-linux-ARCH[.deb|.rpm|.AppImage]`
- Windows amd64/arm64: exe, NSIS installer
- macOS: arm64 + amd64 `.app` zip (native runners)

Flatpak is intentionally out of scope for the first packaging pass.

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
```

Packages are unsigned in the first release pipeline.
