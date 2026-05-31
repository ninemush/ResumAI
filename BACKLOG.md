# Backlog

This backlog captures approved direction that should be designed and implemented in controlled slices under `DEVELOPMENT_CONTRACT.md`.

## Core App Cockpit And Measurement

- Done: Expand the profile cockpit with application funnel metrics: jobs identified, jobs awaiting review, applications drafted, applied, no reply, interviewing, rejected, selected, and withdrawn.
- Done: Make cockpit metrics clickable so every summary number opens the underlying records and the same command path can later be triggered from chat or voice.
- Done: Store normalized application stage events so cohort analysis can answer where users succeed or drop off.
- Done: Add user-base analytics for interview rate, rejection rate, selection rate, time-to-response, and conversion by tier, role family, resume version, and source type.
- Done: Keep all analytics privacy-safe, aggregated by default, and never expose one user's private data to another user.

## Profile Build And Intake

- Done: Make Pramania the primary interaction surface for links, files, and natural-language profile notes.
- Done: Harden ingestion for PDF, DOC, DOCX, TXT, image/OCR, LinkedIn public links, portfolio links, and profile pages.
- Done: Add clear source capability/status indicators so users know what was read, what failed, and what needs permission or a different file.
- Done: Maintain a dedicated Knowledgebase/wiki for source material, extraction status, timestamps, and curated profile evidence instead of burying sources in the profile cockpit.
- Add authenticated LinkedIn and job-site integrations only after separate provider terms, privacy, and security review.

## Navigation And UX Polish

- Done: Keep the left nav collapsible with useful icon tooltips.
- Done: Make each nav area open a distinct workspace surface.
- Keep profile photo near the profile identity/header, not buried inside the editor.
- Done: Continue replacing placeholder copy with product-specific, warm, candid guidance.

## Resume And Artifact Quality

- Done: Merge profile/resume creation into a polished studio that shows a resume-like document surface, supports direct edits, and can also be controlled through chat.
- Done: Support focused master resume variants by role family or target role before job-specific tailoring.
- Done: Validate generated PDFs for readable text, required content presence, page fit, and no clipped content before marking them ready.
- Support photo-compatible resume formats separately from ATS-first exports.
- Track resume and cover-letter versions used per application for audit and outcome analysis.

## Jobs And Applications

- Build a down-selected jobs workspace from Pramania-scanned active job boards after legal/provider review and user filter design.
- Done: Let users accept/reject recommended jobs, inspect the job description, open the source link, and see why the role may be right, unknown, or risky.
- Done: When the user chooses to apply, generate and persist DOCX/PDF application artifacts with version numbers and timestamps, then create/update the application record.
- Done: Keep the jobs list intentionally small and filterable so recommendations do not become overwhelming.

## Auth And Identity

- Done: Support local account creation plus Google, Microsoft, and LinkedIn sign-in.
- Done: Capture full name and email from integrated auth providers when available.
- Done: Use the user's full name as the initial profile name without overwriting later user edits.

## Support And Docs

- Draft a solid privacy policy before public launch covering data collected, AI processing, source ingestion, OAuth identity data, generated documents, retention, deletion/export rights, subprocessors, cross-border processing, and support/admin access.
- Done: Decide V1 support implementation: lightweight in-app ticket tables first, with optional integration later if volume or workflow demands it.
- Create self-serve L0 support docs after core V1 workflows stabilize.
- Add L1 autonomous support for platform issues with support-safe logs and escalation boundaries.
- Escalate refunds, sensitive matters, legal/privacy/security issues, and unresolved support cases to L2 human support with full context.
