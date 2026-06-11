import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildEvidenceBasedFitAnalysis } from "@/lib/jobs/evidence-based-fit";
import { parseProfileSourceText } from "@/lib/profile/profile-source-analysis";

describe("canonical career profile source parsing", () => {
  test("keeps recommendations out of role chronology", () => {
    const parsed = parseProfileSourceText({
      sourceId: "00000000-0000-4000-8000-000000000001",
      sourceLabel: "LinkedIn export",
      sourceType: "linkedin",
      text: `
Jane Example

Experience
Director of Operations at Acme Group 2021 - Present
Led a 35-person delivery team and reduced cycle time by 18%.

Recommendations
Jane was a pleasure to work with and one of the strongest leaders on the team.
      `,
    });

    expect(parsed.roles).toHaveLength(1);
    expect(parsed.roles[0]?.title).toBe("Director of Operations");
    expect(parsed.recommendations[0]).toContain("pleasure to work with");
    expect(parsed.roles[0]?.achievements.join(" ")).not.toContain("pleasure to work with");
    expect(parsed.roles[0]?.responsibilities.join(" ")).not.toContain("pleasure to work with");
  });

  test("preserves unsupported but relevant sections as extra sections", () => {
    const parsed = parseProfileSourceText({
      sourceId: "00000000-0000-4000-8000-000000000002",
      sourceLabel: "Resume",
      sourceType: "pdf",
      text: `
Alex Example

Patents
Workflow scoring system for enterprise operations
      `,
    });

    expect(parsed.publications).toContain("Workflow scoring system for enterprise operations");
  });
});

describe("evidence based fit mapping", () => {
  test("turns weak keyword fit into a decision-oriented stretch or skip", () => {
    const fit = buildEvidenceBasedFitAnalysis({
      matchedKeywords: ["operations"],
      missingKeywords: ["python", "machine learning", "model deployment"],
      questions: [],
      recommendation: "weak_match",
      risks: ["Several must-have technical requirements are missing."],
      score: 18,
      senioritySignals: ["senior"],
      summary: "Looks like a stretch.",
    });

    expect(fit.recommendation).toBe("skip");
    expect(fit.missingEvidence).toContain("python");
    expect(fit.nextBestAction).toContain("stretch or skip");
  });
});
