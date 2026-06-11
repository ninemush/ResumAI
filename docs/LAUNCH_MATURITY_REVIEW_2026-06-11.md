# Pramania Launch Maturity Review

Date: 2026-06-11  
Baseline: `docs/QA_LAUNCH_READINESS_2026-06-05.md`  
Purpose: compare the launch QA findings against the current codebase and track maturity of Pramania's launch controls as a whole.

## Maturity Levels

- `documented`: requirement or risk is described, but code evidence is not enough.
- `implemented`: code exists for the control, but automated or operational evidence is incomplete.
- `tested`: automated tests prove the normal and important failure paths.
- `operationally proven`: tests pass with real QA/provider credentials and retained launch evidence.

Public-launch posture:

- P0 areas must reach `operationally proven`.
- P1 areas must reach at least `tested`, with owner procedures documented.
- P2 areas can remain backlog if they do not weaken a P0/P1 control.

## Current Maturity Matrix

| Area | QA priority | Current code evidence | Current maturity | Remaining risk type | Required next step |
| --- | --- | --- | --- | --- | --- |
| Privacy deletion/minimization | P0 | `lib/privacy/deletion-plan.ts` builds and executes plans; `app/api/admin/privacy/requests/[id]/route.ts` exposes `build_deletion_plan` and `complete_deletion_review`. | implemented | Missing automated proof and operational proof | Add launch-gated seeded admin test proving deleted, minimized, retained-with-reason, storage, and audit outcomes. |
| AI fact evidence and unsupported claims | P0/P1 | Profile facts store evidence status; master resume and application material prompts distinguish confirmed/source-supported from inferred/conflicting/missing evidence. | implemented | Missing automated proof and a stronger export-time user review gate | Add unit/API tests for ambiguous facts and ensure unresolved high-impact facts trigger review-before-use before export. |
| Two-user isolation | P0 | `tests/e2e/two-user-isolation.spec.ts` covers profile sources, privacy requests, support issues, credit history visibility, and admin denial. | tested, partial | Missing automated proof across jobs, applications, artifacts, downloads, exports, and mutations | Expand two-user test with seeded records and owner/admin positive checks. |
| Signed-in upload accessibility | P0 | `components/conversation/conversation-panel.tsx` gives the hidden file input an accessible name; signed-in workspace test asserts the label and control link. | tested | Missing operational proof with gated axe run | Run `npm run test:e2e:accessibility` with signed-in QA credentials before launch. |
| Credit reservation/idempotency | P0 | Main credit-consuming routes call reserve/finalize/release helpers; RevenueCat webhook checks duplicate event IDs. | implemented | Missing automated proof for duplicate click, same-key retry, failures, reuse, stale reservations, and duplicate webhook | Add unit/API tests distinguishing same-key retry from duplicate UI action and prove ledger metadata/output linkage. |
| Jobs desktop density | P1 | Jobs panel is compact; authenticated workspace test checks compact record position when records exist. | tested, partial | Missing seeded operational proof | Run desktop signed-in test with seeded job records and retain screenshot/test output evidence. |
| Payment and credit operations | P1 | RevenueCat webhook, credit ledger, purchase options, owner reconciliation copy, and credit history exist. | implemented | Missing provider proof | Run sandbox/live-provider purchase, duplicate webhook, credit visibility, and refund/reconciliation procedure. |
| Support/privacy owner operations | P1 | Owner console has trust filters, owner notes, verification requirement, privacy request aging, and compliance dashboard. | implemented | Missing seeded automated proof and procedure evidence | Add seeded owner-operation checks and document privacy/billing escalation procedure. |
| Hostile file/OCR negative coverage | P2 | URL safety and ingestion validation exist; file-level negative fixture depth is limited. | documented | Backlog unless source ingestion changes | Add corrupted/oversized/misleading/OCR fixtures after P0/P1 closure. |
| Owner metrics estimate discipline | P2 | Owner console labels finance data as estimates and includes reconciliation checklist. | implemented | Missing export/reconciliation evidence | Keep estimate language; add date-range export only when owner reporting requires it. |

## System-Level Readout

Pramania has moved from feature absence toward control maturity. The weakest launch risks are not broad product gaps; they are proof gaps around user trust: deletion outcomes, cross-user isolation, credit fairness, and AI factuality. The next work should therefore prioritize seeded, credentialed, launch-gated evidence over rebuilding implemented flows.

## 2026-06-11 Local QA Pass Addendum

The local signed-in workspace blocker from the QA demo account is fixed. The crash was caused by launch code reading artifact and owner-audit fields/tables that are present in migrations but absent from the connected Supabase QA schema. The app now fails soft for non-critical artifact overview and owner metrics audit reads, while sensitive owner override and source-review actions still fail closed if audit logging cannot be written.

The connected Supabase project was brought back in sync on 2026-06-11 by applying:

- `20260611120000_close_resolved_owner_error_noise.sql`
- `20260611133000_reliability_payments_canonical_profile.sql`
- `20260611143000_fix_supabase_lint_findings.sql`

After the migration push, the PostgREST schema cache was reloaded and the signed-in workspace was verified in the in-app browser with no `ARTIFACT_OVERVIEW_READ_FAILED` overlay and no recurring `admin_access_audit_events` schema-cache error in the server output.

Current local evidence:

- `npm run lint`: passed.
- `npm run test:unit`: passed, 15 files / 47 tests.
- `npm run build`: passed.
- `npm run test:e2e:accessibility` with `.env.local` QA demo credentials: passed, 5 tests including signed-in workspace.
- `npm run test:e2e -- tests/e2e/authenticated-workspace.spec.ts --project=chromium-desktop` with `.env.local` QA demo credentials: passed, 9 tests / 2 desktop-inapplicable skips.
- `npm run test:e2e:smoke` with `.env.local` QA demo credentials: passed, 175 tests / 29 expected skips.
- `npm run test:e2e -- tests/e2e/user-journey-qa.spec.ts --project=chromium-mobile` after mobile record-density fixes: passed, 0 findings / 0 console errors.
- `npm run test:e2e -- tests/e2e/authenticated-workspace.spec.ts --project=chromium-mobile -g "keeps record-heavy workspace pages|keeps profile mode chat-first|deduplicates advisor chips"`: passed, 3 tests.
- `RUN_LAUNCH_READINESS_GATES=1 npm run test:e2e -- tests/e2e/schema-readiness-maturity.spec.ts --project=chromium-desktop`: passed after the migration push, proving `generated_resumes.version_number`, `generated_cover_letters.version_number`, and `admin_access_audit_events` exist in the connected schema.
- `npm run test:e2e:cross-browser` with `.env.local` QA demo credentials: passed, 267 tests / 39 expected skips across Chromium, Firefox, and WebKit.
- `RUN_LAUNCH_READINESS_GATES=1 npm run test:e2e -- tests/e2e/two-user-isolation.spec.ts tests/e2e/privacy-deletion-execution.spec.ts tests/e2e/revenuecat-webhook-idempotency.spec.ts tests/e2e/jobs-density-maturity.spec.ts --project=chromium-desktop`: 5 skipped because dedicated launch fixtures/provider evidence are not configured locally.

Remaining deployment blockers:

- Missing operational proof: launch-gated seeded tests still skip without full `QA_DEMO_USER_A`, `QA_DEMO_USER_B`, `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD`, `RUN_LAUNCH_READINESS_GATES=1`, and service-role fixture access.
- Owner audit schema exists in the connected project, but owner audit evidence is not operationally proven until seeded owner/admin actions assert created audit rows.
- RevenueCat/Stripe sandbox purchase, duplicate webhook, refund, and reconciliation evidence remain unproven.

## Launch Evidence To Retain

- Test command and date.
- Environment type: local QA, Supabase QA project, provider sandbox, or live-provider test.
- Seeded user roles used: normal user A, normal user B, owner/admin, paid-credit user.
- Relevant screenshots or Playwright traces for accessibility and density.
- Provider event IDs for RevenueCat/Stripe purchase and duplicate webhook checks.
- Privacy deletion request ID and audit event ID from the positive deletion execution test.
