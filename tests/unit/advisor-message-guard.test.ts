import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { guardAdvisorMessage } from "@/lib/conversation/advisor-message-guard";

describe("advisor message guard", () => {
  test("removes internal product and data terms from model output", () => {
    const guarded = guardAdvisorMessage(
      "I can inspect the saved master resume snapshot and profile_facts pipeline mechanics. Professional Experience (9 role sections) is visible.",
    );

    expect(guarded).not.toMatch(/saved master resume snapshot/i);
    expect(guarded).not.toMatch(/profile_facts/i);
    expect(guarded).not.toMatch(/pipeline mechanics/i);
    expect(guarded).not.toMatch(/Professional Experience \(\d+ role/i);
    expect(guarded).toMatch(/saved workspace context/i);
  });

  test("neutralizes fake action claims in advisor-only output", () => {
    const guarded = guardAdvisorMessage(
      "I rebuilt the resume and I've exported the PDF. I have saved the application.",
    );

    expect(guarded).not.toMatch(/\bI rebuilt\b/i);
    expect(guarded).not.toMatch(/\bI've exported\b/i);
    expect(guarded).not.toMatch(/\bI have saved\b/i);
    expect(guarded).toMatch(/I can help you rebuild/i);
    expect(guarded).toMatch(/I can help you export/i);
    expect(guarded).toMatch(/I can help you save/i);
  });

  test("keeps external application submission outside the V1 advisor capability", () => {
    const source = readFileSync(join(process.cwd(), "lib/conversation/advisor.ts"), "utf8");

    expect(source).toContain("isExternalSubmissionRequest");
    expect(source).toContain("apply for me");
    expect(source).toContain("V1 never submits anything externally");
    expect(source).toContain("applies on your behalf");
  });
});
