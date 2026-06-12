#!/usr/bin/env bash
set -euo pipefail

required=(
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "NEXT_PUBLIC_SITE_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "QA_DEMO_EMAIL"
  "QA_DEMO_PASSWORD"
  "QA_DEMO_USER_A_EMAIL"
  "QA_DEMO_USER_A_PASSWORD"
  "QA_DEMO_USER_B_EMAIL"
  "QA_DEMO_USER_B_PASSWORD"
  "QA_ADMIN_EMAIL"
  "QA_ADMIN_PASSWORD"
)

missing=()

for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ "${AUTH_REQUIRE_EMAIL_CODE:-}" != "true" ]]; then
  missing+=("AUTH_REQUIRE_EMAIL_CODE=true")
fi

if [[ "${RATE_LIMIT_BACKEND:-}" != "supabase" ]]; then
  missing+=("RATE_LIMIT_BACKEND=supabase")
fi

if (( ${#missing[@]} > 0 )); then
  printf 'QA environment is missing required configuration:\n' >&2
  printf -- '- %s\n' "${missing[@]}" >&2
  exit 1
fi

printf 'QA environment is configured.\n'
