import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();

describe("public launch copy boundaries", () => {
  test("uses V1 credit and submission boundaries on public trust surfaces", () => {
    const publicCopy = [
      "components/auth/auth-panel.tsx",
      "app/privacy/page.tsx",
      "app/ai-use/page.tsx",
      "app/security/page.tsx",
      "lib/conversation/app-capabilities.ts",
    ]
      .map((path) => readFileSync(join(repoRoot, path), "utf8"))
      .join("\n");

    expect(publicCopy).not.toMatch(/subscription/i);
    expect(publicCopy).not.toMatch(/found for the user/i);
    expect(publicCopy).toContain("Credit packs for a focused job search");
    expect(publicCopy).toContain("LinkedIn sign-in is used only for authentication in V1");
    expect(publicCopy).toContain("does not offer authenticated");
    expect(publicCopy).toContain("does not auto-apply to jobs");
    expect(publicCopy).toMatch(/you decide\s+where and when to submit them/);
  });
});
