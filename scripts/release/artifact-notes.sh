#!/usr/bin/env bash

# Shared Markdown helpers for release notes. The caller must set upload_dir and
# base before invoking these functions.

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
    case "${name}" in *SHA256SUMS*|*sigstore*|*provenance*|*.sbom.*) continue ;; esac
    local size
    size="$(human_size "$(stat -c%s "${file}")")"
    printf '| %s | %s | %s | [下载](%s/%s) |\n' \
      "$(artifact_type "${name}")" "$(archive_arch "${name}" "${platform}")" "${size}" "${base}" "${name}"
    printed=1
  done
  if [[ "${printed}" -eq 0 ]]; then printf '_暂无产物_\n'; fi
  printf '\n'
}

print_artifact_tables() {
  print_platform_table linux '### 🐧 Linux'
  print_platform_table windows '### 🪟 Windows'
  print_platform_table darwin '### 🍎 macOS'
}

print_checksum_block() {
  local checksum_name="$1"
  printf '### 🔒 SHA256 校验和\n\n```text\n'
  if [[ -f "${upload_dir}/${checksum_name}" ]]; then
    cat "${upload_dir}/${checksum_name}"
  else
    printf '（校验和文件缺失）\n'
  fi
  printf '\n```\n\n> 下载后可在产物目录运行 `sha256sum -c %s` 校验完整性。\n' "${checksum_name}"
}
