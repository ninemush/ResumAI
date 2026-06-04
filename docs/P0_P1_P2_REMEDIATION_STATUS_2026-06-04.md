# P0/P1/P2 Remediation Status

Date: 2026-06-04
Source report: `docs/READONLY_E2E_USER_OWNER_QA_REPORT_2026-06-04.md`

## Completed In This Pass

| Priority | Area | Status |
| --- | --- | --- |
| P0/P1 | Master Resume trust moment | Added a source-proof panel showing sources used, chronology status, and claims to verify. Updated missing-experience copy so saved evidence without chronology is called out explicitly. Added parser coverage for LinkedIn-style, pipe-separated, and dash-separated role timelines. Resume proof now distinguishes “timeline detected in source” from “ready source without obvious chronology.” |
| P1 | Source intake proof | Added Library proof receipts per source and clearer handling for ready, failed, error, pending, and processing states. Receipts now surface detected role counts, companies, and role titles when source text contains timeline evidence. |
| P1 | Owner Console layout | Added focused owner mode that removes the chat rail and gives the Owner Console the full workspace. Added layout constraints and E2E assertions. |
| P1 | Mobile Library access | Added Library to the mobile bottom navigation. |
| P1 | Rough-note / no-resume intake | Updated chat onboarding, placeholder, and rough-note detection so messy notes, certificates, portfolio links, frontline/logistics terms, and regional details route into profile evidence more reliably. |
| P1 | Healthcare privacy | Added PHI warnings in Library and Support surfaces. |
| P1/P2 | Source controls | Added authenticated Library source removal. Removing a source deletes the owned stored upload/link record, detaches its source ID from saved profile facts, refreshes the Library, and preserves clear copy that already-saved editable profile text may still need review. |
| P1 | International / regional norms | Added target-market prompt chips for geography, work authorization, languages, relocation, and market resume format. |
| P1 | Library count/status consistency | Normalized `succeeded`/`ready` and `failed`/`error` across filters, pills, capabilities, proof receipts, and attention counts. Fixed cover-letter artifact labeling. |
| P1 | Returning-user orientation | Added a compact “Since your last visit” cockpit strip for newest source state, generated materials, application follow-ups, and jobs needing review, with each item opening the relevant workspace. |
| P2 | Jobs / Applications next action | Added visible next-action labels to Jobs and Applications rows. |
| P2 | Credit previews | Added point-of-action credit labels for master resume generation, master export, application packet creation, and material export. Settings credit packs now state no auto-charge/no auto-renew. |
| P2 | Support | Added PHI-safe support warning. |
| P2 | Auth recovery | Added reset-password and email-access recovery options in the email MFA gate. |

## Validation

- `npm run lint` passed.
- `npm run build` passed.
- `npx tsc --noEmit` passed.
- `npx playwright test tests/e2e/profile-intake-api.spec.ts --project=chrome-desktop` passed: 21 passed.
- `npx playwright test tests/e2e/resume-source-experience.spec.ts --project=chrome-desktop` passed: 11 passed.
- `npx playwright test tests/e2e/authenticated-workspace.spec.ts --project=chrome-desktop --grep "renders the signed-in workspace|keeps the master resume document|shows an operational owner console"` passed: 3 passed.
- `npx playwright test tests/e2e/authenticated-workspace.spec.ts --project=chrome-desktop` passed: 8 passed, 2 expected mobile skips.
- A full `npm run test:e2e` run emitted all 102 test results without failures and produced no `test-results/**/error-context.md` files. The Playwright wrapper did not exit after the final mobile user-journey result, so the stale parent/worker processes were terminated after confirming no failure artifacts remained.

## Still Relevant / Not Fully Completed

| Priority | Area | Remaining work |
| --- | --- | --- |
| P2 | Engineering evidence | GitHub-specific repo/README/language/OSS ingestion is still not a first-class workflow. Generic link intake remains the current path. |
| P2 | Design / portfolio transformation | Portfolio links are better signposted, but there is not yet a dedicated evidence-to-resume-bullet transformation panel for design case studies. |
| P2 | QA fixtures | Seeded 10+ Jobs/Applications fixtures and owner visual regression screenshots were not added in this pass. |
| P2 | Application operating loop | Rows now show next action, but due dates/follow-up scheduling fields were not added as persisted workflow fields. |
| P1/P2 | Account-level privacy controls | Source removal is now available in Library. Account-level export/deletion controls still need a product and data-model pass. |
