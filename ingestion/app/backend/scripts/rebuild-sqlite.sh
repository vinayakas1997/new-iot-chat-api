#!/bin/sh
# Ensures better-sqlite3 loads on this machine's Node.
# Background: the stock prebuild targets common ABIs; exotic builds (like this
# box's custom Node 18 / ABI 109) need a source rebuild against local headers.
# In stock environments (incl. the Docker image) the prebuild loads and this
# script exits immediately.
# Runs automatically on `pnpm install` via postinstall; run manually with
# `pnpm run build:sqlite` after touching node_modules.
set -e
cd "$(dirname "$0")/.."
if node -e "require('better-sqlite3')" 2>/dev/null; then
  echo "better-sqlite3 loads OK (prebuild)"
  exit 0
fi
echo "better-sqlite3 prebuild does not load — rebuilding from source…"
PKG_DIR=$(find node_modules/.pnpm -maxdepth 4 -name binding.gyp -path "*better-sqlite3*" -printf "%h\n" 2>/dev/null | head -1)
if [ -z "$PKG_DIR" ]; then
  echo "better-sqlite3 not found under node_modules/.pnpm; skipping"
  exit 0
fi
if [ -f /usr/include/node/node_version.h ]; then
  NODIR_FLAG="--nodedir=/usr"
else
  NODIR_FLAG=""
fi
npx --yes node-gyp@10 rebuild --release $NODIR_FLAG --directory="$PKG_DIR"
node -e "require('better-sqlite3'); console.log('better-sqlite3 loads OK (rebuilt)')"
