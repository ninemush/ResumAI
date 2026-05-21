# User Flows

These flows define V1 behavior before implementation. All flows must route through the shared command/action layer described in `ARCHITECTURE.md`.

## Flow 1: First-Time Profile Build

Goal: help the user build a high-confidence profile without feeling interrogated.

1. User signs up or signs in.
2. App opens to the three-panel shell.
3. Conversational AI welcomes the user with a warm, brief prompt.
4. User provides profile material by:
   - typing natural language,
   - uploading files,
   - pasting links,
   - editing the profile explorer directly.
5. App creates profile source records.
6. App extracts profile facts from the sources.
7. App classifies facts as user-provided, imported, inferred, or confirmed.
8. App asks only the highest-value clarifying questions.
9. User confirms, edits, or rejects facts in the profile explorer.
10. App recommends role families and likely level.
11. User acknowledges or adjusts the direction.

Success state:

- Profile has enough confirmed signal for master resume generation.

Failure states:

- Upload fails.
- OCR/parsing fails.
- Link cannot be read.
- Profile signal is too thin.
- AI returns invalid output.

Recovery:

- Explain the issue plainly.
- Preserve any successfully extracted data.
- Offer a next-best action.

## Flow 2: Master Resume Generation

Goal: generate an ATS-friendly master resume that preserves the user's voice.

1. User confirms target direction.
2. User asks for a master resume or accepts the app's suggestion.
3. App validates profile readiness.
4. App generates structured resume content from confirmed facts.
5. App validates output schema.
6. App stores the generated resume.
7. App creates a private PDF artifact.
8. User reviews and edits.

Success state:

- Master resume is ready for download and later tailoring.

Failure states:

- Profile lacks confirmed facts.
- AI output fails schema validation.
- PDF generation fails.

Recovery:

- Ask for missing facts.
- Retry safe generation once.
- Keep editable structured content even if PDF generation fails.

## Flow 3: Job Link Evaluation

Goal: candidly evaluate whether a role is a fit.

1. User pastes a job link into the conversation.
2. App validates the URL.
3. App fetches and parses the job post through SSRF-safe ingestion.
4. App extracts company, title, responsibilities, requirements, and keywords.
5. App compares job requirements to profile facts.
6. App returns fit, gaps, risks, and practical recommendation.
7. App asks whether the user wants to proceed.

Success state:

- User understands fit and can decide whether to log the application.

Failure states:

- URL is unsafe.
- Job page is unreadable.
- Job text is too thin.
- User profile is not ready enough for comparison.

Recovery:

- Ask user to paste the job description text.
- Ask user to enrich the profile.
- Preserve the job link as draft if useful.

## Flow 4: Application Logging And Artifact Generation

Goal: log an application, consume quota, and create job-specific materials.

1. User chooses to proceed with a job.
2. App checks tier quota server-side.
3. App creates a quota event.
4. App creates an application record.
5. App generates a tailored resume.
6. App generates a tailored cover letter.
7. App stores generated content and PDF artifacts.
8. User reviews/downloads artifacts.

Success state:

- Application exists with generated artifacts and audit-safe quota record.

Failure states:

- Quota exceeded.
- Job ingestion unavailable.
- AI output invalid.
- PDF generation fails.

Recovery:

- Explain quota status.
- Save partial work where safe.
- Provide retry for idempotent steps.
- Never duplicate quota consumption on retry.

## Flow 5: Application Status Update

Goal: let users track outcomes without creating a full job-scanning product.

1. User opens application history.
2. User selects an application.
3. User updates status.
4. App stores status change and audit event.

Allowed statuses:

- No reply.
- Rejected.
- Interview in progress.
- Interviewed, not selected.
- Interviewed, selected.
- Withdrawn.

## Flow 6: Owner/Admin Tier Configuration

Goal: allow tier and quota management without code changes.

1. Owner/admin opens admin console.
2. Owner/admin views existing tiers.
3. Owner/admin creates, edits, disables, or re-enables a tier.
4. App validates tier limits.
5. App stores configuration change.
6. App writes audit event.

Failure states:

- Non-admin attempts access.
- Invalid tier limit.
- Tier change would break active assignments.

Recovery:

- Deny access safely.
- Explain validation issue.
- Require explicit confirmation for risky changes.

