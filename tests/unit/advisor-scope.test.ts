import { describe, expect, test } from "vitest";

import {
  buildAdvisorScopeRedirect,
  fallbackAdvisorScopeDecision,
  shouldRunFullAdvisor,
} from "@/lib/conversation/advisor-scope-core";

describe("advisor scope guardrails", () => {
  test("allows career and work-adjacent prompts", () => {
    const recruiter = fallbackAdvisorScopeDecision(
      "Write a recruiter follow-up email for this application",
    );
    const workplace = fallbackAdvisorScopeDecision(
      "Help me respond to my manager about feedback at work",
    );

    expect(recruiter.decision).toBe("in_scope");
    expect(workplace.decision).toBe("adjacent_professional");
    expect(shouldRunFullAdvisor(recruiter)).toBe(true);
    expect(shouldRunFullAdvisor(workplace)).toBe(true);
  });

  test("blocks unrelated general LLM use with a warm redirect", () => {
    const decision = fallbackAdvisorScopeDecision("Give me a recipe for pancakes");
    const redirect = buildAdvisorScopeRedirect(decision);

    expect(decision.decision).toBe("out_of_scope");
    expect(shouldRunFullAdvisor(decision)).toBe(false);
    expect(redirect.assistantMessage).toMatch(/career, work, resumes, jobs/i);
    expect(redirect.assistantMessage).not.toMatch(/pancakes/i);
  });

  test("answers capability and model questions without full advisor", () => {
    const capability = fallbackAdvisorScopeDecision("What can you help me with?");
    const model = fallbackAdvisorScopeDecision("What model are you using?");

    expect(capability.decision).toBe("capability_question");
    expect(model.decision).toBe("model_question");
    expect(shouldRunFullAdvisor(capability)).toBe(false);
    expect(shouldRunFullAdvisor(model)).toBe(false);
    expect(buildAdvisorScopeRedirect(model).assistantMessage).toMatch(/not a general chatbot/i);
  });

  test("keeps ambiguous workspace prompts in advisor flow for a grounding follow-up", () => {
    for (const prompt of [
      "Can you help me with this?",
      "What should I do next?",
      "Which one is better?",
      "That looks wrong",
    ]) {
      const decision = fallbackAdvisorScopeDecision(prompt);

      expect(decision.decision).toBe("in_scope");
      expect(shouldRunFullAdvisor(decision)).toBe(true);
      expect(decision.reason).toMatch(/Ambiguous messages are allowed/i);
    }
  });
});
