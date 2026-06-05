import { describe, expect, test } from "vitest";

import { buildSourceSpecificReply } from "@/lib/conversation/source-specific-reply";

describe("source-specific advisor replies", () => {
  test("answers named profile PDF project questions from the source instead of resume diagnostics", () => {
    const reply = buildSourceSpecificReply({
      message: "Did you find any special projects in my profile.pdf file?",
      workspace: {
        sources: {
          recent: [
            {
              extracted_text:
                "Summary: I led global Services GTM and operations across portfolio, pricing, reporting, governance, planning, enablement, and execution. My focus was to scale Services as a disciplined global business and connect Services more directly to customer outcomes and product adoption.",
              extraction_status: "succeeded",
              original_filename: "Profile.pdf",
              source_type: "pdf",
              source_url: null,
            },
          ],
        },
      },
    });

    expect(reply?.assistantMessage).toContain("Profile.pdf");
    expect(reply?.assistantMessage).toContain("do not see a clearly supported Special Projects section");
    expect(reply?.assistantMessage).toContain("project-like wording");
    expect(reply?.assistantMessage).not.toMatch(/saved master resume snapshot/i);
    expect(reply?.assistantMessage).not.toMatch(/Professional Experience \(\d+ role/i);
  });

  test("does not infer projects from unreadable files", () => {
    const reply = buildSourceSpecificReply({
      message: "Did you find special projects in my profile.pdf file?",
      workspace: {
        sources: {
          recent: [
            {
              extracted_text: null,
              extraction_status: "failed",
              failure_reason: "PDF text empty",
              original_filename: "Profile.pdf",
              source_type: "pdf",
              source_url: null,
            },
          ],
        },
      },
    });

    expect(reply?.assistantMessage).toContain("has not been read successfully");
    expect(reply?.assistantMessage).toContain("should not infer special projects");
  });
});
