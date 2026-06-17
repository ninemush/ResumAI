#!/usr/bin/env bash
set -euo pipefail

failures=()

record_failure() {
  failures+=("$1")
  printf 'FAIL: %s\n' "$1" >&2
}

require_command() {
  local command_name="$1"
  local label="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    record_failure "$label is required for release validation."
  fi
}

require_npx_tool() {
  local package_bin="$1"
  local label="$2"

  if ! npx --no-install "$package_bin" --version >/dev/null 2>&1; then
    record_failure "$label is required for release validation."
  fi
}

require_command git "Git CLI"
require_command npm "npm"
require_npx_tool vercel "Vercel CLI"
require_npx_tool supabase "Supabase CLI"

if ! git ls-remote --exit-code origin main >/dev/null 2>&1; then
  record_failure "GitHub repository access is required to verify origin/main."
fi

if (( ${#failures[@]} > 0 )); then
  printf '\nRelease preflight blocked before checks could run.\n' >&2
  exit 2
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "main" ]]; then
  record_failure "Release preflight must run from main; current branch is ${current_branch:-unknown}."
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  record_failure "Release preflight requires a clean tracked worktree."
fi

git fetch origin main >/dev/null 2>&1
head_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
if [[ "$head_sha" != "$origin_sha" ]]; then
  record_failure "HEAD must match origin/main before production release validation."
fi

if ! npx supabase migration list >/dev/null 2>&1; then
  record_failure "Supabase migration state could not be read; database migration evidence is missing."
fi

if (( ${#failures[@]} > 0 )); then
  printf '\nRelease preflight blocked.\n' >&2
  exit 2
fi

npm run lint
npm run typecheck
npm run test:unit

printf 'Release preflight passed for %s on main.\n' "$head_sha"
