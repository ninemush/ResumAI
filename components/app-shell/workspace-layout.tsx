"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  ClipboardList,
  FileText,
  HelpCircle,
  Library,
  MessageCircle,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Shield,
  WalletCards,
} from "lucide-react";

import { OwnerConsole } from "@/components/admin/owner-console";
import type { AppView } from "@/components/app-shell/side-nav";
import { SideNav } from "@/components/app-shell/side-nav";
import { WorkspaceTelemetry } from "@/components/app-shell/workspace-telemetry";
import { ApplicationPanel } from "@/components/applications/application-panel";
import type { StageFilter } from "@/components/applications/application-panel";
import { ConversationPanel } from "@/components/conversation/conversation-panel";
import { JobIngestionPanel } from "@/components/jobs/job-ingestion-panel";
import { LibraryPanel } from "@/components/library/library-panel";
import { ProfileExplorer } from "@/components/profile/profile-explorer";
import { MasterResumePanel } from "@/components/resume/master-resume-panel";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SupportPanel } from "@/components/support/support-panel";
import type { ApplicationOverview } from "@/lib/applications/application-overview";
import type { ArtifactOverview } from "@/lib/artifacts/artifact-overview";
import type { OwnerMetrics } from "@/lib/admin/owner-metrics";
import type { CreditSummary } from "@/lib/billing/credits";
import type { WorkspaceSession } from "@/lib/commands/session";
import type { ConversationMessage } from "@/lib/conversation/conversation-messages";
import type { JobOverview } from "@/lib/jobs/job-overview";
import type { ProfileOverview } from "@/lib/profile/profile-overview";
import type { MasterResumeOverview } from "@/lib/resumes/master-resume";

const DEFAULT_NAV_WIDTH = 280;
const COLLAPSED_NAV_WIDTH = 78;
const DEFAULT_CONVERSATION_WIDTH = 400;
const CONVERSATION_LAYOUT_STORAGE_KEY = "pramania:conversation-layout";
const MIN_NAV_WIDTH = 220;
const MAX_NAV_WIDTH = 340;
const MIN_CONVERSATION_WIDTH = 340;
const MAX_CONVERSATION_WIDTH = 540;
const CONVERSATION_WIDTH_PRESETS = [
  { label: "S", value: 340 },
  { label: "M", value: 400 },
  { label: "L", value: 500 },
];

type WorkspaceLayoutProps = {
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  conversationMessages: ConversationMessage[];
  creditSummary: CreditSummary;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  ownerMetrics: OwnerMetrics | null;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
};

type WorkspaceLayoutState = {
  conversationCollapsed: boolean;
  conversationWidth: number;
  activeView: AppView;
  applicationStageFilter: StageFilter;
  navCollapsed: boolean;
  navWidth: number;
};

export type WorkspaceNavigationTarget =
  | AppView
  | {
      applicationStageFilter?: StageFilter;
      view: AppView;
    };

export function WorkspaceLayout({
  applicationOverview,
  artifactOverview,
  conversationMessages,
  creditSummary,
  jobOverview,
  masterResumeOverview,
  ownerMetrics,
  profileOverview,
  session,
}: WorkspaceLayoutProps) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() =>
    readInitialLayoutState(),
  );
  const [mobileSurface, setMobileSurface] = useState<"workspace" | "chat">(
    "chat",
  );
  const [hasUnsavedResumeChanges, setHasUnsavedResumeChanges] = useState(false);

  const isOwnerConsoleActive = layout.activeView === "owner";
  const shellStyle = useMemo(
    () =>
      ({
        "--conversation-width": `${layout.conversationWidth}px`,
        "--nav-width": `${layout.navCollapsed ? COLLAPSED_NAV_WIDTH : layout.navWidth}px`,
      }) as CSSProperties,
    [layout],
  );

  useEffect(() => {
    window.localStorage.setItem(
      CONVERSATION_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        collapsed: layout.conversationCollapsed,
        width: layout.conversationWidth,
      }),
    );
  }, [layout.conversationCollapsed, layout.conversationWidth]);

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

  function startConversationResize(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
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

  const mobileFocusClass =
    mobileSurface === "chat" ? "conversation-first" : "workspace-first";

  useEffect(() => {
    function handleFocusChat() {
      setMobileSurface("chat");
    }

    window.addEventListener("pramania:focus-chat", handleFocusChat);

    return () =>
      window.removeEventListener("pramania:focus-chat", handleFocusChat);
  }, []);

  function selectView(target: WorkspaceNavigationTarget) {
    const activeView = typeof target === "string" ? target : target.view;
    const applicationStageFilter =
      typeof target === "string" ? undefined : target.applicationStageFilter;

    if (
      hasUnsavedResumeChanges &&
      layout.activeView === "resume" &&
      activeView !== "resume" &&
      !window.confirm("You have unsaved resume edits. Leave without saving?")
    ) {
      return;
    }

    setLayout((currentLayout) => ({
      ...currentLayout,
      activeView,
      applicationStageFilter:
        activeView === "applications"
          ? (applicationStageFilter ?? currentLayout.applicationStageFilter)
          : currentLayout.applicationStageFilter,
    }));
    setMobileSurface("workspace");
  }

  return (
    <div
      className={`workspace-shell ${mobileFocusClass} ${isOwnerConsoleActive ? "owner-focus-mode" : ""} ${layout.conversationCollapsed ? "conversation-collapsed" : ""}`}
      style={shellStyle}
    >
      <WorkspaceTelemetry activeView={layout.activeView} />
      <SideNav
        activeView={layout.activeView}
        collapsed={layout.navCollapsed}
        onSelectView={selectView}
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
        <CreditStatusBanner
          creditSummary={creditSummary}
          onSelectSettings={() => selectView("settings")}
        />
        {renderWorkspaceView({
          activeView: layout.activeView,
          applicationStageFilter: layout.applicationStageFilter,
          applicationOverview,
          artifactOverview,
          creditSummary,
          jobOverview,
          masterResumeOverview,
          ownerMetrics,
          onResumeDirtyChange: setHasUnsavedResumeChanges,
          onSelectView: selectView,
          profileOverview,
          session,
        })}
      </div>

      {isOwnerConsoleActive ? null : (
        <>
          <button
            aria-label="Resize conversational AI panel"
            className="resize-handle conversation-resize-handle"
            onPointerDown={startConversationResize}
            title="Resize conversational AI panel"
            type="button"
          />
          {layout.conversationCollapsed ? (
            <aside className="conversation-collapsed-rail" aria-label="AI advisor collapsed">
              <button
                aria-label="Expand conversational AI panel"
                onClick={() =>
                  setLayout((currentLayout) => ({
                    ...currentLayout,
                    conversationCollapsed: false,
                  }))
                }
                title="Expand AI advisor"
                type="button"
              >
                <PanelRightOpen size={18} aria-hidden="true" />
                <span>AI</span>
              </button>
            </aside>
          ) : (
            <aside className="conversation-panel-shell">
              <div className="conversation-pane-controls" aria-label="AI pane controls">
                <button
                  aria-label="Collapse conversational AI panel"
                  className="conversation-pane-icon-action"
                  onClick={() =>
                    setLayout((currentLayout) => ({
                      ...currentLayout,
                      conversationCollapsed: true,
                    }))
                  }
                  title="Collapse AI advisor"
                  type="button"
                >
                  <PanelRightClose size={16} aria-hidden="true" />
                </button>
                <div className="conversation-width-presets" aria-label="AI pane width">
                  {CONVERSATION_WIDTH_PRESETS.map((preset) => (
                    <button
                      aria-pressed={layout.conversationWidth === preset.value}
                      className={
                        layout.conversationWidth === preset.value
                          ? "active"
                          : undefined
                      }
                      key={preset.label}
                      onClick={() =>
                        setLayout((currentLayout) => ({
                          ...currentLayout,
                          conversationWidth: preset.value,
                        }))
                      }
                      title={`${preset.label} AI pane width`}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <ConversationPanel
                applicationOverview={applicationOverview}
                activeView={layout.activeView}
                creditSummary={creditSummary}
                initialMessages={conversationMessages}
                jobOverview={jobOverview}
                onSelectView={selectView}
                profileOverview={profileOverview}
                userEmail={session.user.email}
                userId={session.user.id}
              />
            </aside>
          )}
        </>
      )}

      <MobileWorkspaceNav
        activeView={layout.activeView}
        mobileSurface={mobileSurface}
        onSelectChat={() => setMobileSurface("chat")}
        onSelectView={selectView}
        session={session}
      />
    </div>
  );
}

function readInitialLayoutState(): WorkspaceLayoutState {
  const fallback: WorkspaceLayoutState = {
    activeView: "profile",
    applicationStageFilter: "All",
    conversationCollapsed: false,
    conversationWidth: DEFAULT_CONVERSATION_WIDTH,
    navCollapsed: false,
    navWidth: DEFAULT_NAV_WIDTH,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(CONVERSATION_LAYOUT_STORAGE_KEY);

    if (!raw) {
      return fallback;
    }

    const saved = JSON.parse(raw) as {
      collapsed?: unknown;
      width?: unknown;
    };

    return {
      ...fallback,
      conversationCollapsed:
        typeof saved.collapsed === "boolean"
          ? saved.collapsed
          : fallback.conversationCollapsed,
      conversationWidth: clamp(
        typeof saved.width === "number" ? saved.width : undefined,
        MIN_CONVERSATION_WIDTH,
        MAX_CONVERSATION_WIDTH,
        fallback.conversationWidth,
      ),
    };
  } catch {
    window.localStorage.removeItem(CONVERSATION_LAYOUT_STORAGE_KEY);
    return fallback;
  }
}

function CreditStatusBanner({
  creditSummary,
  onSelectSettings,
}: {
  creditSummary: CreditSummary;
  onSelectSettings: () => void;
}) {
  if (!creditSummary.isExhausted && !creditSummary.warningThreshold) {
    return null;
  }

  const isExhausted = creditSummary.isExhausted;

  return (
    <section
      className={
        isExhausted
          ? "credit-status-banner exhausted"
          : "credit-status-banner warning"
      }
      aria-live="polite"
    >
      <WalletCards size={22} aria-hidden="true" />
      <div className="credit-status-copy">
        <strong>
          {isExhausted
            ? "Credits are paused, not your workspace."
            : "Credits are running low."}
        </strong>
        <p>
          {isExhausted
            ? "Your saved profile, resumes, jobs, applications, Library, Settings, and Support remain available. Add credits when you want Pramania to read new sources, analyze jobs, generate materials, or export files."
            : `You have ${creditSummary.balance} credits left. Larger actions such as source reading, job analysis, generation, and export may need a top-up soon.`}
        </p>
      </div>
      <div className="credit-status-actions">
        <button
          className="credit-status-primary"
          type="button"
          onClick={onSelectSettings}
        >
          Add credits <ArrowRight size={16} aria-hidden="true" />
        </button>
        <a
          className="credit-status-secondary"
          href="/credits"
          target="_blank"
          rel="noreferrer"
        >
          How credits work
        </a>
      </div>
    </section>
  );
}

function MobileWorkspaceNav({
  activeView,
  mobileSurface,
  onSelectChat,
  onSelectView,
  session,
}: {
  activeView: AppView;
  mobileSurface: "workspace" | "chat";
  onSelectChat: () => void;
  onSelectView: (target: WorkspaceNavigationTarget) => void;
  session: WorkspaceSession;
}) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const items = [
    {
      icon: MessageCircle,
      label: "Chat",
      target: "profile" as const,
      chat: true,
    },
    { icon: FileText, label: "Profile", target: "resume" as const },
    { icon: BriefcaseBusiness, label: "Jobs", target: "jobs" as const },
    { icon: ClipboardList, label: "Apps", target: "applications" as const },
    {
      icon: MoreHorizontal,
      label: "More",
      target: "settings" as const,
      more: true,
    },
  ];
  const moreItems = [
    { icon: Library, label: "Library", target: "library" as const },
    { icon: Settings, label: "Settings", target: "settings" as const },
    { icon: HelpCircle, label: "Support", target: "support" as const },
  ];

  return (
    <>
      {isMoreOpen ? (
        <div className="mobile-more-drawer" role="dialog" aria-label="More workspace destinations">
          {moreItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                className={activeView === item.target ? "active" : undefined}
                key={item.target}
                onClick={() => {
                  setIsMoreOpen(false);
                  onSelectView(item.target);
                }}
                type="button"
              >
                <Icon size={17} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
          {session.admin.isOwner ? (
            <button
              className={activeView === "owner" ? "active" : undefined}
              onClick={() => {
                setIsMoreOpen(false);
                onSelectView("owner");
              }}
              type="button"
            >
              <Shield size={17} aria-hidden="true" />
              Owner
            </button>
          ) : null}
        </div>
      ) : null}
      <nav className="mobile-workspace-nav" aria-label="Workspace sections">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.chat
            ? mobileSurface === "chat"
            : "more" in item
              ? isMoreOpen ||
                (mobileSurface === "workspace" &&
                  ["library", "settings", "support", "owner"].includes(activeView))
              : mobileSurface === "workspace" && activeView === item.target;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "active" : undefined}
              key={`${item.label}-${item.target}`}
              onClick={() => {
                if (item.chat) {
                  setIsMoreOpen(false);
                  onSelectChat();
                  return;
                }

                if ("more" in item) {
                  setIsMoreOpen((current) => !current);
                  return;
                }

                setIsMoreOpen(false);
                onSelectView(item.target);
              }}
              type="button"
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

function renderWorkspaceView({
  activeView,
  applicationStageFilter,
  applicationOverview,
  artifactOverview,
  creditSummary,
  jobOverview,
  masterResumeOverview,
  ownerMetrics,
  onResumeDirtyChange,
  onSelectView,
  profileOverview,
  session,
}: {
  activeView: AppView;
  applicationStageFilter: StageFilter;
  applicationOverview: ApplicationOverview;
  artifactOverview: ArtifactOverview;
  creditSummary: CreditSummary;
  jobOverview: JobOverview;
  masterResumeOverview: MasterResumeOverview;
  ownerMetrics: OwnerMetrics | null;
  onResumeDirtyChange: (isDirty: boolean) => void;
  onSelectView: (target: WorkspaceNavigationTarget) => void;
  profileOverview: ProfileOverview;
  session: WorkspaceSession;
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
    return (
      <ApplicationPanel
        initialStageFilter={applicationStageFilter}
        overview={applicationOverview}
        showEmptyState
      />
    );
  }

  if (activeView === "resume") {
    return (
      <MasterResumePanel
        overview={masterResumeOverview}
        onDirtyChange={onResumeDirtyChange}
        profileOverview={profileOverview}
      />
    );
  }

  if (
    activeView === "library" ||
    activeView === "knowledgebase" ||
    activeView === "artifacts"
  ) {
    return (
      <LibraryPanel
        artifactOverview={artifactOverview}
        initialTab={activeView === "artifacts" ? "generated" : "uploaded"}
        profileOverview={profileOverview}
      />
    );
  }

  if (activeView === "settings") {
    return (
      <SettingsPanel
        applicationOverview={applicationOverview}
        artifactOverview={artifactOverview}
        creditSummary={creditSummary}
        onNavigate={onSelectView}
        profileOverview={profileOverview}
        session={session}
      />
    );
  }

  if (activeView === "support") {
    return <SupportPanel />;
  }

  return (
    <ProfileExplorer
      applicationOverview={applicationOverview}
      artifactOverview={artifactOverview}
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
    <main
      className="profile-pane"
      aria-labelledby="workspace-placeholder-title"
    >
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

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}
