# Threat Model

This document identifies V1 security and privacy risks before implementation.

## Assets

- User identity and account metadata.
- Uploaded resumes, credentials, images, and profile documents.
- Extracted text from OCR, PDFs, DOCX files, links, and profile pages.
- Profile facts and role recommendations.
- Job URLs and job descriptions.
- Generated resumes and cover letters.
- Application records and status history.
- Tier assignments and quota events.
- Admin tier configuration.
- AI prompts, outputs, and provider metadata.

## Primary Threats

### Unauthorized Data Access

Risk: one user accesses another user's profile, files, applications, or generated artifacts.

Controls:

- Supabase Auth.
- RLS on all user-owned tables.
- User-scoped storage paths.
- API authorization checks.
- Tests for cross-user access denial.

### Admin Abuse Or Misconfiguration

Risk: admin tier changes or role changes are unauthorized or untraceable.

Controls:

- Admin-only RLS policies.
- Audit events for admin changes.
- Owner/admin role table.
- No client-side-only admin checks.

### SSRF From Job/Profile Links

Risk: pasted URLs access internal services, localhost, metadata endpoints, or private networks.

Controls before public launch:

- URL allow/deny validation.
- Block localhost/private IP ranges.
- Redirect limits.
- Timeout and content-size limits.
- Fetch through controlled server-side service only.

### Malicious File Upload

Risk: uploaded files contain malware, huge payloads, parser exploits, or misleading content.

Controls:

- File type allowlist.
- File size limits.
- Private storage.
- Parser sandboxing/provider isolation where practical.
- No execution of uploaded content.
- OCR/parser error handling.

### AI Hallucination

Risk: generated materials invent facts about the user.

Controls:

- Prompt rules.
- Source-grounded generation.
- Structured output validation.
- Human review.
- Distinguish facts, inferences, and open questions.

### Quota Bypass

Risk: users bypass tier limits through alternate UI paths, natural-language commands, retries, or direct API calls.

Controls:

- Server-side quota checks.
- Shared command/action layer.
- Append-only quota events.
- No client-side quota enforcement as source of truth.

### Sensitive Logging

Risk: resumes, tokens, secrets, or personal data leak into logs.

Controls:

- Structured safe logging.
- No raw resume/profile text in logs.
- Redaction rules.
- Request ids instead of sensitive payloads.

### API Abuse And Burst Traffic

Risk: attackers or malfunctioning clients overwhelm expensive routes, authentication endpoints, or user-data APIs.

Controls:

- Shared route-handler rate-limit helper.
- Supabase-backed durable buckets when the hosted migration is applied and `RATE_LIMIT_BACKEND=supabase` is enabled.
- Hashed rate-limit bucket storage to avoid retaining raw emails or IP-derived keys.
- Atomic database updates for distributed serverless deployments.
- Fail-closed production behavior when the durable limiter is enabled but unavailable.
- Local in-memory buckets retained for development fallback.

### Secret Exposure

Risk: service role keys, AI keys, or integration tokens reach browser code or Git.

Controls:

- `.env.local` ignored.
- Server-only secrets have no `NEXT_PUBLIC_` prefix.
- No service-role key in browser.
- Integration tokens encrypted when introduced.

## Open Risks Before Feature Build

- OCR provider choice.
- PDF generation provider/library.
- Error tracking provider.
- Integration strategy for LinkedIn/job sites.
- Data retention durations.
