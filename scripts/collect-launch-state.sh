#!/usr/bin/env bash
set -uo pipefail

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="qa-artifacts/launch-state-$timestamp"
target_url="${RELEASE_PROVENANCE_URL:-${PLAYWRIGHT_BASE_URL:-${NEXT_PUBLIC_SITE_URL:-https://pramania.com}}}"
mkdir -p "$output_dir"

run_step() {
  local label="$1"
  local output_file="$2"
  shift 2

  printf '%s\n' "$*" > "$output_dir/$output_file.command"
  if "$@" > "$output_dir/$output_file" 2>&1; then
    printf '%s=passed\n' "$label" >> "$output_dir/status.env"
  else
    local status=$?
    printf '%s=failed:%s\n' "$label" "$status" >> "$output_dir/status.env"
  fi
}

tool_status() {
  local label="$1"
  shift

  if "$@" >/dev/null 2>&1; then
    printf '%s=available\n' "$label"
  else
    printf '%s=missing_or_blocked\n' "$label"
  fi
}

expected_sha="$(git rev-parse origin/main 2>/dev/null || git rev-parse HEAD 2>/dev/null || printf 'unknown')"

{
  printf 'Launch state collected at %s\n' "$timestamp"
  printf 'Target URL: %s\n' "$target_url"
  printf 'Expected SHA: %s\n' "$expected_sha"
  printf 'Local HEAD: %s\n' "$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
  printf 'Origin main: %s\n' "$(git rev-parse origin/main 2>/dev/null || printf 'unknown')"
  printf 'Branch: %s\n' "$(git branch --show-current 2>/dev/null || printf 'unknown')"
  printf 'Node: %s\n' "$(node --version 2>/dev/null || printf 'missing')"
  printf 'npm: %s\n' "$(npm --version 2>/dev/null || printf 'missing')"
} > "$output_dir/environment.txt"

{
  tool_status git git --version
  tool_status npm npm --version
  tool_status vercel npx --no-install vercel --version
  tool_status supabase npx --no-install supabase --version
  tool_status github_repo git ls-remote --exit-code origin main
} > "$output_dir/tool-availability.env"

run_step lint lint.log npm run lint
run_step typecheck typecheck.log npm run typecheck
run_step unit unit.log npm run test:unit
run_step supabase_migrations supabase-migrations.log npx supabase migration list

RELEASE_EXPECTED_SHA="$expected_sha" \
RELEASE_PROVENANCE_OUTPUT_DIR="$output_dir/release-provenance" \
RELEASE_PROVENANCE_URL="$target_url" \
  run_step release_provenance release-provenance.log node scripts/verify-release-provenance.mjs

RELEASE_PROVENANCE_URL="$target_url" \
  node --input-type=module > "$output_dir/route-smoke.json" 2> "$output_dir/route-smoke.log" <<'NODE'
const targetUrl = process.env.RELEASE_PROVENANCE_URL ?? "https://pramania.com";
const response = await fetch(new URL("/api/release", /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`), {
  headers: { Accept: "application/json" },
});
const payload = await response.json().catch(() => null);
console.log(JSON.stringify({
  ok: response.ok,
  responseStatus: response.status,
  release: payload?.release ?? null,
}, null, 2));
process.exit(response.ok ? 0 : 1);
NODE
route_smoke_status=$?
if [[ "$route_smoke_status" -eq 0 ]]; then
  printf 'route_smoke=passed\n' >> "$output_dir/status.env"
else
  printf 'route_smoke=failed:%s\n' "$route_smoke_status" >> "$output_dir/status.env"
fi

printf 'Launch state artifacts written to %s\n' "$output_dir"
