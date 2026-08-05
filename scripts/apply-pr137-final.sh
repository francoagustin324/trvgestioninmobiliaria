#!/usr/bin/env bash
set -euo pipefail

git apply scripts/pr137-test-compact.patch
git apply scripts/pr137-test-matrix.patch
git apply scripts/pr137-test-responsive.patch
git apply scripts/pr137-test-redesign.patch
mv scripts/pr137-ci-final.yml .github/workflows/ci.yml
rm -f \
  scripts/pr137-final-1.patch \
  scripts/pr137-final-2.patch \
  scripts/pr137-test-compact.patch \
  scripts/pr137-test-matrix.patch \
  scripts/pr137-test-responsive.patch \
  scripts/pr137-test-redesign.patch \
  scripts/apply-pr137-final.sh
touch .github/pr137-ci-trigger

git config user.name "francoagustin324"
git config user.email "francoagustinsolis@gmail.com"
git add -A
git commit -m "Corregir bloqueantes finales del rediseño profesional de Leads"
git push origin HEAD:agent/leads-ux-ui-professional-redesign
