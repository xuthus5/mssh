#!/usr/bin/env bash
# Build a distributable .flatpak by compiling inside the GNOME SDK.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_ID="io.github.xuthus5.mssh"
MANIFEST_SRC="${ROOT_DIR}/build/linux/flatpak/${APP_ID}.yml"
STATE_DIR="${ROOT_DIR}/build/linux/flatpak/.flatpak-builder"
BUILD_DIR="${ROOT_DIR}/build/linux/flatpak/build-dir"
REPO_DIR="${ROOT_DIR}/build/linux/flatpak/repo"
EXPORT_DIR="${ROOT_DIR}/bin"
VERSION="${APP_VERSION:-0.1.0}"
VERSION="${VERSION#v}"
ARCH="${ARCH:-$(uname -m)}"
case "${ARCH}" in
  x86_64|amd64) ARCH_LABEL="amd64"; FLATPAK_ARCH="x86_64" ;;
  aarch64|arm64) ARCH_LABEL="arm64"; FLATPAK_ARCH="aarch64" ;;
  *) ARCH_LABEL="${ARCH}"; FLATPAK_ARCH="${ARCH}" ;;
esac

OUTPUT_NAME="mssh-${VERSION}-linux-${ARCH_LABEL}.flatpak"
GNOME_VERSION="${FLATPAK_GNOME_VERSION:-49}"
case "${GNOME_VERSION}" in
  50|49) FD_VERSION="25.08" ;;
  48) FD_VERSION="24.08" ;;
  47|46) FD_VERSION="23.08" ;;
  *) FD_VERSION="25.08" ;;
esac

die() { echo "$*" >&2; exit 1; }

# Honor host proxy for flatpak downloads and nested network fetches.
if [ -n "${https_proxy:-${HTTPS_PROXY:-}}" ]; then
  export https_proxy="${https_proxy:-$HTTPS_PROXY}"
  export HTTPS_PROXY="${HTTPS_PROXY:-$https_proxy}"
fi
if [ -n "${http_proxy:-${HTTP_PROXY:-}}" ]; then
  export http_proxy="${http_proxy:-$HTTP_PROXY}"
  export HTTP_PROXY="${HTTP_PROXY:-$http_proxy}"
fi
if [ -n "${all_proxy:-${ALL_PROXY:-}}" ]; then
  export all_proxy="${all_proxy:-$ALL_PROXY}"
  export ALL_PROXY="${ALL_PROXY:-$all_proxy}"
elif [ -n "${https_proxy:-}" ]; then
  export all_proxy="${https_proxy}"
  export ALL_PROXY="${https_proxy}"
fi
if [ -n "${no_proxy:-${NO_PROXY:-}}" ]; then
  export no_proxy="${no_proxy:-$NO_PROXY}"
  export NO_PROXY="${NO_PROXY:-$no_proxy}"
fi

command -v flatpak >/dev/null 2>&1 || die "flatpak is required"
command -v flatpak-builder >/dev/null 2>&1 || die "flatpak-builder is required"

if ! flatpak remotes --user 2>/dev/null | awk '{print $1}' | grep -qx flathub; then
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
fi

install_stack() {
  local gnome_ver="$1" fd_ver="$2"
  echo "Installing org.gnome.Platform//${gnome_ver} + Sdk + golang/node20 //${fd_ver}"
  flatpak config --user --set languages "en" >/dev/null 2>&1 || true
  flatpak install -y --user --noninteractive flathub \
    "org.gnome.Platform//${gnome_ver}" \
    "org.gnome.Sdk//${gnome_ver}" \
    "org.freedesktop.Sdk.Extension.golang//${fd_ver}" \
    "org.freedesktop.Sdk.Extension.node20//${fd_ver}"
}

if ! install_stack "${GNOME_VERSION}" "${FD_VERSION}"; then
  echo "Falling back to GNOME 48 / Freedesktop 24.08" >&2
  GNOME_VERSION="48"
  FD_VERSION="24.08"
  install_stack "${GNOME_VERSION}" "${FD_VERSION}"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mssh-flatpak.XXXXXX")"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

MANIFEST="${WORKDIR}/${APP_ID}.yml"
sed -E \
  -e "s/runtime-version: '[0-9]+'/runtime-version: '${GNOME_VERSION}'/" \
  -e "s/FLATPAK_BUILD_VERSION:-0.1.0/FLATPAK_BUILD_VERSION:-${VERSION}/" \
  "${MANIFEST_SRC}" > "${MANIFEST}"

export ROOT_DIR MANIFEST
python3 - <<'PY'
from pathlib import Path
import os
import re

root = Path(os.environ["ROOT_DIR"]).resolve()
manifest = Path(os.environ["MANIFEST"])
text = manifest.read_text()

text = re.sub(
    r"(?m)^(\s*path:\s*)\.\./\.\./\.\./\s*$",
    rf"\1{root.as_posix()}",
    text,
    count=1,
)

proxy_keys = [
    "http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY",
    "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY",
]
proxy_lines = []
for key in proxy_keys:
    val = os.environ.get(key, "")
    if val:
        safe = val.replace("'", "''")
        proxy_lines.append(f"    {key}: '{safe}'")

if proxy_lines:
    env_marker = "  env:\n    GOROOT: /usr/lib/sdk/golang\n"
    if env_marker in text:
        text = text.replace(env_marker, env_marker + "\n".join(proxy_lines) + "\n", 1)
    else:
        text = re.sub(
            r"(?m)^(  env:\n(?:    .+:.*\n)*)",
            lambda m: m.group(1) + "\n".join(proxy_lines) + "\n",
            text,
            count=1,
        )

manifest.write_text(text)
print("manifest ready:", manifest)
print("proxy keys injected:", [k for k in proxy_keys if os.environ.get(k)])
PY

if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net \
    "${ROOT_DIR}/build/linux/flatpak/${APP_ID}.metainfo.xml" \
    || appstreamcli validate \
    "${ROOT_DIR}/build/linux/flatpak/${APP_ID}.metainfo.xml" \
    || true
fi

mkdir -p "${EXPORT_DIR}" "${STATE_DIR}"
rm -rf "${BUILD_DIR}" "${REPO_DIR}"

flatpak-builder \
  --user \
  --force-clean \
  --disable-rofiles-fuse \
  --state-dir "${STATE_DIR}" \
  --repo "${REPO_DIR}" \
  --default-branch "${VERSION}" \
  "${BUILD_DIR}" \
  "${MANIFEST}"

flatpak build-bundle \
  --arch "${FLATPAK_ARCH}" \
  "${REPO_DIR}" \
  "${EXPORT_DIR}/${OUTPUT_NAME}" \
  "${APP_ID}" \
  "${VERSION}"

cp -f "${EXPORT_DIR}/${OUTPUT_NAME}" "${EXPORT_DIR}/mssh.flatpak"
chmod 0644 "${EXPORT_DIR}/${OUTPUT_NAME}" "${EXPORT_DIR}/mssh.flatpak"

ls -la "${EXPORT_DIR}/${OUTPUT_NAME}" "${EXPORT_DIR}/mssh.flatpak"
echo "Install with: flatpak install --user ${EXPORT_DIR}/${OUTPUT_NAME}"
echo "Run with:     flatpak run ${APP_ID}"
