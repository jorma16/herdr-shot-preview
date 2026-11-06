#!/bin/sh
# Copies the mods (mods/*) into Herdr's mods folder. A copy, not a symlink: Herdr only loads
# images whose real path is inside its home, and doesn't hot reload on changes it sees through
# a symlink. For live editing, run `npm run dev` (copies again on every save).
# Herdr's own gpui-kit.d.ts in each copy is left alone.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
mods="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"

mkdir -p "$mods"
for src in "$repo"/mods/*/; do
  name=$(basename "$src")
  target="$mods/$name"
  [ -L "$target" ] && rm "$target"
  rsync -a --delete --exclude gpui-kit.d.ts "$src" "$target/"
  echo "installed: $target"
  if [ "${1:-}" != "--quiet" ] && command -v herdr-app >/dev/null; then
    herdr-app check "$target"
  fi
done
