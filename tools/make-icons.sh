#!/usr/bin/env bash
# Regenerate the PNG icons from icons/icon.svg.
#
# Reproducible on purpose: binary icons of unknown origin are the kind of thing
# nobody can safely change later. Uses macOS's built-in rsvg/qlmanage-free path
# via `sips` if available, else ImageMagick, else Chrome headless.
set -euo pipefail
cd "$(dirname "$0")/.."
SVG=icons/icon.svg

render() { # size
  local size=$1 out="icons/icon-$1.png"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$SVG" -resize "${size}x${size}" "$out"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 384 "$SVG" -resize "${size}x${size}" "$out"
  else
    echo "Need rsvg-convert or ImageMagick to rebuild icons." >&2
    exit 1
  fi
  echo "wrote $out"
}

for s in 180 192 512; do render "$s"; done
