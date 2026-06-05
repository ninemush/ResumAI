# Launch Readiness Remediation Report

Last updated: 2026-06-05

This is the living launch-readiness tracker created from the multi-agent review. It records what has been addressed, dismissed by owner decision, still pending, or moved to backlog. It is an engineering readiness record, not legal advice, launch approval, SOC/ISO certification, or a substitute for production QA against real Supabase/payment credentials.

## Addressed

| Review item | Status | Notes |
| --- | --- | --- |
| P0-2 public trust/compliance draft language | Addressed in code | Data retention, subprocessors, security overview, and compliance config now use launch-honest language without certification claims. The pages are clearer about pending legal/region/DPA/transfer review and operational deletion/minimization boundaries. |
| P0-4 expensive workflow retry/idempotency risk | Addressed in code | Resume, application-material, and job-ingestion paths now reuse existing generated/exported work where practical and normalize failure envelopes. Explicit auth gates were added before credit-consuming operations where anonymous RPC calls could become generic 500s. |
| P0-5 support privacy and operational readiness | Addressed in code | User-facing support reads no longer expose owner notes/internal triage fields. Support intake now sanitizes details, makes workspace context opt-in, builds L1 support packet metadata, adds L0 quick help, and includes regression coverage. |
| P0-6 security hardening | Addressed in code | URL safety blocks more internal/private hosts, rate-limit keys hash subjects/IPs and ignore host-header bypasses, redaction catches more sensitive keys, CSP/security headers were added, and auth-lockout SQL was hardened. |
| P0-7 owner/admin tier configuration | Addressed in code | Added owner/admin tier listing and create/update flow in the Owner Console, backed by `/api/admin/tiers`, with validation, admin checks, and audit-event attempts. |
| P1 PDF/export readiness | Addressed in code | Export readiness now validates generated PDF text/content more strictly and avoids treating stale/missing artifacts as already export-ready after edits. |
| P1 API response contracts | Addressed in code | Added shared API response helpers and normalized envelopes for resume, application material, job ingestion, profile-source extraction, and billing auth paths covered by tests. |
| P1 L0 help and L1 support packets | Addressed in code | Support now has quick-help guidance, opt-in context handling, redaction/minimization, and L1 packet metadata for escalation. |
| P1 novice-hostile labels | Addressed in code | Primary navigation now says `Home` instead of `Cockpit`; profile surface copy now says `Profile home`/career overview. Internal CSS/component names remain unchanged. |
| P2 hardcoded product names | Addressed in code | User-facing app/component/API/advisor copy now routes through `lib/brand.ts`; remaining `Pramania` hits are the configured fallback, asset/user-agent identifiers, and product IDs. |
| P2 regression tests | Addressed in code | Added/updated focused tests for support privacy, security helpers/headers, URL safety, API envelopes, auth contracts, and generation/export routes. |

## Dismissed

| Review item | Decision | Notes |
| --- | --- | --- |
| Remove/disable payment gateway | Dismissed by owner | Live payments are explicitly approved. The payment gateway remains enabled and RevenueCat/credit-pack posture is treated as in-scope for launch. |

## Pending Before Broad Public Launch

| Area | Owner | Required follow-up |
| --- | --- | --- |
| Real QA user/credit persona testing | Engineering/owner | Run seeded user flows against a real QA Supabase project with test payment credentials. This local workspace only had placeholder public Supabase env, so signed-in journey tests skipped. |
| Public policy legal review | Owner/legal | Review Terms, Privacy Policy, Data Retention Policy, AI Use Notice, Subprocessor List, and Security Overview before public launch claims. |
| Retention periods and exceptions | Owner/legal/ops | Approve exact periods by data category and exceptions for quota, billing, security, fraud, disputes, accounting, refunds, and legal holds. |
| Subprocessor/payment operations | Owner/legal/ops | Confirm Supabase, Vercel, OpenAI, and RevenueCat regions, DPAs, transfer basis, refund handling, entitlement reconciliation, failed-webhook recovery, and receipt support. |
| Admin access review | Owner/security | Define owner/admin inventory cadence, removal process, and sensitive-action review. |
| Tier assignment management | Product/engineering | This pass added tier configuration; assigning/reassigning users to tiers remains a separate owner workflow. |
| Production observability review | Engineering/ops | Verify headers, rate limits, support escalation, payment webhooks, and credit ledger behavior in production-like logs after deployment. |

## Backlog

| Area | Reason |
| --- | --- |
| Granular user fact confirmation UI | Not explicitly requested in this fix pass. Still high-value: approve/correct/reject learned facts before resume generation and role recommendations. |
| Claim-level evidence ledger | Differentiator backlog: source-to-claim receipts for resume bullets, cover-letter claims, and job-fit recommendations. |
| Confidential achievement mode | Differentiator backlog for senior users: public/anonymized/private/never-use fact controls. |
| First-session confidence ladder | Differentiator backlog for novice users: source added, facts found, facts confirmed, role lane chosen, resume ready, job fit reviewed, packet exported. |
| Tier assignment UI | Useful next owner workflow, separate from tier configuration. |
| Formal compliance evidence package | Requires legal/security review, exact subprocessors/regions, operational runbooks, and external security review. |

## Verification

- `npx tsc --noEmit --pretty false` passed.
- `npm run lint -- --max-warnings=0` passed.
- `git diff --check` passed.
- `npm run build` passed.
- Focused regression run passed: `21 passed`.
- Full Playwright run passed for available local coverage with placeholder public Supabase env: `76 passed`, `11 skipped`.
- Skipped tests were signed-in/demo-user journey checks that require real QA Supabase/demo credentials.

## Payment Scope Note

Live payment gateway support is now treated as an approved launch requirement. Future launch reviews should evaluate payment reliability, reconciliation, refunds, and entitlement support instead of flagging the gateway's existence as a scope violation.
