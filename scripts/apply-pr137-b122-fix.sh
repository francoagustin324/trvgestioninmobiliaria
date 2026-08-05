#!/usr/bin/env bash
set -euo pipefail

patch_file="scripts/pr137-b122-fix.patch"
script_file="scripts/apply-pr137-b122-fix.sh"

if [[ ! -f "$patch_file" ]]; then
  echo "La corrección temporal ya fue aplicada."
  exit 0
fi

git apply --check "$patch_file"
git apply "$patch_file"
rm -f "$patch_file" "$script_file"

git config user.name "francoagustin324"
git config user.email "francoagustinsolis@gmail.com"
git add -A
git commit -m "Cerrar panel temporal de contraste antes de validar acciones"
git push origin HEAD:agent/leads-ux-ui-professional-redesign
