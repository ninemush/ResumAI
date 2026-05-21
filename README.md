# ResumAI

AI-powered job application assistant.

## Current Setup

- Next.js App Router + TypeScript scaffold
- GitHub remote: `ninemush/ResumAI`
- Vercel project linked: `resum-ai/ai-resume-app`
- Supabase project linked: `zwjdjjovuxezatqltuwr`
- Cursor is the primary IDE
- Codex is the coding assistant inside Cursor

## Governance

Read these before implementation:

- `DEVELOPMENT_CONTRACT.md`
- `ARCHITECTURE.md`
- `PRODUCT_SCOPE.md`
- `AGENTS.md`

## Local Environment

Create `.env.local` from `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
```

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
