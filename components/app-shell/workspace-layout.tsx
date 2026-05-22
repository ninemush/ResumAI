"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { SideNav } from "@/components/app-shell/side-nav";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { JobIngestionPanel } from "@/components/jobs/job-ingestion-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ConversationMessage } from "@/lib/conversation/conversation-messages";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";

const DEFAULT_NAV_WIDTH = 260;
const COLLAPSED_NAV_WIDTH = 78;
const DEFAULT_CONVERSATION_WIDTH = 400;
const MIN_NAV_WIDTH = 220;
const MAX_NAV_WIDTH = 340;
const MIN_CONVERSATION_WIDTH = 340;
const MAX_CONVERSATION_WIDTH = 540;

type WorkspaceLayoutProps = {
  conversationMessages: ConversationMessage[];
  jobOverview: JobOverview;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

type WorkspaceLayoutState = {
  conversationWidth: number;
  navCollapsed: boolean;
  navWidth: number;
};

export function WorkspaceLayout({
  conversationMessages,
  jobOverview,
  profileOverview,
  session,
}: WorkspaceLayoutProps) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>({
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
        collapsed={layout.navCollapsed}
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
        <ProfileExplorer overview={profileOverview} />
        <JobIngestionPanel overview={jobOverview} />
      </div>

      <button
        aria-label="Resize conversational AI panel"
        className="resize-handle conversation-resize-handle"
        onPointerDown={startConversationResize}
        title="Resize conversational AI panel"
        type="button"
      />

      <ConversationPanel
        initialMessages={conversationMessages}
        userEmail={session.user.email}
        userId={session.user.id}
      />
    </div>
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
