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
