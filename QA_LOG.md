# Pramania QA Log

This log records product-quality issues found during user-style validation. Fixes should be systemic unless a localized defect is clearly isolated.

## 2026-05-28

### Fixed: terms checkbox could fail silently

- Area: unauthenticated signup
- Finding: the browser's native checkbox validation blocked submission before Pramania could show the explicit Terms and Conditions acceptance message.
- Root cause: the terms checkbox used native `required` validation while the app also had custom validation.
- Fix: removed native checkbox validation and kept the app-level acceptance check, so the user receives a clear product-styled message.
- Validation: added desktop/mobile Playwright coverage for local signup without terms acceptance.

### Fixed: missing product boundary for terms acceptance

- Area: auth/session
- Finding: terms acceptance was only captured during some signup paths. Existing users or OAuth users could reach the workspace without a stored acceptance record.
- Root cause: acceptance was handled at the form layer instead of the authenticated workspace boundary.
- Fix: added terms columns, metadata capture, a legal acceptance API, session hydration, and a post-login terms gate for any account missing acceptance.
- Validation: lint, production build, database migration, desktop/mobile Playwright, and production smoke for `/` and `/terms`.

### Open: production email signup rate limit blocks throwaway QA

- Area: auth operations
- Finding: production signup attempts with throwaway QA emails reached `email rate limit exceeded`.
- Impact: authenticated user journey cannot be repeatedly tested through production email signup without polluting user metrics or tripping email throttles.
- Recommended systemic fix: add a controlled private-beta QA path, seeded demo account, or separate dev/staging Supabase project before broader QA cycles.
- Current mitigation: unauthenticated, public, and auth-required API behavior are covered by automated tests; full authenticated production journeys require a known demo credential or a non-production environment.

## 2026-05-29

### Fixed: workspace record pages did not scale to real user volume

- Area: authenticated workspace, Jobs, Applications, Artifacts, Sources, Settings.
- Finding: Jobs and Applications used oversized cards with large empty areas; Artifacts exposed non-interactive count cards; Settings duplicated cockpit-style metrics instead of showing real account controls; Sources without previews were not clickable.
- Root cause: the authenticated workspace was being validated more like a route/API surface than a real workbench for someone managing 20+ jobs, files, generated artifacts, and follow-ups.
- Fix: introduced a compact record layout pattern, clickable/toggleable job rows, dense application rows with status and action controls, interactive artifact filters, preserved source viewer behavior for no-preview records, and replaced "Workspace controls" with account/privacy/subscription/support settings.
- Validation: lint, production build, full Playwright suite, and local public-page hydration smoke. Authenticated visual QA still needs seeded-session browser coverage so layout regressions are caught before release.

### Fixed: QA demo exposed model and export failures

- Area: authenticated demo journey, conversation advisor, profile ingestion, master resume export.
- Finding: a newly created QA user could sign in and upload source material, but the first advisor response failed when the configured model was unavailable, and master resume PDF export failed content validation despite producing a readable draft.
- Root cause: production-like QA was missing a durable demo account; AI calls did not fall back when the requested model was blocked; PDF validation matched exact extracted strings and rejected layout-normalized text.
- Fix: created a local-only QA credential file, confirmed the QA user in Supabase for repeatable testing, added OpenAI response fallback handling, set the documented default model back to `gpt-4o`, normalized PDF validation text, and tightened chat output to plain text.
- Validation: signed in as the QA user, uploaded a resume text file through chat, verified profile readiness increased, generated a master resume, exported validated PDF/DOCX artifacts, swept Cockpit/Profile/Sources/Artifacts/Applications/Jobs/Settings, then ran lint, production build, and 38/38 Playwright tests.

### Fixed: advisor, resume, and record layouts were below V1 quality

- Area: conversation routing, AI model configuration, master resume studio, Jobs, Applications.
- Finding: broad career-advice questions could fall into profile-ingestion copy, the app stayed on `gpt-4o` despite stronger model access, the master resume preview used the headline like a giant title and did not show the user's name, and workspace grids stretched Jobs/Applications into sparse empty cards.
- Root cause: the chat router treated some advice prompts as profile facts, resume content lacked role-section structure, and `profile-pane` grid rows stretched sparse panels to fill the viewport.
- Fix: routed advice questions to the advisor path unless they are concrete workflow commands, moved model defaults to `gpt-5.4` with `gpt-4.1` fallback for model/provider failures, added role-based experience sections to master resume output, rendered the user's name separately from a concise headline, switched ATS exports to normal comma-separated skills, and made workspace rows content-sized.
- Validation: confirmed the account's OpenAI model access through the Models API, smoke-tested `gpt-5.4` through the Responses API, ran lint, production build, and 38/38 Playwright tests. Headless visual QA could not complete a cookie-backed UI login in this session even though the same credentials authenticated through Supabase directly; this remains a QA harness issue to fix before broader release testing.

### Fixed: record pages still exposed internal product language

- Area: Sources, Artifacts, Jobs, Applications, chat wording.
- Finding: source and artifact pages still leaned on operational counts, generated-file rows could not be opened for context, and some copy still used internal “signal” language that does not help a job seeker understand what to do next.
- Root cause: record pages were optimized around implementation status instead of user decisions: what was read, what can be opened, what should be retried, what can be exported, and what needs follow-up.
- Fix: replaced the source summary counter block with a practical source-library explainer, added an artifact detail viewer with context and downloads, changed application wording to a candidate pipeline, made job summaries read as match decisions, and removed remaining user-facing “hiring signal” language from prompts and UI copy.
- Validation: lint, production build, and 38/38 Playwright tests passed. Headless authenticated click-through still cannot complete email/password submit in this local browser harness, so authenticated visual QA remains partially manual until the QA session harness is repaired.

### Fixed: authenticated workspace QA and mobile focus gaps

- Area: signed-in workspace, mobile navigation, conversation rendering, profile cockpit.
- Finding: automated QA still did not emulate a signed-in user, mobile record pages could sit behind the chat-first layout, cockpit metrics had ambiguous accessible names, and numbered advisor responses could render as dense markdown text instead of readable guidance.
- Root cause: the test harness stopped at public/auth-required surfaces, while the real app experience depends on Supabase SSR session cookies and authenticated layout state. Chat rendering also handled bullets better than numbered LLM advice.
- Fix: added a reusable demo-auth helper for Playwright, added signed-in cockpit/mobile workspace regression tests, made mobile record views take focus when selected from nav, gave cockpit metrics explicit action labels, softened user-facing gap copy from proof-point language to outcome evidence, and taught chat rendering to format numbered advice as structured list content.
- Validation: lint, production build, and full Playwright suite passed with 41 passing tests and 1 intentional desktop skip for a mobile-only assertion. A direct authenticated advisor API smoke test with the QA account also returned a contextual answer using saved profile context.
