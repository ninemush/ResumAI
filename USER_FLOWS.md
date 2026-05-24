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
   - adding an optional profile photo,
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
8. App validates that the PDF opens, required sections are present, text is readable where ATS compatibility requires it, and content is not clipped.
9. User reviews and edits.

Success state:

- Master resume is ready for download and later tailoring.

Failure states:

- Profile lacks confirmed facts.
- AI output fails schema validation.
- PDF generation fails.
- PDF validation fails because content is clipped, missing, unreadable, or layout is not acceptable.

Recovery:

- Ask for missing facts.
- Retry safe generation once.
- Keep editable structured content even if PDF generation fails.
- Keep editable structured content and block ready/download state if PDF validation fails.

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
8. App validates PDF layout and content before marking artifacts ready.
9. User reviews/downloads artifacts.

Success state:

- Application exists with generated artifacts and audit-safe quota record.

Failure states:

- Quota exceeded.
- Job ingestion unavailable.
- AI output invalid.
- PDF generation fails.
- PDF validation fails.

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

## Flow 7: Owner/Admin Operating Console

Goal: let the owner monitor product health, usage, outcomes, and support load.

1. Owner/admin opens owner console.
2. App verifies admin role server-side and database-side.
3. App loads aggregate metrics.
4. Owner/admin reviews:
   - signed-up users,
   - active users,
   - feature usage,
   - profile/resume creation,
   - job applications,
   - application status distribution,
   - conversion proxy,
   - support tickets and escalations,
   - recent system health indicators.
5. Owner/admin may drill into support-safe records only for support, billing, security, fraud, or user-authorized troubleshooting.
6. App logs sensitive drill-down actions.

Failure states:

- Non-admin attempts access.
- Metrics function fails.
- A drill-down would expose unnecessary personal data.

Recovery:

- Deny access safely.
- Show a clear operating-console error.
- Keep aggregate metrics available where possible.

## Flow 8: Support

Goal: resolve user issues quickly without repeating discovery.

1. User opens support.
2. App recommends L0 docs when the issue is likely self-serve.
3. If docs are insufficient, user creates a ticket.
4. L1 support agent reviews support-safe user context, recent errors, feature usage, quota events, and support history.
5. L1 chats empathetically with the user, troubleshoots, and records every action.
6. If the issue is sensitive, refund-related, legal/privacy/security-related, emotionally high-risk, or unresolved, L1 escalates to L2.
7. L2 receives a complete packet: customer temperament, summary, timeline, logs inspected, actions taken, results, blockers, recommended next action, and sensitive constraints.

Success state:

- Issue resolved by docs, L1, or L2 with complete history.

Failure states:

- L1 lacks enough support-safe context.
- User requests refund or sensitive action.
- Suspected security/privacy issue.
- User remains blocked or frustrated after troubleshooting.

Recovery:

- Escalate to L2.
- Preserve conversation and troubleshooting history.
- Do not require the user or human support to repeat discovery.
