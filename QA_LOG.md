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

### Fixed: empty workspace surfaces still spent space on non-actions

- Area: authenticated workspace, Cockpit, Jobs, Applications, Settings.
- Finding: empty Jobs and Applications showed filter controls before there was anything to filter, the cockpit repeated readiness-like status instead of giving clear actions, and Settings legal links could visually run together.
- Root cause: empty states inherited the same record controls as populated states, which made the workspace feel busy without giving the user a useful next action.
- Fix: hid record filters until records exist, made cockpit cards action-oriented, replaced the empty application-stage grid with a compact explanation, and grouped legal links with explicit spacing.
- Validation: lint, diff check, signed-in Playwright regression for advisor context, compact records, resume overflow, and unsaved edit protection.

### Fixed: advisor labels could render as dense paragraph text

- Area: conversation advisor, chat rendering.
- Finding: labeled advice such as "Headline Improvement" and "Leadership Depth" could stay inside one dense paragraph when the model varied capitalization.
- Root cause: some chat-normalization passes split known section labels case-sensitively, while LLM output naturally changes title case.
- Fix: made section-label splitting case-insensitive across cleanup and render parsing so labeled career advice becomes readable headings and paragraphs.
- Validation: lint and authenticated visual QA screenshot of the signed-in cockpit chat pane.

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
- Fix: added a reusable demo-auth helper for Playwright, added signed-in cockpit/mobile workspace regression tests, made mobile record views take focus when selected from nav, gave cockpit metrics explicit action labels, softened user-facing gap copy from proof-point language to outcome evidence, fixed mobile application-stage wrapping, and taught chat rendering to format numbered advice as structured list content.
- Validation: lint, production build, full Playwright suite passed with 41 passing tests and 1 intentional desktop skip for a mobile-only assertion, and manual authenticated screenshots were captured for desktop cockpit/profile and mobile cockpit/jobs. A direct authenticated advisor API smoke test with the QA account also returned a contextual answer using saved profile context.

### Fixed: source/profile failures leaked engineering language

- Area: chat ingestion, source extraction, master resume generation.
- Finding: a rich PDF/source could be saved, but if downstream profile analysis failed the chat could expose root-cause codes or imply the user needed to re-upload material. Master resume generation also had a single strict schema path, so useful source text could be discarded when the model returned valid substance in a slightly imperfect shape.
- Root cause: extraction, profile analysis, and resume generation were treated as one happy-path operation instead of a resilient pipeline with recoverable downstream steps.
- Fix: kept source extraction success separate from profile-analysis failure, replaced internal root-cause copy with recoverable user language, added a relaxed JSON fallback for master resume generation, and expanded master resume context to use more recent readable sources.
- Validation: lint, production build, and full Playwright suite passed with 41 passing tests and 1 intentional desktop skip.

### Fixed: advisor messages could still render as dense model output

- Area: conversation rendering and advisor response normalization.
- Finding: older and model-generated advisor notes could show markdown residue such as doubled colons after bold labels, and multiple labelled recommendations could collapse into one dense wall of text.
- Root cause: the chat renderer handled simple bullets and headings, but did not normalize common LLM label patterns before parsing sections and lists.
- Fix: normalized labelled guidance before saving and rendering, added section recognition for recruiter-style labels such as headline improvement, summary clarity, proof of impact, and missing metrics, and converted labelled paragraphs into readable headings with supporting text.
- Validation: lint passed and authenticated visual QA confirmed the affected advisor note now renders without doubled label punctuation.

### Fixed: resume editor fields could scroll inside the document preview

- Area: Profile & Resume studio.
- Finding: long headline, skill, summary, or experience fields could create small nested scrollbars inside the resume preview, making the editor feel broken and unlike a document.
- Root cause: textareas used estimated row counts based on character length, which did not always match actual wrapped line height in the responsive preview.
- Fix: added document-level textarea auto-growth so fields expand to their rendered content height whenever the draft loads or the user edits text.
- Validation: lint passed and authenticated visual QA confirmed no resume preview textarea had hidden overflow after render.

### Fixed: V1 legal surface lacked a visible privacy policy

- Area: public legal pages, signup consent, settings.
- Finding: users could review Terms and Conditions, but the app did not expose a dedicated Privacy Policy despite collecting resumes, profile sources, job links, generated materials, and application records.
- Root cause: terms acceptance shipped before the privacy surface was made navigable.
- Fix: added a Privacy Policy page covering submitted data, derived service data, AI processing, third-party services, retention, user choices, security, cookies, international processing, and contact; linked it from signup, public auth, settings, and the terms document.
- Validation: added Playwright coverage for `/privacy`.

### Fixed: advisor fallback did not reliably use saved workspace context

- Area: Pramania conversation advisor, saved profile/source/resume context.
- Finding: when the strict advisor model path failed or retried, Pramania could behave as though profile context was unavailable and ask the user to repeat information already saved.
- Root cause: the relaxed retry received a contradictory `Return JSON only` instruction, and the context packet over-weighted recent rows instead of the most useful readable source excerpts. The fallback answer also leaned on generic profile gaps instead of source/resume evidence.
- Fix: removed the JSON-only contradiction from relaxed retries, prioritized readable PDF/LinkedIn/document sources for advisor context, included substantial source excerpts in the model payload, and strengthened deterministic fallback answers to use saved profile, source, resume, job, application, and artifact context.
- Validation: lint passed, auth-required advisor API tests passed, and an authenticated QA smoke test asked Pramania what it learned from an uploaded profile PDF, what metrics were missing, and whether a VP+ metric was strong enough. The responses used saved source/resume context and no longer asked the user to re-upload or repeat profile details.

### Fixed: legacy chat noise persisted after advisor improvements

- Area: returning-user chat history.
- Finding: old low-quality assistant messages such as profile-signal counters, profile-intake failures, and contextless processing notes could remain visible after the live advisor behavior was improved.
- Root cause: persisted conversation history was rendered exactly as stored, while cleanup only applied to newly appended assistant messages.
- Fix: normalized assistant history during initial chat render and suppressed known legacy noise messages that do not help users progress.
- Validation: lint passed and signed-in workspace regression tests passed.

### Fixed: cockpit and settings repeated low-value workspace status

- Area: signed-in cockpit and Settings.
- Finding: the cockpit repeated readiness/status language after the main next-best-move card, while Settings could overflow long identity values.
- Root cause: empty-gap states rendered a second readiness support card, and settings cards did not force long account text to wrap inside the card.
- Fix: removed the redundant support card when there are no actionable gaps, renamed the resume cockpit metric around the user action, and added wrapping/min-width safeguards to settings cards.
- Validation: lint passed, signed-in workspace regression tests passed, and production build passed.

### Fixed: master resume source selection could under-weight rich uploads

- Area: master resume generation.
- Finding: a rich LinkedIn PDF or resume could be diluted by several newer but weaker sources, making the master resume feel shallow after the user had already provided strong evidence.
- Root cause: master resume context selected the most recent readable sources, not the most useful readable sources.
- Fix: expanded the source window and ranked sources by readable text volume and evidence type so PDF, LinkedIn, DOCX, and other rich documents are prioritized over thin notes or screenshots.
- Validation: lint passed and master-resume API regression tests passed.

### Fixed: advisor fallback and resume preview overflow

- Area: Pramania chat and master resume editor.
- Finding: fallback advisor responses could sound narrowly tailored to a prior example, and long resume headlines could visually spill or feel clipped in the editor.
- Root cause: fallback copy contained example-heavy default language, and resume textareas did not fully constrain long unbroken heading text inside the digital document surface.
- Fix: made fallback wording profile-derived and generic across industries, tightened advisor response length, and added wrapping safeguards for the resume headline and document fields.
- Validation: lint, production build, whitespace diff check, focused signed-in workspace Playwright coverage, and the full Playwright suite passed with 45 passing tests and 3 intentional viewport-specific skips.

### Fixed: master resume generation could miss later role history in rich sources

- Area: master resume generation from LinkedIn PDFs, resumes, and long source files.
- Finding: a rich source could still lead to shallow resume sections when the most useful role history appeared after the first extracted-text slice.
- Root cause: the master resume prompt used the beginning of each source, which can over-weight contact, summary, and skills sections and under-weight later experience sections in profile exports.
- Fix: changed source excerpting to include the beginning plus targeted windows around resume-relevant sections such as experience, employment, work history, skills, education, certifications, projects, and awards. Increased model output budget so role-based experience sections have room to be complete.
- Validation: lint, whitespace diff check, production build, master-resume API auth checks, and signed-in workspace regression tests passed.

### Fixed: advisor context could under-read long uploaded sources

- Area: Pramania conversation advisor.
- Finding: advisor answers about uploaded PDFs or profile exports could miss later work-history evidence, even when the source text was saved.
- Root cause: the advisor payload used the first excerpt of each readable source, which can miss role history in long profile exports.
- Fix: mirrored the master-resume source-windowing strategy for advisor context so Pramania sees the beginning plus targeted windows around experience, skills, education, certifications, projects, and related sections.
- Validation: lint, whitespace diff check, production build, profile/advisor API auth checks, and signed-in workspace regression tests passed.

### Fixed: correction wait states felt generic

- Area: Pramania conversation wait states.
- Finding: when a user challenged a poor answer or asked why Pramania was not using saved context, the in-progress copy could still sound like a generic processing loop.
- Root cause: wait-state messages were keyed only to the route mode, not to the user's sentiment or correction intent.
- Fix: added recovery-aware wait-state copy for frustrated or corrective prompts so Pramania explicitly checks saved profile, resume, sources, and recent conversation before answering.
- Validation: lint, whitespace diff check, signed-in workspace regression tests, and production build passed.

### Fixed: master resume could flatten rich role history

- Area: master resume generation from uploaded resumes, LinkedIn PDFs, and other rich sources.
- Finding: even after source extraction succeeded, the generated master resume could still collapse work history into a generic highlights list when the model under-produced role-based sections.
- Root cause: the generator schema requested role sections, but there was no deterministic recovery path when saved source text clearly contained role titles, companies, dates, locations, and impact lines.
- Fix: added a source-timeline enrichment pass that extracts recognizable role history from saved source text and uses it to preserve professional experience sections when the model output is too shallow.
- Validation: lint, whitespace diff check, production build, master-resume API auth checks, and signed-in workspace regression tests passed.

### Fixed: long advisor prose could render as a wall of text

- Area: Pramania chat rendering.
- Finding: even when the advisor answer contained useful guidance, long plain-text paragraphs could render as one dense block and feel hard to read on mobile.
- Root cause: the chat renderer handled headings, bullets, and labels, but did not break dense plain paragraphs when the model returned prose without markdown structure.
- Fix: added sentence-boundary paragraph grouping for long chat paragraphs while preserving existing heading and list rendering.
- Validation: lint, whitespace diff check, signed-in workspace regression tests, and production build passed.

### Verified: brand PNG surfaces use validated transparent assets

- Area: brand assets.
- Finding: older generated PNG logo surfaces risked background artifacts and inconsistent transparency across the landing page, navigation, and workspace shell.
- Root cause: the repository had accumulated several brand-export iterations, and not all were true transparent PNGs.
- Fix: confirmed the active transparent logo, lockup, wordmark, and mark assets match the validated RGBA transparent PNG set and ignored older non-transparent exports.
- Validation: active public brand PNGs report as RGBA transparent assets and lint passed.

### Fixed: remaining internal evidence language

- Area: chat wait states, resume readiness, job fit, and AI prompts.
- Finding: a few user-facing paths still used internal language such as proof points or career signal, which does not help a stressed job seeker know what to do.
- Root cause: early implementation copy mirrored the data model and prompt terminology.
- Fix: replaced remaining user-facing/internal-leak phrasing with role evidence, outcomes, achievements, and evidence-gap language.
- Validation: lint, whitespace diff check, profile/master-resume API auth checks, signed-in workspace regression tests, and production build passed.

### Fixed: mobile profile view could feel visually stacked behind chat

- Area: signed-in mobile workspace.
- Finding: the profile cockpit and Pramania chat could feel visually crowded on mobile, especially when a user opened the app expecting to start in the conversation.
- Root cause: the mobile layout stacked both large surfaces with little separation, and there was no regression check proving the profile view remained chat-first.
- Fix: added a clear boundary before the mobile cockpit, reduced redundant profile heading copy below chat, and added a Playwright check that profile mode is conversation-first without cockpit overlap.
- Validation: focused mobile signed-in workspace regression tests passed.

### Fixed: advisor fallback copy could end awkwardly

- Area: Pramania conversation advisor.
- Finding: long advisor answers could be trimmed with a mechanical "I can keep going" phrase, and one fallback still used proof-oriented wording.
- Root cause: the normalization guard appended a generic continuation phrase after trimming, and fallback language had not been fully aligned with user-facing evidence terminology.
- Fix: made long answers stop at a natural break and replaced proof language with role-based evidence wording.
- Validation: signed-in advisor route returned a context-grounded answer for the demo user; lint, whitespace diff check, and production build passed.

### Fixed: chat could expose proof-oriented labels

- Area: Pramania chat formatting.
- Finding: some assistant answers could label a section "Proof of impact," which reads like internal resume review terminology rather than calm user guidance.
- Root cause: the advisor context and chat section parser still recognized proof-oriented wording from earlier iterations.
- Fix: changed advisor context wording to impact themes and remapped visible "Proof of impact" labels to "Impact evidence" while preserving old-message parsing.
- Validation: lint, whitespace diff check, and production build passed.

### Fixed: profile intake and wait states still used proof wording

- Area: Pramania intake, advisor fallback, and processing states.
- Finding: several user-facing fallback and wait-state messages still said proof when the product should speak in terms of evidence, outcomes, and business value.
- Root cause: early prototype copy had been reused in deterministic recovery paths and loading messages after the main chat renderer was improved.
- Fix: replaced remaining user-facing proof wording with career evidence, impact themes, and measurable outcome language.
- Validation: lint, whitespace diff check, and production build passed.

### Added: advisor context regression

- Area: Pramania conversation advisor.
- Finding: manual QA caught advisor responses that could ignore saved context or fall into a dead-end recovery message.
- Root cause: existing tests covered authentication and layout, but not the signed-in advisor route with real saved workspace context.
- Fix: added a signed-in Playwright regression that asks a broad career-advice question and rejects internal/dead-end language.
- Validation: focused signed-in workspace regression, lint, whitespace diff check, and production build passed.

### Fixed: remaining internal language could leak into guidance

- Area: conversation formatting, profile intelligence, and resume/material prompts.
- Finding: some prompts and UI labels still used proof/signal wording even after the main chat renderer had been cleaned up.
- Root cause: legacy intelligence names remained in model-facing instructions and profile labels.
- Fix: changed user-facing and model-facing wording to evidence, impact themes, scope, and business value; also tightened chat parsing for inline Markdown bullets after labels.
- Validation: lint, whitespace diff check, focused signed-in workspace Playwright coverage, and production build passed.

### Fixed: LinkedIn PDF role history could lose company context

- Area: master resume generation from LinkedIn PDFs and resume-like source files.
- Finding: the parser could read role titles and dates from a LinkedIn PDF but fail to attach company headings such as UiPath, GE, or GE Capital to the roles below them.
- Root cause: source timeline enrichment only looked for company names after each role title, while LinkedIn exports often put the company once above several roles.
- Fix: the resume source parser now carries company headings through the role group and recognizes leadership-program roles as valid experience entries.
- Validation: inspected the real LinkedIn PDF extraction shape locally, then ran lint, whitespace diff check, and production build.

### Fixed: advisor copy could still prime internal language

- Area: Pramania conversation and owner console.
- Finding: most user-facing copy had been cleaned up, but the advisor prompt still named internal phrases as examples to avoid, and the owner console used "failure signals."
- Root cause: cleanup removed visible app wording first, while negative prompt examples and owner-only labels were left behind.
- Fix: rewrote the advisor boundary to ban internal mechanics without repeating the old phrases, changed source-upload success copy to explain user value, and renamed owner system-health wording to failure indicators.
- Validation: lint, whitespace diff check, focused signed-in workspace regression tests, and production build passed.

### Fixed: cockpit and advisor still over-weighted operational counts

- Area: profile cockpit and Pramania advisor context.
- Finding: the first cockpit metric showed a readiness percentage, and the advisor context still included a raw saved-source count that could leak into low-value replies.
- Root cause: early cockpit and context packets were designed around system measurement instead of a user's next decision.
- Fix: changed the cockpit profile metric to a plain action state and removed the raw source count from the advisor context payload.
- Validation: lint, whitespace diff check, focused signed-in workspace regression tests, and production build passed.

### Fixed: legacy numbered advisor fragments could show in chat

- Area: Pramania chat formatting.
- Finding: user-style screenshot QA showed an old numbered advisor answer rendering a standalone "3." before a labelled section.
- Root cause: the chat parser handled numbered list items with text, but did not discard orphan list markers left by older model output.
- Fix: taught the renderer to drop standalone numeric list markers while preserving real numbered items.
- Validation: lint, whitespace diff check, focused signed-in workspace regression tests, authenticated screenshot sweep, and production build passed.

### Fixed: master resume edits could be lost by changing workspace views

- Area: Profile & Resume Studio.
- Finding: a user could edit the master resume and click another workspace tab without an in-app warning, which made the editor feel unsafe.
- Root cause: the unsaved-edit guard only covered browser unload, not app-level navigation between workspace surfaces.
- Fix: lifted resume dirty state into the workspace shell and prompt before leaving the resume studio.
- Validation: lint, whitespace diff check, and focused signed-in Playwright regression for the unsaved-edit guard passed.

### Fixed: resume studio buried the actual resume below review cards

- Area: Profile & Resume Studio.
- Finding: the master resume screen spent too much first-viewport space on reviewer prompts before showing the resume document.
- Root cause: review priorities rendered as a separate panel above the editor, so the draft itself started below the fold on common desktop layouts.
- Fix: moved review prompts inside the resume studio underneath the editable document, keeping the actual resume central while preserving guidance.
- Validation: lint, whitespace diff check, focused signed-in Playwright regression tests, and authenticated desktop screenshot QA passed.

### Fixed: empty job and application pages felt like blank space

- Area: Jobs and Applications.
- Finding: empty list pages were technically compact but did not give a clear next action, leaving a large quiet canvas with little user value.
- Root cause: the empty states were plain text inside the list container instead of a designed, action-oriented state.
- Fix: added compact empty-state panels that explain what happens next without reintroducing old cluttered card layouts.
- Validation: lint, whitespace diff check, and focused signed-in Playwright regression tests passed; the test caught and prevented old wording from returning.

### Fixed: source retry copy still used old workspace vocabulary

- Area: Pramania chat file/source recovery and authenticated workspace regression coverage.
- Finding: file extraction failure copy still told users to retry from "Knowledgebase" even though the navigation and product language now say "Sources."
- Root cause: the visible workspace labels were updated before the older deterministic recovery copy was swept.
- Fix: changed source recovery copy to point to Sources, removed unnecessary evidence jargon from image recovery, and added a signed-in regression to prevent old source/detail/signal language from returning on the Sources page.
- Validation: lint and focused signed-in desktop workspace regression passed.

### Fixed: text-file sources were underweighted for master resume context

- Area: master resume generation context.
- Finding: plain text sources were stored as `txt`, but the master resume source prioritizer checked for `text`.
- Root cause: accepted file types and resume-context scoring used different labels for the same source class.
- Fix: aligned the scorer to the stored `txt` source type so dropped text resumes and profile notes are prioritized correctly.
- Validation: lint, focused signed-in desktop workspace regression, and production build passed.

### Verified: signed-in master resume export creates both file types

- Area: master resume export.
- Finding: earlier manual UX review showed a PDF validation failure message, so the authenticated export path needed direct validation with a real session.
- Root cause: not a new defect in this pass; this was a confirmation check on the currently deployed export path after resume-template and validation improvements.
- Fix: no code change required.
- Validation: authenticated demo session POSTed `/api/resume/master/export`; response returned 200 with PDF and DOCX URLs and resume status `ready`.
