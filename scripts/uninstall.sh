#!/bin/sh
set -eu

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

for bin in nac nac-web; do
  bin_path="$INSTALL_DIR/$bin"
  if [ -f "$bin_path" ]; then
    rm -f "$bin_path"
    echo "removed $bin_path"
  else
    echo "$bin is not installed at $bin_path"
  fi
done
