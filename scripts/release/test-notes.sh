#!/usr/bin/env bash
set -euo pipefail
umask 077

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/mssh-release-notes.XXXXXX")"
trap 'rm -rf -- "${work_dir}"' EXIT

mkdir -p "${work_dir}/upload"
for name in \
  mssh-1.0.1-linux-amd64 \
  mssh-1.0.1-linux-amd64.AppImage \
  mssh-1.0.1-linux-amd64.deb \
  mssh-1.0.1-linux-amd64.flatpak \
  mssh-1.0.1-linux-amd64.rpm \
  mssh-1.0.1-windows-amd64-installer.exe \
  mssh-1.0.1-windows-arm64.exe \
  mssh-1.0.1-darwin-amd64.app.zip; do
  printf 'artifact %s\n' "${name}" > "${work_dir}/upload/${name}"
done
printf 'checksum  mssh-1.0.1-linux-amd64\n' > "${work_dir}/upload/mssh-1.0.1-SHA256SUMS"
printf 'checksum  nightly\n' > "${work_dir}/upload/mssh-nightly-SHA256SUMS"

cat > "${work_dir}/changes.md" <<'EOF'
## What's Changed
* fix(update): support nightly builds by @alice in https://github.com/xuthus5/mssh/pull/42
* feat(sync): improve OAuth flow by @bob in https://github.com/xuthus5/mssh/pull/43

**Full Changelog**: https://github.com/xuthus5/mssh/compare/v1.0.0...v1.0.1
EOF

(
  cd "${root_dir}"
  GITHUB_REPOSITORY=xuthus5/mssh GITHUB_SHA=1234567890abcdef GITHUB_RUN_ID=99 \
  GITHUB_RUN_NUMBER=7 RELEASE_VERSION=1.0.1 RELEASE_TAG=v1.0.1 \
    bash scripts/release/generate-release-notes.sh \
      "${work_dir}/upload" "${work_dir}/changes.md" v1.0.0 > "${work_dir}/release.md"
  GITHUB_REPOSITORY=xuthus5/mssh GITHUB_SHA=1234567890abcdef GITHUB_RUN_ID=99 \
  GITHUB_RUN_NUMBER=7 NIGHTLY_VERSION=nightly-20261029-1-abcdef0 RELEASE_TAG=nightly \
    bash scripts/release/generate-nightly-notes.sh "${work_dir}/upload" > "${work_dir}/nightly.md"
)

release_notes="${work_dir}/release.md"
nightly_notes="${work_dir}/nightly.md"
grep -Fq '## 🚀 MSSH `v1.0.1`' "${release_notes}"
grep -Fq '[下载](https://github.com/xuthus5/mssh/releases/download/v1.0.1/mssh-1.0.1-linux-amd64.deb)' "${release_notes}"
grep -Fq '| NSIS 安装程序 | amd64 |' "${release_notes}"
grep -Fq '| macOS 应用 | amd64 |' "${release_notes}"
grep -Fq '#### What’s Changed' "${release_notes}" || grep -Fq "#### What's Changed" "${release_notes}"
grep -Fq 'https://github.com/xuthus5/mssh/pull/42' "${release_notes}"
grep -Fq 'https://github.com/xuthus5/mssh/pull/43' "${release_notes}"
grep -Fq 'sha256sum -c mssh-1.0.1-SHA256SUMS' "${release_notes}"

grep -Fq '## 🚀 Nightly Build `nightly-20261029-1-abcdef0`' "${nightly_notes}"
grep -Fq 'sha256sum -c mssh-nightly-SHA256SUMS' "${nightly_notes}"
test "$(grep -Fc '| [下载](' "${release_notes}")" -eq 8
test "$(grep -Fc '| [下载](' "${nightly_notes}")" -eq 8

printf '**Full Changelog**: https://github.com/xuthus5/mssh/compare/v1.0.0...v1.0.1\n' > "${work_dir}/no-prs.md"
(
  cd "${root_dir}"
  GITHUB_REPOSITORY=xuthus5/mssh GITHUB_SHA=1234567890abcdef GITHUB_RUN_ID=99 \
  GITHUB_RUN_NUMBER=7 RELEASE_VERSION=1.0.1 RELEASE_TAG=v1.0.1 \
    bash scripts/release/generate-release-notes.sh \
      "${work_dir}/upload" "${work_dir}/no-prs.md" v1.0.0 > "${work_dir}/no-prs-release.md"
)
grep -Fq '_未发现关联的 Pull Request。_' "${work_dir}/no-prs-release.md"

echo "release notes smoke test passed"
