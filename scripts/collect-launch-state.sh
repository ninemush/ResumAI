#!/usr/bin/env bash
set -euo pipefail

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="qa-artifacts/launch-state-$timestamp"
mkdir -p "$output_dir"

{
  printf 'Launch state collected at %s\n' "$timestamp"
  printf 'Node: %s\n' "$(node --version)"
  printf 'npm: %s\n' "$(npm --version)"
  printf 'Git SHA: %s\n' "$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
  printf 'Branch: %s\n' "$(git branch --show-current 2>/dev/null || printf 'unknown')"
} > "$output_dir/environment.txt"

npm run lint > "$output_dir/lint.log" 2>&1
npx tsc --noEmit --pretty false > "$output_dir/typecheck.log" 2>&1
npm run test:unit > "$output_dir/unit.log" 2>&1
RELEASE_PROVENANCE_OUTPUT_DIR="$output_dir/release-provenance" \
  node scripts/verify-release-provenance.mjs --allow-blocked \
  > "$output_dir/release-provenance.log" 2>&1

printf 'Launch state artifacts written to %s\n' "$output_dir"
