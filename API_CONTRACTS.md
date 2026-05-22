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
- Enforce tier/quota rules server-side where applicable.

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
TXT and PDF extraction are implemented and feed the same normalized profile fact
pipeline as conversational intake. Full DOCX/OCR/link extraction runs are
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

## `POST /api/profile/sources/:id/extract`

Purpose: extract text from a stored profile source and normalize useful profile
facts through the shared profile fact pipeline.

Current support:

- TXT files stored in the private `profile-sources` bucket.
- PDF files stored in the private `profile-sources` bucket, with size and page
  limits and graceful handling for image-only/scanned PDFs that need OCR.

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
- User can only extract owned source records.
- Storage path must be scoped to the authenticated user's private folder.
- Non-TXT/PDF sources return a typed unsupported-source response until their
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
- AI output schema validation required.
- Must not invent facts.
- Stores generated resume artifact metadata.

## `POST /api/jobs/ingest`

Purpose: ingest and parse a job posting URL.

Request:

```json
{
  "jobUrl": "https://company.com/careers/job"
}
```

Controls:

- Auth required.
- URL validation.
- SSRF protection.
- Timeout and content-size limits.
- Extracted job text stored in `job_ingestions`.

## `POST /api/jobs/evaluate`

Purpose: evaluate job fit against user profile.

Controls:

- Auth required.
- Requires owned job ingestion and profile.
- Returns match, gaps, risks, and recommendation.
- Must be candid and user-safe.

## `POST /api/applications`

Purpose: log an application when the user chooses to proceed.

Controls:

- Auth required.
- Server-side tier/quota check.
- Creates quota event.
- Creates application record.
- Cannot erase quota evidence.

## `POST /api/applications/:id/artifacts`

Purpose: generate job-specific resume and cover letter artifacts.

Controls:

- Auth required.
- Application ownership required.
- AI output schema validation required.
- Stores PDF artifacts in private user-scoped storage.

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
