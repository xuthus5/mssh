#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="${root_dir}/.github/workflows/release.yml"
nightly_workflow="${root_dir}/.github/workflows/nightly.yml"
taskfile="${root_dir}/build/Taskfile.yml"
windows_taskfile="${root_dir}/build/windows/Taskfile.yml"

test -f "${workflow}"
test -f "${nightly_workflow}"
test -f "${taskfile}"
test -f "${windows_taskfile}"
for pattern in \
  'if-no-files-found: error' \
  'actions/attest-build-provenance@v2' \
  'cosign sign-blob --yes' \
  '--bundle "upload/mssh-${version}-SHA256SUMS.sigstore.json"' \
  'cosign verify-blob' \
  'go-version-file: .go-version' \
  'node-version-file: .node-version' \
  'runner: macos-15'; do
  grep -Fq -- "${pattern}" "${workflow}"
done

if grep -Eq 'macos-[^[:space:]]*-large|macos-[^[:space:]]*-xl' "${workflow}"; then
  echo "release workflow requires a paid larger macOS runner" >&2
  exit 1
fi
grep -Fq -- 'npm ci' "${taskfile}"
grep -Fq -- 'go mod tidy -diff' "${taskfile}"
grep -Fq -- 'go mod verify' "${taskfile}"
grep -Fq -- '"{{.MAKENSIS}}" -DARG_WAILS_' "${windows_taskfile}"

for checked_workflow in "${workflow}" "${nightly_workflow}"; do
  grep -Fq -- '"MAKENSIS_NATIVE=$makensis" | Out-File -FilePath $env:GITHUB_ENV' "${checked_workflow}"
  grep -Fq -- 'Test-Path $env:MAKENSIS_NATIVE' "${checked_workflow}"
  grep -Fq -- 'go run ./scripts/release/nsis_runner.go \' "${checked_workflow}"
  if grep -Fq -- 'bashMakensis' "${checked_workflow}" || grep -Fq -- '"MAKENSIS=' "${checked_workflow}"; then
    echo "release workflows must pass the native makensis path through MAKENSIS_NATIVE only" >&2
    exit 1
  fi
  if grep -Fq -- 'wails3 task windows:create:nsis:installer' "${checked_workflow}"; then
    echo "release workflows must call makensis through scripts/release/nsis_runner.go" >&2
    exit 1
  fi
  if grep -Fq -- '"${MAKENSIS}" /VERSION' "${checked_workflow}"; then
    echo "Git Bash converts /VERSION to a path; verify makensis from PowerShell only" >&2
    exit 1
  fi
done

if grep -Eq 'soft.?fail|output-signature|output-certificate|\|\|[[:space:]]*true' "${workflow}"; then
  echo "release workflow contains a soft-fail or unsupported signing option" >&2
  exit 1
fi

for version_file in .go-version .node-version .wails-version; do
  test -s "${root_dir}/${version_file}"
done

echo "release workflow validated: ${workflow}"
