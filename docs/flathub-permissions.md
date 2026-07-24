# Flathub Permission Review

Application ID: `io.github.xuthus5.mssh`

The Flatpak manifest deliberately documents every requested permission:

- `--share=network`: SSH, SFTP, cloud sync, AI providers, and update checks.
- `--socket=wayland` and `--socket=fallback-x11`: Wails WebView display support.
- `--device=dri`: hardware-accelerated WebView rendering when available.
- `--talk-name=org.freedesktop.secrets`: desktop secret-service integration for the application vault.
- `--socket=ssh-auth`: optional SSH agent integration.
- `--filesystem=home`: user-selected SSH keys, known-hosts, transfer paths, recordings, and configurable logs.
- `--filesystem=xdg-run/gnupg:ro`: read-only GnuPG runtime discovery for supported key workflows.

No background service, system installation, privileged device, or unrestricted D-Bus wildcard is requested.
The Flathub manifest builds from a tagged source commit and uses the committed npm lockfile with `npm ci`.
