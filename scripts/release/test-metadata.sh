#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/mssh-release-metadata.XXXXXX")"
trap 'rm -rf -- "${work_dir}"' EXIT

mkdir -p "${work_dir}/bin" "${work_dir}/upload"
printf 'binary\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64"
printf 'package\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64.deb"
printf 'appimage\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64.AppImage"
printf 'flatpak\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64.flatpak"
cat > "${work_dir}/bin/syft" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "${SYFT_CALL_LOG:?}"
cat <<'JSON'
{"bomFormat":"CycloneDX","specVersion":"1.5"}
JSON
EOF
chmod 0755 "${work_dir}/bin/syft"

(
  cd "${root_dir}"
  PATH="${work_dir}/bin:${PATH}" \
    SYFT_CALL_LOG="${work_dir}/syft-calls.txt" \
    RELEASE_VERSION=0.0.0 RELEASE_COMMIT=metadata-test \
    bash scripts/release/prepare-metadata.sh "${work_dir}/upload"
)

checksum_file="${work_dir}/upload/mssh-0.0.0-SHA256SUMS"
test -s "${checksum_file}"
(cd "${work_dir}/upload" && sha256sum -c "$(basename "${checksum_file}")")
jq -e '.schema and .subject.commit == "metadata-test" and (.artifacts | length == 4)' \
  "${work_dir}/upload/mssh-0.0.0-provenance.json" >/dev/null
test "$(find "${work_dir}/upload" -maxdepth 1 -name '*.sbom.cdx.json' -type f | wc -l)" -eq 2
test "$(wc -l < "${work_dir}/syft-calls.txt")" -eq 2
! grep -Fq '.AppImage' "${work_dir}/syft-calls.txt"
! grep -Fq '.flatpak' "${work_dir}/syft-calls.txt"
grep -Fq '  mssh-0.0.0-linux-amd64.AppImage' "${checksum_file}"
grep -Fq '  mssh-0.0.0-linux-amd64.flatpak' "${checksum_file}"
test ! -e "${work_dir}/upload/mssh-0.0.0-linux-amd64.AppImage.sbom.cdx.json"
test ! -e "${work_dir}/upload/mssh-0.0.0-linux-amd64.flatpak.sbom.cdx.json"

echo "release metadata smoke test passed"
