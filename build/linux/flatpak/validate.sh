#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
app_id="io.github.xuthus5.mssh"
manifest="${1:-${root_dir}/build/linux/flatpak/${app_id}.flathub.yml}"
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

if [[ "${manifest}" == *".flathub.yml" ]]; then
  grep -Eq '^[[:space:]]+tag: v[0-9]+\.[0-9]+\.[0-9]+$' "${manifest}"
  grep -Eq '^[[:space:]]+commit: [0-9a-f]{40}$' "${manifest}"
  grep -Fq 'npm ci --ignore-scripts' "${manifest}"
  if grep -Eq 'npm install|\|\| *npm' "${manifest}"; then
    echo "Flathub manifest must not fetch dependencies through an unlocked npm install" >&2
    exit 1
  fi
  if [[ "${VERIFY_FLATHUB_SOURCE:-0}" == "1" ]]; then
    source_url="$(awk '$1 == "url:" && $2 ~ /^https:\/\/github\.com\// {print $2; exit}' "${manifest}")"
    source_tag="$(awk '$1 == "tag:" {print $2; exit}' "${manifest}")"
    source_commit="$(awk '$1 == "commit:" {print $2; exit}' "${manifest}")"
    test -n "${source_url}" -a -n "${source_tag}" -a -n "${source_commit}"
    resolved_commit="$(git ls-remote "${source_url}" "refs/tags/${source_tag}^{}" | awk 'NR == 1 {print $1}')"
    if [[ -z "${resolved_commit}" ]]; then
      resolved_commit="$(git ls-remote "${source_url}" "refs/tags/${source_tag}" | awk 'NR == 1 {print $1}')"
    fi
    test "${resolved_commit}" = "${source_commit}"
  fi
fi

echo "Flatpak manifest validated: ${manifest}"
