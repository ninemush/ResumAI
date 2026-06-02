"use client";

import { FileText, Layers3 } from "lucide-react";
import { useState } from "react";

import { ArtifactsPanel } from "@/components/artifacts/artifacts-panel";
import { KnowledgebasePanel } from "@/components/knowledgebase/knowledgebase-panel";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

type LibraryTab = "uploaded" | "generated";

type LibraryPanelProps = {
  artifactOverview: ArtifactOverview;
  initialTab?: LibraryTab;
  profileOverview: ProfileOverview;
};

export function LibraryPanel({
  artifactOverview,
  initialTab = "uploaded",
  profileOverview,
}: LibraryPanelProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);

  return (
    <div className="library-workspace" aria-label="Library">
      <section className="library-header" aria-labelledby="library-title">
        <div>
          <p className="eyebrow">Library</p>
          <h1 id="library-title">Files and generated materials</h1>
          <p>
            One place for what you gave Pramania and what Pramania created for you.
          </p>
        </div>
        <div className="library-tab-strip" role="tablist" aria-label="Library sections">
          <button
            aria-selected={activeTab === "uploaded"}
            className={activeTab === "uploaded" ? "library-tab active" : "library-tab"}
            onClick={() => setActiveTab("uploaded")}
            role="tab"
            type="button"
          >
            <FileText size={16} aria-hidden="true" />
            Uploaded
          </button>
          <button
            aria-selected={activeTab === "generated"}
            className={activeTab === "generated" ? "library-tab active" : "library-tab"}
            onClick={() => setActiveTab("generated")}
            role="tab"
            type="button"
          >
            <Layers3 size={16} aria-hidden="true" />
            Generated
          </button>
        </div>
      </section>

      {activeTab === "uploaded" ? (
        <KnowledgebasePanel embedded overview={profileOverview} />
      ) : (
        <ArtifactsPanel embedded overview={artifactOverview} />
      )}
    </div>
  );
}
