import { describe, expect, test } from "vitest";

import {
  buildDeterministicContextualAdvisorReply,
  isPreferenceSaveRequest,
} from "@/lib/conversation/advisor-contextual-replies";

describe("advisor contextual replies", () => {
  test("answers profile-context questions from saved facts instead of generic advice", () => {
    const reply = buildDeterministicContextualAdvisorReply({
      facts: [
        { fact_type: "experience", fact_value: "Led launch operations for a payments product." },
        { fact_type: "skill", fact_value: "Product strategy" },
        { fact_type: "preference", fact_value: "Keep resume language concise and evidence-first." },
      ],
      message: "what else do you know about me?",
      profile: {
        headline: "Product Lead",
        summary: "Operator with product and launch experience.",
        target_direction: "Product leadership",
        target_level: "Senior",
      },
      recentConversation: [],
    });

    expect(reply).toContain("Here is what I can use from your saved workspace right now");
    expect(reply).toContain("Led launch operations");
    expect(reply).toContain("Keep resume language concise");
  });

  test("explains the previous assistant point when asked what it meant", () => {
    const reply = buildDeterministicContextualAdvisorReply({
      facts: [],
      message: "what do you mean?",
      profile: null,
      recentConversation: [
        { speaker: "user", message_text: "How should I improve the resume?" },
        { speaker: "assistant", message_text: "Best next move: add proof for scope, dates, and outcomes." },
        { speaker: "user", message_text: "what do you mean?" },
      ],
    });

    expect(reply).toContain("add proof for scope, dates, and outcomes");
    expect(reply).toContain("one missing detail");
  });

  test("recognizes resume preference save requests", () => {
    expect(isPreferenceSaveRequest("Please remember my resume format preference: no long summary.")).toBe(true);
    expect(isPreferenceSaveRequest("What roles should I target next?")).toBe(false);
  });
});
