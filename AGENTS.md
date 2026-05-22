<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Pramania Agent Rules

Cursor is the primary IDE for this project. Codex should be used from inside the Cursor-centered workflow.

Before implementation work, preserve the V1 boundary:

- Next.js + TypeScript
- Supabase auth/storage/db
- Conversation-first profile build
- Natural-language, file, OCR, and link ingestion
- Role-fit and seniority recommendations
- Master resume generation
- Job URL validation
- Application logging
- Job-specific resume and cover letter PDF generation
- Application status tracking
- Owner/admin tier configuration
- AI-generated resume tailoring

Do not add auto-apply, job scanning, browser automation, native mobile release, authenticated third-party integrations, payments, or extra workflows without explicit approval.

Do not expose or commit secrets. `.env.local` must remain untracked.

The product is currently branded as Pramania, but the name may change. Use
`lib/brand.ts` for product-facing names and avoid hardcoding the brand in UI,
prompts, or reusable logic.

Before implementation work, read and follow:

- `DEVELOPMENT_CONTRACT.md`
- `ARCHITECTURE.md`
- `PRODUCT_SCOPE.md`
- `USER_FLOWS.md`
- `PRIVACY_IMPACT.md`
- `UX_STATES.md`
- `ROLLBACK_PLAN.md`
