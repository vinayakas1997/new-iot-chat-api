#!/bin/sh
# Rebuilds better-sqlite3 against this machine's Node headers.
# The stock prebuild targets ABI 108; this environment's Node 18 reports ABI
# 109 (see /usr/include/node/node_version.h), so the prebuild never loads.
# Runs automatically on `pnpm install` via postinstall; run manually with
# `pnpm run build:sqlite` after touching node_modules.
set -e
PKG_DIR=$(find node_modules/.pnpm -maxdepth 4 -name binding.gyp -path "*better-sqlite3*" -printf "%h\n" 2>/dev/null | head -1)
if [ -z "$PKG_DIR" ]; then
  echo "better-sqlite3 not found under node_modules/.pnpm; skipping"
  exit 0
fi
node /home/somic_cps/.local/lib/node_modules/pnpm/dist/node_modules/node-gyp/bin/node-gyp.js \
  rebuild --release --nodedir=/usr --directory="$PKG_DIR"
node -e "require('better-sqlite3'); console.log('better-sqlite3 loads OK')"
