import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

type WorkflowRegistry = {
  lastReviewed: string;
  qualityBar: string;
  workflows: Array<{
    automationLayers: string[];
    id: string;
    negativeCases: string[];
    owner: string;
    personas: string[];
    positiveCases: string[];
    regressionRisks: string[];
    releaseGate: string;
  }>;
};

const registry = JSON.parse(
  readFileSync(new URL("../qa/workflow-registry.json", import.meta.url), "utf8"),
) as WorkflowRegistry;

describe("QA workflow registry", () => {
  test("keeps a public-launch workflow entry for every V1 critical journey", () => {
    expect(registry.qualityBar).toBe("public_launch");
    expect(registry.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registry.workflows.map((workflow) => workflow.id).sort()).toEqual([
      "application-materials",
      "application-tracking",
      "job-evaluation",
      "master-resume",
      "owner-admin",
      "profile-build",
      "support-privacy",
    ]);
  });

  test("requires positive, negative, persona, automation, and regression ownership", () => {
    for (const workflow of registry.workflows) {
      expect(workflow.positiveCases.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.negativeCases.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.personas.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.automationLayers.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.regressionRisks.length, workflow.id).toBeGreaterThan(0);
      expect(workflow.owner, workflow.id).toBeTruthy();
      expect(["every_pr", "nightly", "pre_release"]).toContain(workflow.releaseGate);
    }
  });
});
