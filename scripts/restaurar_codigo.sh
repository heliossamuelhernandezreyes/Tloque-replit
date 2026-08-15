#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
backup_input="${1:-}"
confirmation="${2:-}"

if [[ "$confirmation" != "RESTAURAR" || -z "$backup_input" ]]; then
  echo "Uso: bash scripts/restaurar_codigo.sh RUTA_DEL_RESPALDO RESTAURAR"
  exit 2
fi
if [[ ! -f "$backup_input" ]]; then
  echo "No existe el respaldo: $backup_input"
  exit 2
fi

backup_file="$(cd "$(dirname "$backup_input")" && pwd -P)/$(basename "$backup_input")"
allowed_dir="$project_dir/.tloque_backups/"
if [[ "$backup_file" != "$allowed_dir"* ]]; then
  echo "El respaldo debe estar dentro de $allowed_dir"
  exit 2
fi

managed=(
  client server shared script migrations tests scripts docs
  package.json package-lock.json tsconfig.json vite.config.ts drizzle.config.ts
  postcss.config.js tailwind.config.ts components.json
  .env.example README.md SECURITY_AUDIT.md
  INSTRUCCIONES_REPLIT.md AUDITORIA_RELEASE.md RELEASE_SOURCE.json
)

for path in "${managed[@]}"; do
  rm -rf -- "$project_dir/$path"
done
rm -rf -- "$project_dir/dist"
tar -xzf "$backup_file" -C "$project_dir"

cd "$project_dir"
# El instalador ya dejó node_modules completo. Este rollback conserva esas
# dependencias para no convertir una restauración de emergencia en otra descarga.
if ! npm run check; then
  echo "Advertencia: el código fue restaurado, pero su comprobación TypeScript falla." >&2
  echo "Si hace falta, ejecuta npm install manualmente cuando tengas una conexión estable." >&2
fi
if [[ -f script/build.ts ]]; then
  if ! npm run build; then
    echo "Advertencia: el código anterior fue restaurado, pero su build falla." >&2
  fi
else
  echo "El código anterior no incluía script/build.ts; se omite el build."
fi
echo "Código restaurado desde: $backup_file"
