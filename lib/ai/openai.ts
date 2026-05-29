import "server-only";

import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

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

export function getMaterialsModel() {
  return getServerEnv().OPENAI_MATERIALS_MODEL;
}

export async function createOpenAIResponse(params: ResponseCreateParamsNonStreaming) {
  try {
    return await getOpenAIClient().responses.create(params);
  } catch (error) {
    if (!shouldRetryWithFallback(error, params.model)) {
      throw error;
    }

    return getOpenAIClient().responses.create({
      ...params,
      model: getServerEnv().OPENAI_FALLBACK_MODEL,
      metadata: {
        ...params.metadata,
        requested_model: String(params.model),
        model_fallback: "true",
      },
    });
  }
}

function shouldRetryWithFallback(error: unknown, requestedModel: ResponseCreateParamsNonStreaming["model"]) {
  const fallbackModel = getServerEnv().OPENAI_FALLBACK_MODEL;

  if (!requestedModel || requestedModel === fallbackModel) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const status = "status" in error && typeof error.status === "number" ? error.status : null;
  const message = error.message.toLowerCase();

  return (
    (status === 404 &&
      (message.includes("model") || message.includes("verified") || message.includes("not found"))) ||
    (status === 400 &&
      (message.includes("model") ||
        message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("not supported") ||
        message.includes("unsupported"))) ||
    (status !== null && status >= 500)
  );
}
