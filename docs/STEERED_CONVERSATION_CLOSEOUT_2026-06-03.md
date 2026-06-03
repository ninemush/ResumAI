# Steered Conversation Closeout - 2026-06-03

## Purpose

This sweep reviewed lingering "steered conversation" items across the launch
readiness, UX review, simulation QA, and contract-audit notes to identify any
still-relevant incomplete work that had not been reflected in code or a living
launch-readiness backlog.

## Actioned Now

### Profile Intake Follow-Up Discipline

The profile intake prompt still allowed up to three follow-up questions, which
conflicted with the current Pramania conversation standard:

- one useful, context-aware question at a time
- domain and seniority aware
- no interrogative questionnaire feel
- no repeated requests for facts already present in saved context

Resolution:

- Updated `PROFILE_INTAKE_PROMPT_VERSION` to `profile-intake.v6`.
- Tightened the instruction to ask at most one focused follow-up question in
  assistant-facing responses.
- Directed the advisor to summarize multiple gaps as a pattern, then choose the
  one question that unlocks the next best profile or resume improvement.

## Relevant Items Already Reflected In Current Workstreams

The following historical review items remain relevant product standards, but
they are already represented in the current launch-readiness docs, code paths,
or recent fixes:

- Chat context reliability: Pramania should answer from saved profile, sources,
  jobs, applications, credits, and support context without asking users to repeat
  themselves.
- Master resume trust moment: chronological work experience, optional sections,
  clean exports, no clipped text, and no duplicate roles.
- Source ingestion trust: uploaded PDFs, DOCX, text, screenshots, and links
  should either update the profile visibly or log a clear issue with retry/root
  cause.
- Visible action landing: the assistant should only claim an action completed
  when the command succeeded, and the relevant workspace section should update.
- Compact records: jobs and applications should remain scannable with 10+
  records.
- Library consolidation: user-facing source and generated artifact history
  should live in a simple library model, with original uploads downloadable.
- Credit transparency: usage, examples, warnings, and purchase controls should
  be visible and understandable.
- Support issue loop: user issue reporting and owner triage need status,
  context, logs, notes, and resolution handling.
- Mobile first-session layout: one active surface at a time, no chat overlap.

## Historical Notes No Longer Actionable As Separate Items

- Public pricing copy saying "coming" appears to be superseded in code by the
  current credit-pack explanation and no-auto-charge language.
- The contract-audit closeout document marks the core contract findings as
  addressed; remaining scale hardening is future infrastructure work rather than
  an unclosed contract-audit blocker.

## Remaining Watch Items

These are not newly discovered, but should remain visible during launch QA:

- Ensure RevenueCat/Stripe purchase links are set in deployed environment
  variables so "Purchase link pending" never appears to users.
- Re-run the user-simulation QA after any major conversation or resume-template
  changes.
- Keep prompt/schema changes versioned so regressions can be traced.
