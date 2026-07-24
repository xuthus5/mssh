#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/mssh-release-metadata.XXXXXX")"
trap 'rm -rf -- "${work_dir}"' EXIT

mkdir -p "${work_dir}/bin" "${work_dir}/upload"
printf 'binary\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64"
printf 'package\n' > "${work_dir}/upload/mssh-0.0.0-linux-amd64.deb"
cat > "${work_dir}/bin/syft" <<'EOF'
#!/usr/bin/env bash
cat <<'JSON'
{"bomFormat":"CycloneDX","specVersion":"1.5","components":[]}
JSON
EOF
chmod 0755 "${work_dir}/bin/syft"

(
  cd "${root_dir}"
  PATH="${work_dir}/bin:${PATH}" \
    RELEASE_VERSION=0.0.0 RELEASE_COMMIT=metadata-test \
    bash scripts/release/prepare-metadata.sh "${work_dir}/upload"
)

checksum_file="${work_dir}/upload/mssh-0.0.0-SHA256SUMS"
test -s "${checksum_file}"
(cd "${work_dir}/upload" && sha256sum -c "$(basename "${checksum_file}")")
jq -e '.schema and .subject.commit == "metadata-test" and (.artifacts | length == 2)' \
  "${work_dir}/upload/mssh-0.0.0-provenance.json" >/dev/null
test "$(find "${work_dir}/upload" -maxdepth 1 -name '*.sbom.cdx.json' -type f | wc -l)" -eq 2

echo "release metadata smoke test passed"
