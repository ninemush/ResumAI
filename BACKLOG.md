# Backlog

This backlog captures approved direction that should be designed and implemented in controlled slices under `DEVELOPMENT_CONTRACT.md`.

## Core App Cockpit And Measurement

- Expand the profile cockpit with application funnel metrics: jobs identified, jobs awaiting review, applications drafted, applied, no reply, interviewing, rejected, selected, and withdrawn.
- Store normalized application stage events so cohort analysis can answer where users succeed or drop off.
- Add user-base analytics for interview rate, rejection rate, selection rate, time-to-response, and conversion by tier, role family, resume version, and source type.
- Keep all analytics privacy-safe, aggregated by default, and never expose one user's private data to another user.

## Profile Build And Intake

- Make Pramania the primary interaction surface for links, files, and natural-language profile notes.
- Harden ingestion for PDF, DOC, DOCX, TXT, image/OCR, LinkedIn public links, portfolio links, and profile pages.
- Add clear source capability/status indicators so users know what was read, what failed, and what needs permission or a different file.
- Add authenticated LinkedIn and job-site integrations only after separate provider terms, privacy, and security review.

## Navigation And UX Polish

- Keep the left nav collapsible with useful icon tooltips.
- Make each nav area open a distinct workspace surface.
- Keep profile photo near the profile identity/header, not buried inside the editor.
- Continue replacing placeholder copy with product-specific, warm, candid guidance.

## Resume And Artifact Quality

- Build a resume studio that generates ATS-first layouts from confirmed profile evidence.
- Validate generated PDFs for readable text, required content presence, page fit, and no clipped content before marking them ready.
- Support photo-compatible resume formats separately from ATS-first exports.
- Track resume and cover-letter versions used per application for audit and outcome analysis.

## Auth And Identity

- Support local account creation plus Google, Microsoft, and LinkedIn sign-in.
- Capture full name and email from integrated auth providers when available.
- Use the user's full name as the initial profile name without overwriting later user edits.

## Support And Docs

- Draft a solid privacy policy before public launch covering data collected, AI processing, source ingestion, OAuth identity data, generated documents, retention, deletion/export rights, subprocessors, cross-border processing, and support/admin access.
- Create self-serve L0 support docs after core V1 workflows stabilize.
- Add L1 autonomous support for platform issues with support-safe logs and escalation boundaries.
- Escalate refunds, sensitive matters, legal/privacy/security issues, and unresolved support cases to L2 human support with full context.
