# API Contracts

All API routes must use typed validation schemas before implementation. This document defines the V1 route surface and required controls.

## Shared Requirements

Every route must:

- Require authentication unless explicitly public.
- Validate request input.
- Return typed success and error responses.
- Attach a request id.
- Log status and duration without sensitive personal data.
- Use the shared command/action layer.
- Enforce credit and quota rules server-side where applicable.

## Error Shape

```json
{
  "ok": false,
  "requestId": "uuid",
  "error": {
    "code": "validation.invalid_input",
    "message": "User-safe message",
    "category": "validation"
  }
}
```

## `POST /api/profile/sources`

Purpose: ingest a profile source from text, file metadata, or link.

Current implementation saves validated source records and uploaded-file metadata.
TXT, PDF, and DOCX extraction are implemented and feed the same normalized
profile fact pipeline as conversational intake. OCR and link extraction runs are
separate follow-up commands so every source type can keep using the same
normalization path.

Request:

```json
{
  "sourceType": "pdf",
  "sourceUrl": "https://example.com/profile",
  "storagePath": "user-id/source-id/file.pdf",
  "originalFilename": "resume.pdf",
  "mimeType": "application/pdf",
  "text": "I led finance transformation programs..."
}
```

Response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "source": {
    "id": "uuid",
    "extractionStatus": "pending"
  }
}
```

Controls:

- Auth required.
- User can only create own source records.
- File upload must happen to user-scoped private storage.
- Supported source types include natural language, PDF, Word/DOCX, TXT, image,
  public links, LinkedIn profile links, portfolio links, and other approved
  profile sources.
- LinkedIn URL capture is supported as a user-provided source. Authenticated
  LinkedIn import must be implemented later as an explicit consent-based
  integration, subject to provider terms, legal review, and security design.
- Link ingestion must apply SSRF controls before launch.

## `POST /api/profile/sources/upload-intent`

Purpose: create a server-owned profile source row and signed private storage
upload URL before the browser uploads a file.

Controls:

- Auth required.
- Server chooses the user-scoped storage path.
- HEIC/HEIF are rejected for V1.
- Client must call `POST /api/profile/sources/:id/complete-upload` after the
  storage upload succeeds.
- Stale pending upload intents are eligible for cleanup.

## `POST /api/profile/sources/:id/complete-upload`

Purpose: verify the private uploaded object exists and mark the source uploaded.

Controls:

- Auth required.
- User can only complete own source rows.
- Storage path must stay inside the authenticated user's private folder.

## `POST /api/profile/sources/:id/extract`

Purpose: extract text from a stored profile source and normalize useful profile
facts through the shared profile fact pipeline.

Current support:

- TXT files stored in the private `profile-sources` bucket.
- PDF files stored in the private `profile-sources` bucket, with size and page
  limits and graceful handling for image-only/scanned PDFs that need OCR.
- Word/DOCX files stored in the private `profile-sources` bucket.

Response:

```json
{
  "ok": true,
  "requestId": "uuid",
  "source": {
    "id": "uuid",
    "extractionStatus": "succeeded",
    "extractedTextLength": 1200
  },
  "intake": {
    "savedFactCount": 4
  }
}
```

Controls:

- Auth required.
- Requires 1 available credit.
- Credit covers extraction, source analysis, and canonical career profile merge.
- Credits are reserved before work and finalized only after durable output exists.
- User can only extract owned source records.
- Storage path must be scoped to the authenticated user's private folder.
- Non-TXT/PDF/DOCX sources return a typed unsupported-source response until their
  adapters are implemented.

## `PATCH /api/profile/facts/:id`

Purpose: confirm, correct, or update a profile fact.

Controls:

- Auth required.
- User can only modify own facts.
- Updates must go through `profile.updateField` or equivalent shared command path.

## `POST /api/profile/recommendations`

Purpose: generate role-family and seniority recommendations.

Controls:

- Auth required.
- Requires enough profile signal.
- Must distinguish facts, assumptions, and open questions.
- User acknowledgement required before target direction is locked.

## `POST /api/resumes/master`

Purpose: generate an ATS-friendly master resume from confirmed profile facts.

Controls:

- Auth required.
- Requires 2 available credits.
- AI output schema validation required.
- Must not invent facts.
- Stores generated resume artifact metadata.
- Prefers `career_profiles.content_json` as primary context, with profile facts
  and raw source text as fallback.
- Credits are reserved before generation and finalized only after the resume row
  exists.

## `GET /api/profile/career-profile`

Purpose: return the authenticated user's current canonical career profile.

Controls:

- Auth required.
- User can only read their own current career profile.

## `POST /api/profile/career-profile/rebuild`

Purpose: rebuild the canonical career profile from existing extracted sources,
profile fields, and profile facts without destructively mutating original source
records.

Controls:

- Auth required.
- Rebuild is scoped to the signed-in user.
- Rebuild creates versioned `profile_source_analyses` and `career_profiles`
  records.

## `POST /api/jobs/ingest`

Purpose: ingest and parse a job posting URL.

Current implementation fetches public HTML job pages, extracts readable text,
stores `job_ingestions`, and shows recent ingestions in the workspace. A
lightweight, non-AI fit snapshot compares current profile keywords against the
stored job text. Full AI fit evaluation and application logging are separate
follow-up commands.

Request:

```json
{
  "jobUrl": "https://company.com/careers/job",
  "sourceType": "url_fetch"
}
```

Manual paste request:

```json
{
  "jobText": "Full pasted job description...",
  "sourceType": "manual_paste"
}
```

Controls:

- Auth required.
- Requires 1 available credit.
- URL validation.
- SSRF protection for obvious local/private targets.
- Timeout and content-size limits.
- Extracted job text stored in `job_ingestions`.
- URL fetch failures should prompt manual paste instead of browser automation.
- Fit output is qualitative and evidence-based: strong fit, plausible fit,
  stretch, poor fit, or needs more profile evidence.

## `POST /api/jobs/evaluate`

Purpose: evaluate job fit against user profile.

Controls:

- Auth required.
- Requires owned job ingestion and profile.
- Returns match, gaps, risks, and recommendation.
- Must be candid and user-safe.

## `POST /api/applications`

Purpose: log an application when the user chooses to proceed.

Request:

```json
{
  "jobIngestionId": "uuid",
  "decision": "apply",
  "decisionReason": "User accepted this role from fit review.",
  "status": "draft"
}
```

Controls:

- Auth required.
- Server-side tier/quota check.
- Creates quota event.
- Creates application record.
- Cannot erase quota evidence.
- Requires explicit decision: `apply`, `network_first`, `skip`,
  `save_for_later`, or `needs_more_profile`.
- `skip` requires explicit override.

## `POST /api/applications/:id/artifacts`

Purpose: generate job-specific resume and cover letter artifacts.

Request:

```json
{
  "mode": "reuse",
  "reason": "Optional regeneration reason",
  "idempotencyKey": "optional-client-operation-key"
}
```

Controls:

- Auth required.
- Requires 4 available credits.
- Application ownership required.
- AI output schema validation required.
- Stores PDF and DOCX artifacts in private user-scoped storage.
- Existing material pair plus `reuse` returns free.
- `regenerate` creates new artifact versions and costs credits.
- Credits are reserved before generation and finalized only after durable output exists.

## `PATCH /api/applications/:id/status`

Purpose: update application status.

Allowed statuses:

- `draft`
- `applied`
- `no_reply`
- `rejected`
- `interview_in_progress`
- `interviewed_not_selected`
- `interviewed_selected`
- `withdrawn`

Controls:

- Auth required.
- Application ownership required.
- Status change audit event.

## `/api/admin/tiers`

Purpose: owner/admin tier configuration.

Controls:

- Admin only.
- Create/update/disable tiers.
- No hardcoded tier limits in application logic.
- Audit all changes.

## Billing And Credits APIs

### `GET /api/billing/credits`

Purpose: return the authenticated user's available credits, total credits,
credits used, warning threshold, exhaustion state, and configured purchase
options.

Controls:

- Auth required.
- Server grants the configured signup credit allowance once.
- Response never exposes another user's ledger.
- Credit reservations are included in privacy/export/deletion controls.

### Credit Reservation RPCs

Purpose: reserve, finalize, or release credits around expensive operations.

Controls:

- Auth required.
- Reservation requires an idempotency key.
- Finalization writes the credit ledger usage row only after durable output
  exists.
- Recoverable failures release the reservation.
- Duplicate finalized idempotency keys do not double-charge.

### `POST /api/billing/promo/redeem`

Purpose: redeem an owner-created promo code for credits.

Controls:

- Auth required.
- Promo code validation is database-side.
- Codes can be general or assigned to a specific user email.
- One redemption per user per promo code.
- Redemption writes an append-only ledger entry.

### `GET /api/admin/promo-codes`

Purpose: owner/admin list of promo codes and redemption counts.

Controls:

- Owner/admin only.

### `POST /api/admin/promo-codes`

Purpose: create a one-time or campaign promo code with credit amount, optional
assigned user email, redemption limit, and optional expiration.

Controls:

- Owner/admin only.
- Promo code format is constrained to uppercase letters, numbers, dashes, and
  underscores.
- Creation is auditable through the database record.

### `POST /api/revenuecat/webhook`

Purpose: receive RevenueCat purchase events and convert mapped product ids into
credit ledger grants.

Controls:

- Requires `REVENUECAT_WEBHOOK_SECRET` bearer authorization when configured.
- Requires `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Idempotent on RevenueCat event id.
- Product-to-credit mapping is configuration (`REVENUECAT_CREDIT_PRODUCT_MAP`),
  not application code.
- Unknown product ids are ignored without granting credits.
- Missing production webhook secret fails closed.

### V1 Payment Scope

V1 includes one-time credit pack purchases through configured RevenueCat/Stripe
checkout links, webhook-based credit grants, purchase history, receipt/invoice
support state, refund/support reconciliation, and owner payment visibility.

V1 does not include subscriptions, enterprise invoicing, marketplace billing,
stored payment method management, automatic renewals, or auto-refills.

## `GET /api/admin/metrics`

Purpose: owner/admin operating metrics.

Controls:

- Admin only.
- Aggregate-first.
- No raw resume, profile, cover-letter, or chat content.
- Database-side authorization.
- Response includes signed-up users, active users, feature usage, profile/resume creation, job applications, application status distribution, conversion proxy, support metrics, and system-health indicators.

## Support APIs

Planned:

- `GET /api/support/docs`
- `POST /api/support/tickets`
- `POST /api/support/tickets/:id/messages`
- `POST /api/support/tickets/:id/escalate`

Controls:

- Auth required for user tickets.
- Admin/support authorization for L2 queue.
- L1 agent can access only support-safe context.
- Refund, legal/privacy/security, unresolved, and sensitive issues must escalate.
- All support actions and autonomous responses must be logged.
