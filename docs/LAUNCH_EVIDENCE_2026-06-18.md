# Launch Evidence Note - 2026-06-18

## Scope

This note tracks the remaining launch-hardening evidence for the PR after the paid-operation idempotency merge. It does not expand V1 scope.

## Production Provenance Baseline

- Live production URL: `https://pramania.com`.
- Verified production SHA before this hardening pass: `2d5f038a56a2ee13df44c78b1abe2893ea674d60`.
- Release endpoint: `GET /api/release`.
- Final acceptance still requires `/api/release` to report the final merged `main` SHA and production deployment metadata after this PR lands and deploys.

## Added In This Hardening Pass

- RevenueCat reversal lookup now orders matching purchases by `created_at`, the existing timestamp column on `revenuecat_events`.
- RevenueCat refund/reversal launch coverage now proves reversals do not grant credits and link to the original purchase ledger when possible.
- Trust-critical native browser confirmations/prompts were replaced with a shared in-app dialog for paid, destructive, owner/admin, profile-edit, library, and unsaved-navigation flows.
- New credit/quota reservations now require a non-null server-computed operation fingerprint.
- Legacy null-fingerprint compatibility remains limited to already-existing reserved/finalized reservations.
- Launch-readiness coverage now includes RPC-level operation fingerprint tests for same-key/same-fingerprint reuse, same-key/different-fingerprint rejection, and missing-fingerprint rejection.
- `ARCHITECTURE.md` now describes the current deployed V1 architecture instead of scaffold-era gaps.

## Still Gated Until Secure QA Run

The following evidence must be collected from a secure launch QA shell without printing secrets:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- `npm run test:e2e:smoke`
- `npm run test:e2e:accessibility`
- `npm run test:e2e:cross-browser`
- `npm run test:e2e:launch-readiness`
- `npm run release:preflight`
- `npm run release:state`
- `npm run release:verify`

The launch-readiness run requires:

- `RUN_LAUNCH_READINESS_GATES=1`
- `AUTH_REQUIRE_EMAIL_CODE=true`
- `RATE_LIMIT_BACKEND=supabase`
- `REVENUECAT_WEBHOOK_SECRET`
- QA user A/B credentials
- QA admin credentials
- Supabase service-role credentials

## Evidence To Retain Under `qa-artifacts/`

Raw evidence should remain untracked under `qa-artifacts/`:

- Command summaries and logs.
- Playwright screenshots and traces.
- Schema readiness evidence.
- Two-user isolation evidence.
- Privacy deletion/minimization evidence.
- RevenueCat duplicate, unknown-product, refund/reversal evidence.
- Owner/admin audit evidence.
- Hostile ingestion evidence.
- Signed-in workspace screenshots.
- Release provenance state including expected SHA, live SHA, deployment ID, deployment URL, migration-state evidence, and route smoke evidence.

## Current Launch Decision

Launch readiness remains gated until the secure launch-readiness suite runs without unexplained skips and production `/api/release` proves the deployed SHA equals the final merged `main` SHA.
