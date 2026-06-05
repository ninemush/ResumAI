# Public Launch Testing Strategy

This strategy turns Pramania's V1 boundary into a public-launch quality system.
Testing should prove that shared command paths, security controls, privacy
controls, generated materials, quota records, and user-critical journeys behave
correctly before a workflow is considered complete.

The goal is confidence, not volume. Every test should answer one of three
questions:

- Does the expected user path work?
- Does the failure path protect the user, their data, and quota/audit records?
- Would this test have caught a realistic regression?

## V1 Boundary

Testing must preserve the V1 scope from `PRODUCT_SCOPE.md` and
`DEVELOPMENT_CONTRACT.md`.

In scope:

- Next.js and TypeScript web app.
- Supabase auth, storage, and database behavior.
- Conversation-first profile build.
- Natural-language, file, OCR, and public-link ingestion.
- Role-fit and seniority recommendations.
- Master resume generation.
- Job URL validation and fit review.
- User-approved application logging.
- Job-specific resume and cover letter PDF/DOCX generation.
- Application status tracking.
- Owner/admin tier configuration and operating metrics.
- Support, privacy, and audit-safe operational workflows.

Out of scope unless explicitly approved:

- Auto-apply or semi-auto apply.
- Job scanning.
- Browser automation against employer sites.
- Native mobile release.
- Authenticated third-party integrations.
- Payment expansion beyond the existing credit foundation.

## Test Layers

### Unit Tests

Use Vitest for deterministic module behavior that does not require a browser or
live Supabase session.

Cover:

- Validation schemas and error taxonomy.
- URL safety, safe fetch helpers, and SSRF guards.
- Redaction, support privacy, and sensitive metadata filtering.
- Tier/quota calculations and idempotency helpers.
- Resume content normalization and hallucination guards.
- PDF validation helpers.
- AI output schemas and prompt-version contracts.

### Integration And API Tests

Use Playwright request tests or future service-level integration tests for
routes, command handlers, and provider boundaries.

Cover:

- Auth required and owner/admin-only access.
- Request schema validation.
- Authorization and RLS-sensitive command behavior.
- Rate-limit behavior and normalized error envelopes.
- Profile source creation/extraction.
- Job ingestion and fit analysis.
- Application creation, quota consumption, artifact generation, and retry safety.
- Status updates and audit events.
- Privacy export/delete and support issue workflows.

### Database And RLS Tests

RLS checks are launch blockers for user-data surfaces.

Cover:

- Users cannot read, update, delete, or download another user's profile sources,
  generated materials, job records, applications, quota events, or support
  tickets.
- Non-admin users cannot read owner metrics or mutate tiers.
- Admin/owner access is intentionally narrow and audited.
- Private storage objects remain user-scoped.
- Application records that consumed quota retain minimum audit-safe evidence.

### Browser And Journey Tests

Use Playwright for browser journeys, screenshots, viewport checks, API smoke
tests, and accessibility scans.

Cover:

- Signed-out auth, terms, privacy, credits, and recovery pages.
- Signed-in desktop workspace and mobile chat-first workspace.
- Core user journeys from `USER_FLOWS.md`.
- Empty, loading, success, failure, and recovery states from `UX_STATES.md`.
- Hydration, console errors, horizontal overflow, small controls, and layout
  regressions.
- Chrome/Chromium, Firefox, WebKit/Safari approximation, and Edge smoke where
  available before public launch.

### Regression Tests

Every fixed defect must add or identify a regression test. Add it at the lowest
layer that would have caught the bug:

- Module bug: unit test.
- API/auth/validation bug: API or integration test.
- RLS/storage bug: RLS verification.
- AI schema or groundedness bug: schema/eval test.
- Journey/layout bug: Playwright flow, screenshot, or accessibility check.

Record regressions in `tests/qa/regression-index.md`.

## Core Journey Matrix

Maintain the executable registry in `tests/qa/workflow-registry.json`.

| Journey | Positive coverage | Negative coverage |
| --- | --- | --- |
| First-time profile build | Notes/file/link create sources, extract facts, user confirms, recommendations appear | Upload failure, bad file type, OCR/parsing failure, unreadable link, thin profile, invalid AI output |
| Master resume | Confirmed facts generate structured resume and PDF/DOCX artifacts | Missing readiness, hallucinated facts, schema failure, PDF generation failure, clipped/unreadable PDF |
| Job evaluation | Safe job URL creates fit review with candid recommendation | Unsafe URL, unreadable page, thin job text, profile not ready, SSRF-style input |
| Application materials | Quota checked once, application logged, resume/letter artifacts generated | Quota exceeded, retry without duplicate quota, invalid AI output, PDF failure |
| Application tracking | User updates allowed status and audit event is stored | Invalid status, unauthorized update, archived record behavior |
| Owner/admin | Owner views metrics and creates/edits/disables tiers | Non-admin access denied, invalid tier limit, risky tier change, unsafe drill-down |
| Support/privacy | Ticket creation, L0 guidance, L1 packet, L2 escalation when sensitive | Raw resume/chat leakage, owner-only field leakage, sensitive issue escalation, deletion/export edge cases |

## Persona UX Review

Run persona walkthroughs before public launch and after major UX changes. Use
the scripts in `tests/qa/persona-review.md`.

Personas:

- First-time anxious job seeker.
- Senior/executive user.
- Career switcher.
- Low-data user.
- Returning applicant.
- Owner/admin.
- Frustrated support user.

Each review records:

- Journey outcome.
- Blockers.
- Confusing moments.
- Visual/layout issues.
- Tone/copy issues.
- Accessibility issues.
- Regression candidates.

Generated review artifacts belong under `qa-artifacts/`, which remains
untracked.

## Release Gates

Browser gates require `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Unauthenticated and auth-required smoke checks
may use harmless local placeholders. Signed-in journey QA requires real public
Supabase values plus demo credentials through `.env.local`, an optional QA env
file, or CI variables.

### Every PR

- `npm run lint`
- `npm run test:unit`
- `npm run test:e2e:smoke`
- `npm run build`

### Nightly

- `npm run test:unit`
- `npm run test:e2e`
- `npm run test:e2e:accessibility`
- Mobile viewport suite.
- Cross-browser smoke for Chromium, Firefox, and WebKit.

### Pre-Release

- Full Playwright suite.
- Persona UX review with screenshots and findings.
- RLS verification.
- AI schema/eval suite.
- PDF artifact validation.
- Regression index review.
- Manual Edge smoke where Edge is available.

## Completion Rule

A feature is not complete until:

- Expected behavior is tested.
- Failure behavior is tested.
- Security, authorization, and privacy behavior are tested where relevant.
- At least one realistic regression risk is covered or explicitly deferred with
  approval.
- The workflow registry entry is updated.
