# Test Strategy

Testing must prove that shared command paths, security controls, and user-critical workflows behave correctly.

## Required Test Layers

### Unit Tests

Use for:

- Validation schemas.
- Error taxonomy.
- Tier/quota calculations.
- Role recommendation parsing.
- AI output schema validation.
- URL safety checks.

### API Tests

Use for:

- Auth required.
- Input validation.
- Authorization.
- Quota enforcement.
- Error shape.
- Audit event creation.

### Database/RLS Tests

Use for:

- Users cannot read or modify other users' data.
- Admin-only tables reject non-admin writes.
- Application quota records are retained.
- Storage policies restrict objects to user folder paths.

### Feature Tests

Use for:

- Profile source ingestion.
- Profile fact confirmation.
- Role recommendation acknowledgement.
- Master resume generation.
- Job ingestion and fit review.
- Application logging and status updates.
- Admin tier updates.

### Regression Tests

Every fixed defect must add a test that fails without the fix.

### Browser And Mobile Viewport Tests

Before public launch:

- Chrome smoke test.
- Safari smoke test.
- Firefox smoke test.
- Edge smoke test.
- Mobile viewport check for core shell and conversation flow.

## Active Tooling

- `npm run lint` for static analysis.
- `npm run build` for TypeScript and production build verification.
- `npm run test:e2e` for Playwright browser smoke/regression tests.

## Tooling Direction

Recommended next layers:

- Vitest for unit tests.
- Supabase SQL/policy tests or scripted policy verification for RLS.
- CI gates that run lint, build, and e2e smoke tests before deployment.

## Completion Rule

A feature is not complete until:

- Expected behavior is tested.
- Failure behavior is tested.
- Security/authorization behavior is tested where relevant.
- At least one regression risk is covered or explicitly deferred with approval.

Large UI or workflow changes must include a browser smoke run across desktop and
mobile viewports. Hydration, auth entry, chat input visibility, and basic layout
fit are now baseline e2e concerns.
