#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="${ROOT_DIR}/build/appicon.png"
OUT="${ROOT_DIR}/build/linux/flatpak/icons"
python3 - <<PY
from pathlib import Path
from PIL import Image
src = Image.open("${SRC}").convert("RGBA")
out = Path("${OUT}")
for size in (64, 128, 256, 512):
    d = out / f"{size}x{size}" / "apps"
    d.mkdir(parents=True, exist_ok=True)
    img = src.resize((size, size), Image.Resampling.LANCZOS)
    path = d / "io.github.xuthus5.mssh.png"
    img.save(path)
    print("wrote", path)
PY
