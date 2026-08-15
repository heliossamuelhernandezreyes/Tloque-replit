#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$project_dir"

mode="${1:-REVISAR}"
case "$mode" in
  REVISAR)
    node scripts/preflight.mjs
    ;;
  APLICAR)
    node scripts/preflight.mjs
    node scripts/migrate.mjs --apply
    ;;
  *)
    echo "Uso: bash scripts/migrar.sh REVISAR"
    echo "  o: bash scripts/migrar.sh APLICAR"
    exit 2
    ;;
esac
