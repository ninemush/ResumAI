# Development Contract Code Review - 2026-06-03

## Scope

Reviewed the current app against `DEVELOPMENT_CONTRACT.md`, `ARCHITECTURE.md`, and the launch-readiness controls for security, observability, validation, AI boundary behavior, and operational resilience.

## Findings Addressed

### Production MFA Cookie Secret

The MFA/session cookie signer allowed a deterministic local fallback secret even when deployed to production. Production now requires `AUTH_MFA_COOKIE_SECRET` to be configured with at least 32 characters; local fallback is limited to non-production development.

### RevenueCat Webhook Secret

The RevenueCat webhook accepted unsigned events when the webhook secret was not configured. Production now fails closed with a structured configuration error until `REVENUECAT_WEBHOOK_SECRET` is present.

### API Rate Limiting

The contract requires rate limiting on APIs, especially user-facing AI, ingestion, export, and authentication surfaces. Added a shared rate-limit guard and applied it to conversation, profile intake, source extraction, job ingestion, resume/material generation, exports, and password sign-in.

### Operational Data Redaction

Telemetry and support issue creation could persist user-provided text or metadata containing sensitive data. Added a shared redaction layer for secrets, bearer tokens, JWT-like values, emails, phone-like values, and sensitive metadata keys before operational records are stored.

## Validation

- `git diff --check`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

## Residual Risk

The new rate limiter is an in-memory per-instance guard, which is appropriate for immediate protection but not sufficient as the only control at large distributed scale. Before broad public launch traffic, move this to a shared backing store or managed edge rate limiter so limits are enforced consistently across Vercel instances.
