# UX/UI Expert Review - 2026-06-02

## Launch Readiness

- Public launch readiness: 6.1 / 10.
- Controlled beta readiness: 7.4 / 10.

Pramania has the right ingredients: a distinctive brand, a meaningful career-advisor premise, source ingestion, resume generation, applications, owner operations, and billing mechanics. The gap is that the app still exposes too much machinery. Users should experience a capable career advisor with a workspace that quietly organizes work, not a dashboard plus a partially deterministic chatbot.

## Highest Priority Recommendations

1. Make Pramania the true intelligence layer.
   - Chat should interpret the user's intent with full workspace context.
   - Commands should execute behind the scenes.
   - The assistant should only report outcomes that actually succeeded.
   - Avoid deterministic branches that produce generic or irrelevant replies.

2. Simplify information architecture.
   - V1 navigation should be: Cockpit, Profile & Resume, Jobs, Applications, Library, Settings.
   - Merge Sources and Artifacts into Library with Uploaded and Generated tabs.

3. Make the master resume the trust moment.
   - The resume should look like the final artifact first.
   - Editing should be layered in, not dominate the first impression.
   - Chronological experience should be dominant, structured, and clean.
   - Add a trust strip: sources used, unsupported claims, details to verify, and next actions.

4. Close the Jobs to Applications to Materials loop visibly.
   - Jobs should use compact scan-first records.
   - Applications should show Role, Company, Fit/Stage, Materials, and Next action.
   - Details should open in a drawer or panel.
   - Avoid the word Apply when the app is not submitting the application.

5. Remove internal metrics from user UI.
   - Remove signals, fact counts, readable character counts, and similar implementation terms.
   - Show user-value language: resume ready, stronger metrics needed, applications waiting, roles worth reviewing.

6. Every action must visibly land.
   - Setting direction, uploading files, generating materials, archiving records, or applying promo codes should visibly update the relevant section.

7. Mobile needs a dedicated interaction model.
   - Same code and data model, but not a stacked desktop.
   - One active surface at a time.
   - Bottom navigation.
   - Chat as docked or full-screen.

## Chat Guidance

Pramania should know app capabilities and be able to guide users to the right place. This does not require MCP for internal app navigation. It requires a capability registry, structured assistant responses, action chips, and deep links to the right workspace surfaces. MCP may be useful later for external tool orchestration, but the immediate fix is an app-aware command and navigation layer.

## Owner Console

The owner console should add a financial model:

- Cost per user by period.
- Revenue by period.
- Gross profit and margin.
- Platform cost assumptions.
- Credit purchase and credit consumption evidence.
- Per-user usage ledger for dispute resolution.

The owner should be able to move from summary to root cause, issue, user, usage, and cost evidence without losing context.

