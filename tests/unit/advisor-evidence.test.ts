import { describe, expect, test } from "vitest";

import {
  buildResumeDiagnosticEvidencePack,
  buildSourceEvidencePack,
  selectSourceForUserQuestion,
} from "@/lib/conversation/advisor-evidence";

describe("advisor evidence packs", () => {
  test("builds evidence for named profile PDF project questions without advisor prose", () => {
    const source = {
      extracted_text:
        "Summary: I led global Services GTM and operations across portfolio, pricing, reporting, governance, planning, enablement, and execution. My focus was to scale Services as a disciplined global business and connect Services more directly to customer outcomes and product adoption.",
      extraction_status: "succeeded",
      original_filename: "Profile.pdf",
      source_type: "pdf",
      source_url: null,
    };

    const selected = selectSourceForUserQuestion(
      "Did you find any special projects in my profile.pdf file?",
      [source],
    );
    const pack = buildSourceEvidencePack({
      message: "Did you find any special projects in my profile.pdf file?",
      sources: [source],
    });

    expect(selected?.original_filename).toBe("Profile.pdf");
    expect(pack).toContain("Matched source: Profile.pdf");
    expect(pack).toContain("User is asking about: special projects");
    expect(pack).toContain("Relevant source excerpts");
    expect(pack).toContain("For Special Projects");
    expect(pack).not.toMatch(/assistantMessage/i);
    expect(pack).not.toMatch(/saved master resume snapshot/i);
    expect(pack).not.toMatch(/Professional Experience \(\d+ role/i);
  });

  test("does not infer projects from unreadable files", () => {
    const pack = buildSourceEvidencePack({
      message: "Did you find special projects in my profile.pdf file?",
      sources: [
        {
          extracted_text: null,
          extraction_status: "failed",
          failure_reason: "PDF text empty",
          original_filename: "Profile.pdf",
          source_type: "pdf",
          source_url: null,
        },
      ],
    });

    expect(pack).toContain("Read status: needs help");
    expect(pack).toContain("Do not infer projects");
    expect(pack).toContain("PDF text empty");
  });

  test("builds resume diagnostics as internal evidence, not user-facing copy", () => {
    const pack = buildResumeDiagnosticEvidencePack({
      latestResume: {
        content_json: {
          certifications: [],
          education: [],
          experienceSections: [{ roleTitle: "VP" }],
          languages: [],
          specialProjects: [],
        },
      },
      message: "Why are Special Projects and Education missing from my rebuilt resume?",
      readableSourceCount: 3,
    });

    expect(pack).toContain("Resume diagnostic request detected");
    expect(pack).toContain("Optional sections missing");
    expect(pack).toContain("Special Projects");
    expect(pack).not.toContain("I can inspect");
    expect(pack).not.toContain("saved master resume snapshot");
  });
});
