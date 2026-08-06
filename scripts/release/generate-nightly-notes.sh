#!/usr/bin/env bash
set -euo pipefail

# Generates a GitHub release body for a nightly build from the uploaded
# artifacts. Emits markdown to stdout.
#
# Usage: generate-nightly-notes.sh <upload-dir>
# Env:   GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_NUMBER,
#        NIGHTLY_VERSION, RELEASE_TAG

upload_dir="${1:?usage: generate-nightly-notes.sh <upload-dir>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
sha="${GITHUB_SHA:?GITHUB_SHA required}"
run_id="${GITHUB_RUN_ID:?GITHUB_RUN_ID required}"
run_number="${GITHUB_RUN_NUMBER:?GITHUB_RUN_NUMBER required}"
version="${NIGHTLY_VERSION:?NIGHTLY_VERSION required}"
tag="${RELEASE_TAG:?RELEASE_TAG required}"

base="https://github.com/${repo}/releases/download/${tag}"
commit_url="https://github.com/${repo}/commit/${sha}"
run_url="https://github.com/${repo}/actions/runs/${run_id}"
sha_short="${sha:0:7}"
date_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

human_size() {
  local bytes="$1"
  if (( bytes >= 1073741824 )); then awk -v b="$bytes" 'BEGIN { printf "%.1f GB", b/1073741824 }'
  elif (( bytes >= 1048576 )); then awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b/1048576 }'
  elif (( bytes >= 1024 )); then awk -v b="$bytes" 'BEGIN { printf "%.1f KB", b/1024 }'
  else printf '%s B' "$bytes"; fi
}

archive_arch() {
  local name="$1"
  local platform="$2"
  local suffix
  suffix="${name#*${platform}-}"
  printf '%s' "${suffix}" | sed -E 's/-installer\.exe$//; s/^([^.]+).*/\1/'
}

artifact_type() {
  local name="$1"
  case "${name}" in
    *.AppImage) printf 'AppImage';;
    *.deb) printf 'DEB 包';;
    *.rpm) printf 'RPM 包';;
    *.flatpak) printf 'Flatpak';;
    *-installer.exe) printf 'NSIS 安装程序';;
    *.exe) printf '便携版';;
    *.app.zip) printf 'macOS 应用';;
    *.dmg) printf 'DMG 镜像';;
    *) printf '可执行文件';;
  esac
}

print_platform_table() {
  local platform="$1"
  local label="$2"
  printf '%s\n\n' "${label}"
  printf '| 类型 | 架构 | 大小 | 下载 |\n|---|---|---|---|\n'
  local printed=0
  for file in "${upload_dir}"/mssh-*"${platform}"*; do
    [[ -f "${file}" ]] || continue
    local name
    name="$(basename "${file}")"
    case "${name}" in *SHA256SUMS*|*sigstore*|*provenance*) continue ;; esac
    local size
    size="$(human_size "$(stat -c%s "${file}")")"
    printf '| %s | %s | %s | [下载](%s/%s) |\n' \
      "$(artifact_type "${name}")" "$(archive_arch "${name}" "${platform}")" "${size}" "${base}" "${name}"
    printed=1
  done
  if [[ "${printed}" -eq 0 ]]; then printf '_暂无产物_\n'; fi
  printf '\n'
}

printf '## 🚀 Nightly Build `%s`\n\n' "${version}"
printf '> 自动构建于 **%s** · **预发布版本**，用于验证最新开发分支，可能包含未完成或破坏性变更。\n\n' "${date_utc}"
printf -- '- **提交**: `%s`（[查看提交](%s)）\n' "${sha_short}" "${commit_url}"
printf -- '- **构建**: [GitHub Actions 运行 #%s](%s)\n\n' "${run_number}" "${run_url}"

print_platform_table linux '### 🐧 Linux'
print_platform_table windows '### 🪟 Windows'
print_platform_table darwin '### 🍎 macOS'

printf '### 🔒 SHA256 校验和\n\n```text\n'
if [[ -f "${upload_dir}/mssh-nightly-SHA256SUMS" ]]; then
  cat "${upload_dir}/mssh-nightly-SHA256SUMS"
else
  printf '（校验和文件缺失）\n'
fi
printf '\n```\n\n> 下载后可在产物目录运行 `sha256sum -c mssh-nightly-SHA256SUMS` 校验完整性。\n'
