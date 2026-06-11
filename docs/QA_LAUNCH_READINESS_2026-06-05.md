# Pramania Launch Readiness QA Report

Date: 2026-06-05  
Status: Reconstructed after accidental deletion of the original generated report; reviewed for current relevance on 2026-06-11  
Scope: End-to-end application QA, negative testing, first-session UX, accessibility, trust/compliance posture, credits/payment readiness, owner/admin readiness, and public-launch risk.

## Reconstruction Note

The original `QA_LAUNCH_READINESS_2026-06-05.md` file was accidentally removed during a requested cleanup. This replacement is rebuilt from retained run notes, test outputs, and the findings summary from the completed QA pass. It is not guaranteed to be byte-for-byte identical to the original, but it preserves the material launch findings, evidence, priorities, and implementation plan needed for follow-up work.

## Current Status Review - 2026-06-11

This report is still relevant and should be preserved as a launch-readiness baseline, but it should not be read as fully current product status. A code review on 2026-06-11 found that several June 5 blockers have since been addressed or partially addressed in the working tree. The remaining launch risk is now concentrated in verification depth, test coverage, and operational proof rather than a total absence of implementation.

Current disposition:

- P0-1 privacy deletion/minimization: partially addressed. `lib/privacy/deletion-plan.ts` now includes `completeDeletionReviewForRequest` and an executable `executeDeletionPlan` path that deletes editable profile/source/master-resume data, minimizes application/material records, records retained categories, deletes storage paths where planned, and writes a privacy audit event. `app/api/admin/privacy/requests/[id]/route.ts` exposes `build_deletion_plan` and `complete_deletion_review` owner/admin actions. Remaining launch work: add positive end-to-end tests proving the execution path deletes/minimizes the intended records and preserves only audit-safe evidence.
- P0-2 inferred/unsupported profile facts: partially addressed. Profile facts and generated-material prompts now use evidence statuses such as `user_confirmed`, `source_supported`, `inferred`, `conflict`, and `missing_evidence`; master-resume generation instructs the model not to use unresolved facts as hard claims. Remaining launch work: add ambiguous/conflicting source tests and make the user-facing review-before-use moment unmistakable for high-impact facts.
- P0-3 two-user isolation: partially addressed. `tests/e2e/two-user-isolation.spec.ts` now covers profile sources, privacy requests, support issues, credit history visibility, and admin metrics denial when QA two-user credentials are configured. Remaining launch work: expand coverage to jobs, applications, generated materials, exports/artifacts, archive/mutation by foreign IDs, and owner/admin positive access; then run the suite with real QA credentials and save evidence.
- P0-4 signed-in file upload accessibility: appears addressed. `components/conversation/conversation-panel.tsx` now gives the hidden file input the accessible name `Attach resume, career source, or profile file`, and `tests/e2e/authenticated-workspace.spec.ts` asserts the accessible name and `aria-controls` link from the visible attach button. Remaining launch work: run the gated signed-in accessibility suite and keep this as a regression check.
- P0-5 credit operation atomicity/idempotency: partially addressed. Credit-consuming routes now use reservation/finalization/release helpers and operation keys, with reusable-output checks on some paths. Remaining launch work: add and run failure-before-output, duplicate-click, retry-after-success, retry-after-release, and duplicate webhook tests against the actual ledger/reservation behavior.
- P1-1 Jobs first-viewport density: partially addressed. The Jobs surface is more compact and `tests/e2e/authenticated-workspace.spec.ts` includes a desktop density assertion when records exist. Remaining launch work: run with seeded job records and assert the first job row remains above the agreed desktop threshold.
- P1-2 payment/credit launch operations: still relevant. Payments and credits remain approved V1 scope. The open work is operational verification: sandbox/live-provider purchase, duplicate webhook, refund/reversal support, and ledger reconciliation evidence.
- P1-3 support/privacy SLA discipline: still relevant. Owner support and compliance surfaces exist, but launch readiness still depends on filters, aging signals, owner-only notes, and a repeatable privacy/billing escalation procedure.
- P1-4 review-before-use for generated resume/profile claims: still relevant. There are proof surfaces and evidence-aware prompts, but launch should still require a concise user review step for inferred, conflicting, or high-impact claims before export or tailoring.
- P2 items remain valid backlog unless a later QA pass supersedes them.

Recommended file disposition: preserve this report, ideally under `docs/`, with this current-status section. Use it as a punch list until a newer launch-readiness QA report replaces it.

## Executive Summary

Pramania is substantially closer to launch than the earlier June remediation reports suggested. The app has a coherent V1 boundary, guarded credit-consuming workflows, a usable signed-in workspace, owner/admin surfaces, support/privacy foundations, and passing broad unauthenticated API coverage across browsers.

It is not yet public-launch ready at a world-class bar. The remaining blockers are concentrated in trust, correctness, accessibility, and launch-proof evidence rather than general feature absence. The highest-risk areas are:

- Privacy deletion requests are recorded/reviewed, but the tested path does not prove actual deletion/minimization execution.
- AI-derived profile facts can still feel too authoritative when evidence is inferred, incomplete, or unconfirmed.
- Two-user data isolation needs explicit automated RLS evidence before public launch.
- A hidden file-upload input fails a critical signed-in accessibility check.
- Credit-consuming operations still need stronger atomicity/idempotency evidence so users are not charged credits for failed or duplicate work.
- The signed-in Jobs view is too sparse on desktop; the first job row landed below the expected first-viewport threshold during testing.

Owner note after QA: live payments/credits are approved and the existing RevenueCat/Stripe setup should be treated as in scope. Do not remove or re-architect payment functionality unless separately requested.

## Test Coverage Completed

### Automated Verification

- `npm run lint`: passed.
- `npm run test:unit`: 15 passed.
- Installed missing Playwright browser engines for Firefox/WebKit after initial full-suite failures due missing browsers.
- Cross-browser unauthenticated and API suite: 228 passed, 48 skipped.
- Seeded a QA owner/demo account with credits through Supabase service-role tooling for signed-in flows.
- Signed-in desktop/mobile suite: 14 passed, 7 expected skips, 1 real failure.
- Public accessibility pass: passed.
- Signed-in accessibility pass: failed one critical axe violation.
- `npm run build`: passed.

### Real-User Simulation Personas

The pass used fewer than 10 personas, with six delegated reviewer passes plus main-run support/security coverage:

- First-time career changer: tested first 5-10 minute hook, onboarding clarity, source upload, and profile build.
- Busy mid-career applicant: tested job URL ingestion, fit review, material generation, export readiness, and credit consumption expectations.
- Detail-oriented resume reviewer: tested master resume generation, evidence quality, factuality, chronology, and unsupported claims.
- Privacy-sensitive user: tested terms, AI notices, data export, privacy requests, support privacy, and deletion posture.
- Owner/admin operator: tested owner metrics, promo/credit management, tier configuration, support/compliance visibility.
- Mobile constrained user: tested narrow viewport navigation, signed-in workspace usability, density, and blocked/low-credit states.
- Negative/security adversary in main run: tested unauthenticated APIs, invalid IDs, malformed payloads, hostile URLs, and auth gates.
- Support/refund user in main run: tested support escalation language, billing/refund routing expectations, and audit-sensitive history.

## Launch Findings

### P0-1: Privacy Deletion Is a Request Workflow, Not an Executed Deletion Workflow

Priority: P0 launch blocker  
Area: Privacy, trust, compliance operations  
Evidence: Privacy request and export flows exist. `lib/privacy/deletion-plan.ts` identifies retention-sensitive records, and the Settings UI lets users request account deletion. The tested path records/reviews deletion but does not prove that eligible records are deleted, minimized, or tombstoned through an executable owner/admin workflow.

Impact: Public users who click "Delete account" will expect meaningful deletion or minimization. If the product only creates a review ticket, the app risks a severe trust break, support escalation, and legal exposure.

Implementation direction:

- Add an owner/admin deletion execution endpoint or workflow that consumes the existing deletion plan.
- For each data category, explicitly mark: deleted, minimized, retained with reason, or blocked pending review.
- Preserve minimum audit/billing/security evidence only where justified.
- Write privacy audit events for each executed action.
- Update Settings copy so "Delete account" accurately distinguishes immediate request creation from completed deletion.
- Add tests for deletion request creation, owner execution, retained ledger evidence, and removed/minimized profile/source/application data.

### P0-2: Inferred Profile Facts Can Still Feel Over-Confirmed

Priority: P0 launch blocker  
Area: AI accuracy, resume trust, first-time-right quality  
Evidence: The product has improved proof surfaces, but the QA pass still found risk that inferred or incomplete facts can be presented too confidently. For a career product, one fabricated date, employer, title, credential, or seniority inference can break user trust immediately.

Impact: Users may export or apply with inaccurate career facts. This directly harms launch quality, perceived intelligence, and user safety.

Implementation direction:

- Treat every extracted fact as one of: user-confirmed, source-supported, inferred, conflict, or missing evidence.
- In generation prompts and UI, prevent inferred/conflicting facts from appearing as hard truth without clear wording.
- Add source evidence chips or "needs confirmation" markers for sensitive facts: title, company, dates, education, certifications, location, seniority, salary, eligibility, and skills.
- Add tests using deliberately ambiguous resumes/notes to prove the system asks for confirmation instead of inventing certainty.

### P0-3: Two-User Data Isolation Needs Explicit RLS Evidence

Priority: P0 launch blocker  
Area: Security, privacy, Supabase RLS  
Evidence: Many authenticated and unauthenticated API tests passed, and the app uses user-scoped Supabase access patterns. However, the launch QA did not produce enough automated two-user evidence proving User A cannot read, mutate, export, archive, or generate from User B's records across profile sources, jobs, applications, materials, support issues, privacy requests, credit history, and artifacts.

Impact: A single cross-user leak would be catastrophic at public launch.

Implementation direction:

- Create two seeded non-admin users with separate records and credits.
- Add automated tests for all user-owned tables and API routes:
  - User A cannot read User B records.
  - User A cannot mutate/archive/export/generate against User B IDs.
  - User A cannot see User B credit ledger, privacy requests, support issues, or artifacts.
  - Admin-only routes reject non-admin users.
- Add owner/admin positive tests to prove intended elevated access still works.
- Add a launch checklist item requiring RLS test pass before deploy.

### P0-4: Signed-In Workspace File Upload Fails Critical Accessibility

Priority: P0 launch blocker  
Area: Accessibility, source ingestion, signed-in first workflow  
Evidence: Signed-in axe scan failed a critical `label` violation for the hidden file input:

```html
<input accept=".pdf,.docx,.txt,.csv,.zip,.jpg,.jpeg,.png,.webp" class="sr-only" multiple="" type="file">
```

Likely surface: `components/conversation/conversation-panel.tsx`.

Impact: Screen-reader and assistive-tech users may not be able to reliably identify or use the file upload control. This is central to the first-session profile build.

Implementation direction:

- Give the hidden file input an accessible name via a real `<label htmlFor>` or `aria-label`.
- Ensure the visible upload/drop action is keyboard-operable and programmatically connected to the input.
- Re-run signed-in accessibility checks across desktop and mobile.
- Add a regression assertion for the file input accessible name.

### P0-5: Credit-Consuming Operations Need Stronger Atomicity and Idempotency Evidence

Priority: P0 launch blocker  
Area: Billing/credits, trust, reliability  
Evidence: Credit gates exist for source extraction, job ingestion, master resume generation/export, and application material generation/export. The remaining launch risk is proving users are not charged twice for retries or charged once for failed work that produces no usable output.

Impact: Credit loss is a high-trust failure. A public user who pays and then loses credits due to retry/failure will likely churn and contact support.

Implementation direction:

- For each credit-consuming endpoint, add an operation key/idempotency key tied to user, resource, feature, and content/version.
- Consume credits inside a transaction only when the durable output state is created or reused.
- Reuse existing generated/exported outputs where inputs have not changed.
- Record ledger metadata showing operation id, resource id, input hash/version, and output artifact id.
- Add tests for network retry, duplicate click, server failure before output, server failure after output, and successful retry reuse.

### P1-1: Jobs Desktop Density Misses the First-Viewport Hook

Priority: P1 high  
Area: UX/UI, first 5-10 minute hook, signed-in workspace  
Evidence: Signed-in desktop test failure: first job row rendered at `y=673`, while the expected threshold was `<352`.

Impact: Jobs are a core value surface. On desktop, users may see too much chrome/empty explanation before the actual work product, weakening the first-session hook.

Implementation direction:

- Reduce top spacing in the signed-in Jobs view.
- Bring the first job row/card into the first viewport on common laptop heights.
- Keep help text compact and contextual.
- Add visual regression or layout assertion for first job row position.

### P1-2: Payment/Credit Launch Needs Final Operational Verification, Not Removal

Priority: P1 high  
Area: Payments, credits, support, owner operations  
Evidence: Public pricing, credit packs, purchase history, owner metrics, and payment-provider webhook code exist. Owner clarified after QA that payment/credits functionality is approved and RevenueCat/Stripe are already configured.

Impact: The risk is no longer V1 scope conflict. The launch risk is operational: failed webhook, duplicate webhook, refund/reversal handling, receipt support, and ledger reconciliation.

Implementation direction:

- Do not remove payment/credits.
- Run a live-provider or sandbox-provider purchase test with a launch test user.
- Verify credits appear in Settings without manual intervention.
- Verify duplicate webhook delivery is idempotent.
- Verify refund/support procedure tells owner how to reconcile credits.
- Verify payment provider events can be traced to credit ledger rows.

### P1-3: Support and Privacy Requests Need Owner SLA Discipline

Priority: P1 high  
Area: Support, privacy operations  
Evidence: Support intake and privacy request paths exist and are safer than earlier builds. The remaining issue is operational completeness: user trust depends on timely owner handling, clear status, and careful exposure of sensitive context.

Impact: Launch users will use Support for billing, refunds, account access, privacy, and inaccurate generated content. Slow or unclear handling creates trust loss.

Implementation direction:

- Add owner dashboard filters for billing/refund, privacy, account access, and inaccurate AI output.
- Add SLA aging indicators for trust-critical tickets.
- Add resolution audit notes that are owner-only.
- Keep user-facing history minimal and sanitized.

### P1-4: Resume/Profile Evidence UX Needs a Stronger "Review Before Use" Moment

Priority: P1 high  
Area: Resume quality, user flow, first-time-right  
Evidence: The app can build profile context and master resumes, but world-class launch quality requires an unmistakable moment where users review important claims before exporting or tailoring.

Impact: Users may assume generated content is ready without checking. That is risky for a resume product.

Implementation direction:

- Before export, show a concise "Verify these claims" panel for inferred or high-impact facts.
- Block or warn on unresolved conflicts.
- Let users confirm, edit, or remove facts directly from the review panel.
- Add tests for conflicting dates, missing employer dates, ambiguous education, and unsupported skills.

### P2-1: Mobile Workspace Should Reduce Panel Competition

Priority: P2 medium  
Area: Mobile UX  
Evidence: Mobile signed-in flows passed the core journey, but dense workspace panels compete for attention. Users on mobile need the next action, status, and primary content prioritized.

Impact: Mobile users can complete flows, but the product may feel more like a compressed dashboard than a guided advisor.

Implementation direction:

- Prioritize one primary action per mobile view.
- Collapse secondary history/admin/status panels by default.
- Keep credit warnings visible but not dominant unless exhausted.
- Re-test the first 5 minutes on mobile with a new seeded user.

### P2-2: Negative Test Coverage Should Include Hostile Files and OCR Edge Cases

Priority: P2 medium  
Area: Source ingestion, security, accuracy  
Evidence: URL safety and API negatives were tested broadly. The next pass should deepen file-level negatives: corrupted PDFs, image-only resumes, huge files near limit, mixed-language files, zip contents, misleading filenames, and OCR failures.

Impact: Source ingestion is central to the product. File failures must be graceful, clear, and never consume credits for unusable output.

Implementation direction:

- Add fixture files for corrupted, oversized, unsupported, maliciously named, and image-heavy sources.
- Assert clear error copy and no credit loss when extraction cannot produce useful evidence.
- Assert successful OCR/source extraction includes evidence state and confidence.

### P2-3: Owner Metrics Are Directionally Useful But Must Stay Clearly Estimated

Priority: P2 medium  
Area: Owner/admin analytics  
Evidence: Owner metrics estimate revenue, credit use, payment fees, and platform cost. Copy correctly says to reconcile against provider exports before financial reporting.

Impact: Useful for launch operations, but not a finance source of truth.

Implementation direction:

- Keep "estimated" language.
- Add reconciliation checklist for Stripe/RevenueCat exports, OpenAI usage, Vercel, and Supabase.
- Add a date range export for owner review.

## What Passed And Should Be Preserved

- V1 scope is coherent after owner approval of credits/payment.
- No auto-apply, job scanning, browser automation, native mobile, third-party auth integrations, or extra workflows were added during QA.
- Brand usage generally follows `lib/brand.ts`.
- Cross-browser unauthenticated/API negative coverage passed after browser engines were installed.
- Public accessibility passed.
- Build passed.
- Credit exhaustion copy keeps workspace access available instead of locking users out.
- Support and privacy surfaces are materially safer than earlier versions.
- Owner/admin tier and credit-management surfaces exist and are directionally launch-useful.

## Codex-Ready Implementation Plan

Use this updated prompt for the next execution task. It assumes the 2026-06-11 code review findings above are accurate and treats already implemented work as something to verify and harden, not rebuild.

```text
You are working in /Users/melissasansev/Documents/Pramania.

Read and follow AGENTS.md, DEVELOPMENT_CONTRACT.md, ARCHITECTURE.md, PRODUCT_SCOPE.md, USER_FLOWS.md, PRIVACY_IMPACT.md, UX_STATES.md, ROLLBACK_PLAN.md, and TEST_STRATEGY.md before editing.

Goal: close the remaining launch-readiness evidence gaps from QA_LAUNCH_READINESS_2026-06-05.md without expanding V1 scope. Payments/credits are approved and already configured; do not remove RevenueCat/Stripe/credits unless explicitly requested.

Implement in this order:

1. Prove executable privacy deletion/minimization.
   - Add positive owner/admin tests for building a deletion plan and completing deletion review.
   - Seed user-owned profile facts, sources, master resume, draft application, submitted/non-draft application, generated resume, generated cover letter, credit ledger/reservation evidence, support/privacy records, and storage paths where practical.
   - Assert editable profile/source/master-resume/draft records are deleted.
   - Assert submitted application and generated-material records are minimized rather than blindly removed when audit evidence is required.
   - Assert retained categories include documented reasons and a privacy audit event is written.

2. Expand two-user RLS/API isolation evidence.
   - Keep the existing two-user test and add coverage for jobs, applications, generated resumes, generated cover letters, material exports, artifact download/open routes, archive/mutation attempts by foreign IDs, support issues, privacy requests, credit history, and owner/admin-only routes.
   - Assert User A cannot read, mutate, archive, export, generate from, or download User B records.
   - Add owner/admin positive coverage only for the intended elevated access paths.
   - Document required QA env variables and make the pre-release gate fail clearly when credentials are missing.

3. Prove credit reservation/idempotency behavior.
   - Inventory every credit-consuming endpoint and confirm it uses reservation/finalization/release or an equivalent retry-safe flow.
   - Add tests for duplicate clicks, same idempotency key retry, server failure before output, server failure after durable output, successful reuse, released reservations, stale reservations, and duplicate RevenueCat webhook delivery.
   - Assert credits are finalized only when a durable output exists or is intentionally reused.
   - Assert ledger and reservation metadata include operation id, resource id, feature, and output artifact/linkage where applicable.

4. Strengthen AI fact evidence tests and review-before-use UX.
   - Add tests with ambiguous dates, conflicting company/title data, unsupported skills, broad seniority guesses, and missing credentials.
   - Assert confirmed/source-supported facts can become claims, while inferred/conflicting/missing-evidence facts become review notes, questions, warnings, or editable gaps.
   - Make the resume/application export flow show a concise high-impact claim review when unresolved facts exist.

5. Verify signed-in accessibility and Jobs density.
   - Run the gated signed-in accessibility suite and keep the file-upload accessible-name regression.
   - Run desktop Jobs with seeded records and assert the first job row/card appears above the agreed first-viewport threshold.
   - Keep mobile readable and avoid adding dashboard clutter.

6. Complete payment/support operational verification.
   - Run a RevenueCat/Stripe sandbox or live-provider test purchase with a launch test user.
   - Verify purchased credits appear without manual intervention.
   - Verify duplicate webhook delivery is idempotent.
   - Document refund/reversal and owner ledger reconciliation steps.
   - Confirm owner support/privacy queues expose billing, privacy, account access, and inaccurate AI output with SLA aging and owner-only notes.

7. Run full launch verification.
   - npm run lint
   - npm run test:unit
   - Playwright API/negative suite across browsers
   - Signed-in desktop/mobile suite
   - Public and signed-in accessibility
   - npm run build

Return a concise summary of changed files, tests run, and any remaining launch risk.
```

## Suggested Launch Gate

Do not treat the product as public-launch ready until all P0 items are both implemented and verified:

- Privacy deletion/minimization execution has positive tests proving deleted, minimized, retained-with-reason, and audited outcomes.
- AI fact confidence is explicit for high-impact facts, and ambiguous/conflicting evidence tests pass.
- Two-user RLS/API isolation suite passes with real QA credentials across user-owned records, generated artifacts, exports, and admin boundaries.
- Signed-in file upload accessibility passes in the gated accessibility suite.
- Credit-consuming operations have passing retry, duplicate, failure-before-output, failure-after-output, reuse, stale-reservation, and duplicate-webhook coverage.

After P0 closure, run one final 60-minute launch simulation with:

- A brand-new normal user.
- A low-credit user.
- A paid-credit user.
- An owner/admin user.
- A privacy/support/billing escalation user.

The product should feel valuable within the first 5-10 minutes, avoid unsupported certainty, preserve credits fairly, and make trust-critical controls feel deliberate rather than bolted on.
