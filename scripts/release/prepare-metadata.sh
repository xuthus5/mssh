#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-upload}"
version="${RELEASE_VERSION:?RELEASE_VERSION is required}"
commit="${RELEASE_COMMIT:-${GITHUB_SHA:-unknown}}"
repository="${GITHUB_REPOSITORY:-github.com/xuthus5/mssh}"
workflow="${GITHUB_WORKFLOW:-unknown}"
run_id="${GITHUB_RUN_ID:-unknown}"

mkdir -p "${artifact_dir}"

is_primary_artifact() {
  case "$(basename "$1")" in
    *.deb|*.rpm|*.AppImage|*.appimage|*.flatpak|*.exe|*.zip|mssh-*-linux-*|mssh-*-windows-*) return 0 ;;
    *) return 1 ;;
  esac
}

mapfile -d '' -t primary_artifacts < <(
  find "${artifact_dir}" -maxdepth 1 -type f -print0 |
    while IFS= read -r -d '' file; do
      if is_primary_artifact "${file}"; then printf '%s\0' "${file}"; fi
    done | sort -z
)

if ((${#primary_artifacts[@]} == 0)); then
  echo "no release artifacts found in ${artifact_dir}" >&2
  exit 1
fi

for artifact in "${primary_artifacts[@]}"; do
  case "$(basename "${artifact}")" in
    mssh-*) ;;
    *) echo "unexpected release artifact name: ${artifact}" >&2; exit 1 ;;
  esac
done

if ! command -v syft >/dev/null 2>&1; then
  echo "syft is required to generate release SBOMs" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to validate release metadata" >&2
  exit 1
fi

artifact_json='[]'
for artifact in "${primary_artifacts[@]}"; do
  name="$(basename "${artifact}")"
  sbom="${artifact_dir}/${name}.sbom.cdx.json"
  syft "file:${artifact}" -o cyclonedx-json > "${sbom}"
  jq -e '(.bomFormat == "CycloneDX") and (.specVersion != null) and (.components | type == "array")' "${sbom}" >/dev/null
  digest="$(sha256sum "${artifact}" | awk '{print $1}')"
  artifact_json="$(jq --arg name "${name}" --arg sha256 "${digest}" '. + [{name: $name, sha256: $sha256}]' <<<"${artifact_json}")"
done

provenance="${artifact_dir}/mssh-${version}-provenance.json"
jq -n \
  --arg schema "https://slsa.dev/provenance/v1" \
  --arg repository "${repository}" \
  --arg version "${version}" \
  --arg commit "${commit}" \
  --arg workflow "${workflow}" \
  --arg run_id "${run_id}" \
  --arg go_version "$(tr -d '\r\n' < .go-version 2>/dev/null || true)" \
  --arg node_version "$(tr -d '\r\n' < .node-version 2>/dev/null || true)" \
  --arg wails_version "$(tr -d '\r\n' < .wails-version 2>/dev/null || true)" \
  --argjson artifacts "${artifact_json}" \
  '{schema: $schema, subject: {repository: $repository, version: $version, commit: $commit},
    builder: {workflow: $workflow, run_id: $run_id},
    buildType: "wails-release", toolchain: {go: $go_version, node: $node_version, wails: $wails_version},
    artifacts: $artifacts}' > "${provenance}"
jq -e '.schema and .subject.commit and (.artifacts | length > 0)' "${provenance}" >/dev/null

mapfile -t integrity_files < <(
  printf '%s\n' "${primary_artifacts[@]}"
  find "${artifact_dir}" -maxdepth 1 -type f -name '*.sbom.cdx.json' -print
  printf '%s\n' "${provenance}"
)
checksum_file="${artifact_dir}/mssh-${version}-SHA256SUMS"
sha256sum "${integrity_files[@]}" | sed "s#  ${artifact_dir}/#  #" | sort -k2 > "${checksum_file}"
(cd "${artifact_dir}" && sha256sum -c "$(basename "${checksum_file}")")

echo "prepared release metadata in ${artifact_dir}"
ls -la "${artifact_dir}"
