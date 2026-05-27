"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { OwnerConsole } from "@/components/admin/owner-console";
import type { AppView } from "@/components/app-shell/side-nav";
import { SideNav } from "@/components/app-shell/side-nav";
import { ApplicationPanel } from "@/components/applications/application-panel";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { JobIngestionPanel } from "@/components/jobs/job-ingestion-panel";
import { KnowledgebasePanel } from "@/components/knowledgebase/knowledgebase-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import { MasterResumePanel } from "@/components/resume/master-resume-panel";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { OwnerMetrics } from "@/lib/admin/owner-metrics";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ConversationMessage } from "@/lib/conversation/conversation-messages";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";

const DEFAULT_NAV_WIDTH = 280;
const COLLAPSED_NAV_WIDTH = 78;
const DEFAULT_CONVERSATION_WIDTH = 400;
const MIN_NAV_WIDTH = 220;
const MAX_NAV_WIDTH = 340;
const MIN_CONVERSATION_WIDTH = 340;
const MAX_CONVERSATION_WIDTH = 540;

type WorkspaceLayoutProps = {
  applicationOverview: ApplicationOverview;
  conversationMessages: ConversationMessage[];
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  ownerMetrics: OwnerMetrics | null;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

type WorkspaceLayoutState = {
  conversationWidth: number;
  activeView: AppView;
  navCollapsed: boolean;
  navWidth: number;
};

export function WorkspaceLayout({
  applicationOverview,
  conversationMessages,
  jobOverview,
  masterResumeOverview,
  ownerMetrics,
  profileOverview,
  session,
}: WorkspaceLayoutProps) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>({
    activeView: "profile",
    conversationWidth: DEFAULT_CONVERSATION_WIDTH,
    navCollapsed: false,
    navWidth: DEFAULT_NAV_WIDTH,
  });

  const shellStyle = useMemo(
    () =>
      ({
        "--conversation-width": `${layout.conversationWidth}px`,
        "--nav-width": `${layout.navCollapsed ? COLLAPSED_NAV_WIDTH : layout.navWidth}px`,
      }) as CSSProperties,
    [layout],
  );

  function startNavResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = layout.navWidth;

    trackPointer((moveEvent) => {
      setLayout((currentLayout) => ({
        ...currentLayout,
        navCollapsed: false,
        navWidth: clamp(
          startWidth + moveEvent.clientX - startX,
          MIN_NAV_WIDTH,
          MAX_NAV_WIDTH,
          DEFAULT_NAV_WIDTH,
        ),
      }));
    });
  }

  function startConversationResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = layout.conversationWidth;

    trackPointer((moveEvent) => {
      setLayout((currentLayout) => ({
        ...currentLayout,
        conversationWidth: clamp(
          startWidth + startX - moveEvent.clientX,
          MIN_CONVERSATION_WIDTH,
          MAX_CONVERSATION_WIDTH,
          DEFAULT_CONVERSATION_WIDTH,
        ),
      }));
    });
  }

  return (
    <div className="workspace-shell" style={shellStyle}>
      <SideNav
        activeView={layout.activeView}
        collapsed={layout.navCollapsed}
        onSelectView={(activeView) =>
          setLayout((currentLayout) => ({
            ...currentLayout,
            activeView,
          }))
        }
        onToggleCollapsed={() =>
          setLayout((currentLayout) => ({
            ...currentLayout,
            navCollapsed: !currentLayout.navCollapsed,
          }))
        }
        session={session}
      />

      <button
        aria-label="Resize navigation"
        className="resize-handle nav-resize-handle"
        onPointerDown={startNavResize}
        title="Resize navigation"
        type="button"
      />

      <div className="workspace-main">
        {renderWorkspaceView({
          activeView: layout.activeView,
          applicationOverview,
          jobOverview,
          masterResumeOverview,
          ownerMetrics,
          onSelectView: (activeView) =>
            setLayout((currentLayout) => ({
              ...currentLayout,
              activeView,
            })),
          profileOverview,
        })}
      </div>

      <button
        aria-label="Resize conversational AI panel"
        className="resize-handle conversation-resize-handle"
        onPointerDown={startConversationResize}
        title="Resize conversational AI panel"
        type="button"
      />

      <ConversationPanel
        applicationOverview={applicationOverview}
        initialMessages={conversationMessages}
        jobOverview={jobOverview}
        profileOverview={profileOverview}
        userEmail={session.user.email}
        userId={session.user.id}
      />
    </div>
  );
}

function renderWorkspaceView({
  activeView,
  applicationOverview,
  jobOverview,
  masterResumeOverview,
  ownerMetrics,
  onSelectView,
  profileOverview,
}: {
  activeView: AppView;
  applicationOverview: ApplicationOverview;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  ownerMetrics: OwnerMetrics | null;
  onSelectView: (view: AppView) => void;
  profileOverview: ProfileOverview;
}) {
  if (activeView === "owner") {
    return ownerMetrics ? (
      <OwnerConsole metrics={ownerMetrics} />
    ) : (
      <WorkspacePlaceholder
        eyebrow="Owner console"
        title="Owner access required"
        body="This console is reserved for configured owner/admin accounts."
      />
    );
  }

  if (activeView === "jobs") {
    return <JobIngestionPanel overview={jobOverview} showEmptyState />;
  }

  if (activeView === "applications") {
    return <ApplicationPanel overview={applicationOverview} showEmptyState />;
  }

  if (activeView === "resume") {
    return <MasterResumePanel overview={masterResumeOverview} />;
  }

  if (activeView === "knowledgebase") {
    return <KnowledgebasePanel overview={profileOverview} />;
  }

  if (activeView === "artifacts") {
    return (
      <WorkspacePlaceholder
        eyebrow="Artifacts"
        title="Generated materials"
        body="Targeted resumes, cover letters, and validated PDFs will collect here after you log an application and generate materials."
      />
    );
  }

  if (activeView === "settings") {
    return (
      <WorkspacePlaceholder
        eyebrow="Settings"
        title="Workspace settings"
        body="Account, privacy, data export, and notification controls will live here before public launch."
      />
    );
  }

  if (activeView === "support") {
    return (
      <WorkspacePlaceholder
        eyebrow="Support"
        title="Help and cases"
        body="V1 will start with a simple support case flow and internal docs. We will avoid promising an autonomous support agent until the core product workflows are stable."
      />
    );
  }

  return (
    <ProfileExplorer
      applicationOverview={applicationOverview}
      jobOverview={jobOverview}
      onNavigate={onSelectView}
      overview={profileOverview}
    />
  );
}

function WorkspacePlaceholder({
  body,
  eyebrow,
  title,
}: {
  body: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="profile-pane" aria-labelledby="workspace-placeholder-title">
      <div className="pane-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="workspace-placeholder-title">{title}</h1>
        <p>{body}</p>
      </div>
    </main>
  );
}

function trackPointer(onMove: (event: PointerEvent) => void) {
  function handleMove(event: PointerEvent) {
    onMove(event);
  }

  function handleUp() {
    document.body.classList.remove("is-resizing-workspace");
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }

  document.body.classList.add("is-resizing-workspace");
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp, { once: true });
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}
