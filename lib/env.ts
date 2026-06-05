import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
});

const serverEnvSchema = publicEnvSchema.extend({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_FALLBACK_MODEL: z.string().min(1).default("gpt-4.1"),
  OPENAI_MATERIALS_MODEL: z.string().min(1).default("gpt-5.4"),
  OPENAI_PROFILE_INTAKE_MODEL: z.string().min(1).default("gpt-5.4"),
});

function emptyStringToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

export function getServerEnv() {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_FALLBACK_MODEL: process.env.OPENAI_FALLBACK_MODEL,
    OPENAI_MATERIALS_MODEL: process.env.OPENAI_MATERIALS_MODEL,
    OPENAI_PROFILE_INTAKE_MODEL: process.env.OPENAI_PROFILE_INTAKE_MODEL,
  });
}
