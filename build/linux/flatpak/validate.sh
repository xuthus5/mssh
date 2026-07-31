#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
app_id="io.github.xuthus5.mssh"
manifest="${1:-${root_dir}/build/linux/flatpak/${app_id}.yml}"
metadata="${root_dir}/build/linux/flatpak/${app_id}.metainfo.xml"
desktop="${root_dir}/build/linux/flatpak/${app_id}.desktop"
permissions="${root_dir}/docs/flathub-permissions.md"

command -v flatpak-builder >/dev/null 2>&1 || { echo "flatpak-builder is required" >&2; exit 1; }
command -v appstreamcli >/dev/null 2>&1 || { echo "appstreamcli is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

test -f "${manifest}"
test -f "${metadata}"
test -f "${desktop}"
test -f "${permissions}"

appstreamcli validate --strict --no-net "${metadata}"
manifest_json="$(mktemp)"
cleanup() {
  if [ -e "${manifest_json}" ]; then unlink "${manifest_json}"; fi
}
trap cleanup EXIT
flatpak-builder --show-manifest "${manifest}" > "${manifest_json}"
jq -e --arg app_id "${app_id}" '.id == $app_id and .runtime and .sdk and .modules' "${manifest_json}" >/dev/null

grep -Fq "<id>${app_id}</id>" "${metadata}"
grep -Eq '^Name=MSSH$' "${desktop}"
grep -Eq '^Exec=mssh$' "${desktop}"
for size in 64 128 256 512; do
  test -f "${root_dir}/build/linux/flatpak/icons/${size}x${size}/apps/${app_id}.png"
done

echo "Flatpak manifest validated: ${manifest}"