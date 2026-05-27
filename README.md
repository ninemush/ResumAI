# Pramania

AI-powered job application assistant.

The product name is configurable and may change before launch. Use
`lib/brand.ts` and the optional public environment values instead of hardcoding
the brand in product UI.

## Current Setup

- Next.js App Router + TypeScript scaffold
- GitHub remote: `ninemush/ResumAI`
- Vercel project linked: `resum-ai/ai-resume-app`
- Supabase project linked: `raqsevuqlwofhgljiazv`
- Cursor is the primary IDE
- Codex is the coding assistant inside Cursor

## Governance

Read these before implementation:

- `DEVELOPMENT_CONTRACT.md`
- `ARCHITECTURE.md`
- `PRODUCT_SCOPE.md`
- `SETUP.md`
- `IMPLEMENTATION_PLAN.md`
- `DATA_MODEL.md`
- `API_CONTRACTS.md`
- `THREAT_MODEL.md`
- `TEST_STRATEGY.md`
- `USER_FLOWS.md`
- `PRIVACY_IMPACT.md`
- `UX_STATES.md`
- `ROLLBACK_PLAN.md`
- `OWNER_SETUP.md`
- `AGENTS.md`

## Local Environment

Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
OPENAI_PROFILE_INTAKE_MODEL=gpt-4o-mini
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Pramania
NEXT_PUBLIC_APP_TAGLINE=Career clarity, guided by intelligence
```

For production, set `NEXT_PUBLIC_SITE_URL=https://pramania.com`.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The default dev command enables polling so Cursor/Mac file watching reliably
detects App Router files. Use `npm run dev:fast` only if native watching is
stable on your machine.

## Infra

Supabase CLI:

```bash
npx supabase projects list
npx supabase status
```

Vercel CLI:

```bash
npx vercel project ls
npx vercel env ls
```

## V1 Boundary

- Conversation-first profile build
- Natural-language, file, OCR, and link ingestion
- Role-fit and seniority recommendations
- ATS-friendly master resume generation
- Job URL validation against profile
- Logged applications with quota tracking
- Job-specific resume and cover letter PDFs
- Application status tracking
- Owner/admin tier configuration
- No auto-apply
- No job scanning
- No payments yet
