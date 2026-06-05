# Regression Index

Every fixed defect must add or reference a durable regression test at the
lowest useful layer. Keep this index short and traceable.

## Entry Template

```md
## YYYY-MM-DD - Short Defect Name

- Area:
- Root cause:
- User impact:
- Regression test:
- Layer: unit | api | database_rls | e2e | persona_review
- Notes:
```

## Active Entries

## 2026-06-05 - Public Page Contrast

- Area: Public entry, legal, privacy, and credits pages.
- Root cause: Muted text, segmented controls, badges, and list copy used low-contrast accent tokens on warm public-page surfaces.
- User impact: Users with low vision or poor display conditions could struggle to read public launch pages.
- Regression test: `npm run test:e2e:accessibility`
- Layer: e2e
- Notes: Signed-out public pages now pass the axe WCAG A/AA smoke. Signed-in workspace coverage still requires configured QA demo credentials.
