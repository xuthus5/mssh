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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/release/artifact-notes.sh
source "${script_dir}/artifact-notes.sh"

base="https://github.com/${repo}/releases/download/${tag}"
commit_url="https://github.com/${repo}/commit/${sha}"
run_url="https://github.com/${repo}/actions/runs/${run_id}"
sha_short="${sha:0:7}"
date_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '## 🚀 Nightly Build `%s`\n\n' "${version}"
printf '> 自动构建于 **%s** · **预发布版本**，用于验证最新开发分支，可能包含未完成或破坏性变更。\n\n' "${date_utc}"
printf -- '- **提交**: `%s`（[查看提交](%s)）\n' "${sha_short}" "${commit_url}"
printf -- '- **构建**: [GitHub Actions 运行 #%s](%s)\n\n' "${run_number}" "${run_url}"

print_artifact_tables
print_checksum_block 'mssh-nightly-SHA256SUMS'
