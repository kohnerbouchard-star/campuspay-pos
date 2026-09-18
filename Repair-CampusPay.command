#!/usr/bin/env bash
set -euo pipefail
PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo 'Node.js 22.9 or newer must be installed.' >&2; exit 1; }
exec node "$PACKAGE_DIR/scripts/repair-local.mjs" "$@"
