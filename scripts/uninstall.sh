#!/bin/sh
set -eu

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BIN_PATH="$INSTALL_DIR/nac"

if [ -f "$BIN_PATH" ]; then
  rm -f "$BIN_PATH"
  echo "removed $BIN_PATH"
else
  echo "nac is not installed at $BIN_PATH"
fi
