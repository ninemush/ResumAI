import "server-only";

import OpenAI from "openai";

import { getServerEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (!client) {
    const env = getServerEnv();
    client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  return client;
}

export function getProfileIntakeModel() {
  return getServerEnv().OPENAI_PROFILE_INTAKE_MODEL;
}
