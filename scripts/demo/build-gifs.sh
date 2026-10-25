#!/usr/bin/env bash
# Convert the recorded WebM clips into the GIFs used by README.md.
# Requires: Pillow via `uv run --with pillow`, gifsicle, and an ffmpeg build
# with PNG output + scale filter (Playwright's bundled ffmpeg works).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${CLEW_WORK:-$ROOT/scripts/demo/.work}"
OUT="$ROOT/docs/assets/demo"
VIDEO="$WORK/video"
FRAMES="$WORK/frames"

# Prefer Playwright's bundled ffmpeg (some Homebrew builds are broken), then PATH.
FFMPEG="${FFMPEG:-}"
if [ -z "$FFMPEG" ]; then
  FFMPEG="$(ls "$HOME"/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac 2>/dev/null | tail -1 || true)"
fi
if [ -z "$FFMPEG" ]; then
  FFMPEG="$(command -v ffmpeg || true)"
fi
if [ -z "$FFMPEG" ]; then
  echo "ffmpeg not found. Install ffmpeg or run \`npx playwright install\`." >&2
  exit 1
fi
command -v gifsicle >/dev/null || { echo "gifsicle not found (brew install gifsicle)." >&2; exit 1; }

mkdir -p "$OUT" "$FRAMES"

# name output fps width colors (output without extension)
SPECS=(
  "overview 01-overview 8 1280 96"
  "source 02-source-preview 8 1120 96"
  "edit 03-edit-annotate 8 1120 96"
  "ai 04-ai-copilot 6 1120 96"
  "import 05-import 8 1120 96"
  "versions 06-versions 8 1120 96"
  "i18n 07-bilingual 6 1120 96"
)

# Optional args: only rebuild the named segments.
WANTED=("$@")
wanted() {
  [ ${#WANTED[@]} -eq 0 ] && return 0
  local candidate
  for candidate in "${WANTED[@]}"; do
    [ "$candidate" = "$1" ] && return 0
  done
  return 1
}

for spec in "${SPECS[@]}"; do
  read -r name output fps width colors <<< "$spec"
  if ! wanted "$name"; then
    continue
  fi
  src="$VIDEO/$name.webm"
  if [ ! -f "$src" ]; then
    echo "skip $name (no recording at $src)"
    continue
  fi
  dir="$FRAMES/$name"
  rm -rf "$dir"; mkdir -p "$dir"
  "$FFMPEG" -hide_banner -loglevel error -i "$src" -r "$fps" \
    -vf "scale=$width:-2" -pix_fmt rgb24 "$dir/%04d.png" < /dev/null
  uv run --with pillow python "$ROOT/scripts/demo/make-gif.py" \
    "$dir" "$OUT/$output.raw.gif" "$fps" "$width" "$colors" 0.4 >/dev/null < /dev/null
  gifsicle -O3 --lossy=110 --colors "$colors" "$OUT/$output.raw.gif" \
    -o "$OUT/$output.gif" < /dev/null 2>/dev/null
  rm -f "$OUT/$output.raw.gif"
  ls -lh "$OUT/$output.gif" | awk '{print $9, $5}'
done
