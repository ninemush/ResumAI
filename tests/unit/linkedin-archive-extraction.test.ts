import { describe, expect, test, vi } from "vitest";
import JSZip from "jszip";

vi.mock("server-only", () => ({}));

import { __profileSourceExtractionTestUtils } from "@/lib/parsing/profile-source-extraction";

describe("LinkedIn archive extraction", () => {
  test("extracts only recognized LinkedIn profile CSV files from archives", async () => {
    const archive = new JSZip();

    archive.file(
      "Profile.csv",
      "First Name,Last Name,Headline\nJane,Example,Operations Director",
    );
    archive.file(
      "Positions.csv",
      "Company Name,Title,Started On,Finished On\nAcme,Director of Operations,2021,",
    );
    archive.file(
      "messages.csv",
      "Body\nThis private message should not become profile evidence",
    );

    const buffer = Buffer.from(await archive.generateAsync({ type: "uint8array" }));
    const text = await __profileSourceExtractionTestUtils.extractLinkedInZipText(buffer);

    expect(text).toContain("LinkedIn Profile");
    expect(text).toContain("Headline: Operations Director");
    expect(text).toContain("LinkedIn Positions");
    expect(text).toContain("Company Name: Acme");
    expect(text).not.toContain("private message");
  });

  test("rejects archives without profile CSV files", async () => {
    const archive = new JSZip();

    archive.file("messages.csv", "Body\nPrivate content");
    archive.file("ads.csv", "Campaign\nNo profile data");

    const buffer = Buffer.from(await archive.generateAsync({ type: "uint8array" }));

    await expect(
      __profileSourceExtractionTestUtils.extractLinkedInZipText(buffer),
    ).rejects.toThrow("LINKEDIN_ARCHIVE_NO_PROFILE_FILES");
  });

  test("formats quoted CSV fields without splitting embedded commas", () => {
    const text = __profileSourceExtractionTestUtils.formatLinkedInCsvText(
      "Skills.csv",
      'Name,Endorsements\n"Operations, Strategy",12',
    );

    expect(text).toContain("Name: Operations, Strategy");
    expect(text).toContain("Endorsements: 12");
  });
});
