#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="${root_dir}/.github/workflows/release.yml"
taskfile="${root_dir}/build/Taskfile.yml"

test -f "${workflow}"
test -f "${taskfile}"
for pattern in \
  'if-no-files-found: error' \
  'actions/attest-build-provenance@v2' \
  'cosign sign-blob --yes' \
  '--bundle "upload/mssh-${version}-SHA256SUMS.sigstore.json"' \
  'cosign verify-blob' \
  'go-version-file: .go-version' \
  'node-version-file: .node-version' \
  'runner: macos-15-intel'; do
  grep -Fq -- "${pattern}" "${workflow}"
done

if grep -Eq 'macos-[^[:space:]]*-large|macos-[^[:space:]]*-xl' "${workflow}"; then
  echo "release workflow requires a paid larger macOS runner" >&2
  exit 1
fi
grep -Fq -- 'npm ci' "${taskfile}"
grep -Fq -- 'go mod tidy -diff' "${taskfile}"
grep -Fq -- 'go mod verify' "${taskfile}"

if grep -Eq 'soft.?fail|output-signature|output-certificate|\|\|[[:space:]]*true' "${workflow}"; then
  echo "release workflow contains a soft-fail or unsupported signing option" >&2
  exit 1
fi

for version_file in .go-version .node-version .wails-version; do
  test -s "${root_dir}/${version_file}"
done

echo "release workflow validated: ${workflow}"
