#!/usr/bin/env bash
# Copyright (c) 2018-Present Lea Anthony
# SPDX-License-Identifier: MIT

set -euxo pipefail

APP_DIR="${APP_NAME}.AppDir"
OUTPUT_NAME="${APP_NAME}${VERSION:+-${VERSION}}${ARCH:+-${ARCH}}.AppImage"

mkdir -p "${APP_DIR}/usr/bin"
cp -r "${APP_BINARY}" "${APP_DIR}/usr/bin/"
cp "${ICON_PATH}" "${APP_DIR}/"
cp "${DESKTOP_FILE}" "${APP_DIR}/"

# Prefer extract-and-run so CI runners without usable FUSE still work.
export APPIMAGE_EXTRACT_AND_RUN="${APPIMAGE_EXTRACT_AND_RUN:-1}"

if [[ "$(uname -m)" == *x86_64* ]]; then
  wget -q -4 -N https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
  chmod +x linuxdeploy-x86_64.AppImage
  ./linuxdeploy-x86_64.AppImage --appimage-extract-and-run --appdir "${APP_DIR}" --output appimage
else
  wget -q -4 -N https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-aarch64.AppImage
  chmod +x linuxdeploy-aarch64.AppImage
  ./linuxdeploy-aarch64.AppImage --appimage-extract-and-run --appdir "${APP_DIR}" --output appimage
fi

shopt -s nullglob
generated=( ./*.AppImage )
if [[ ${#generated[@]} -eq 0 ]]; then
  echo "No AppImage generated" >&2
  exit 1
fi

# Prefer the just-built application image over the linuxdeploy helper itself.
target=""
for f in "${generated[@]}"; do
  base="$(basename "$f")"
  case "$base" in
    linuxdeploy*) continue ;;
    *) target="$f"; break ;;
  esac
done
if [[ -z "${target}" ]]; then
  target="${generated[0]}"
fi

mv -f "${target}" "${OUTPUT_NAME}"
# Keep a stable name for local workflows as well.
cp -f "${OUTPUT_NAME}" "${APP_NAME}.AppImage"

# Copy into expected output directory when provided.
if [[ -n "${OUTPUT_DIR:-}" ]]; then
  mkdir -p "${OUTPUT_DIR}"
  cp -f "${OUTPUT_NAME}" "${OUTPUT_DIR}/"
  cp -f "${APP_NAME}.AppImage" "${OUTPUT_DIR}/"
fi

ls -la "${OUTPUT_NAME}" "${APP_NAME}.AppImage"
