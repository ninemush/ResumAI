"use client";

import {
  BriefcaseBusiness,
  FileText,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";

import type { WorkspaceSession } from "@/lib/commands/session";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { brand } from "@/lib/brand";

export type AppView =
  | "profile"
  | "jobs"
  | "applications"
  | "resume"
  | "artifacts"
  | "settings"
  | "owner";

const primaryItems = [
  { label: "Profile", icon: UserRound, view: "profile" },
  { label: "Jobs", icon: BriefcaseBusiness, view: "jobs" },
  { label: "Applications", icon: BriefcaseBusiness, view: "applications" },
  { label: "Resume", icon: FileText, view: "resume" },
  { label: "Artifacts", icon: Layers3, view: "artifacts" },
  { label: "Settings", icon: Settings, view: "settings" },
] satisfies { label: string; icon: LucideIcon; view: AppView }[];

type SideNavProps = {
  activeView: AppView;
  collapsed: boolean;
  onSelectView: (view: AppView) => void;
  onToggleCollapsed: () => void;
  session: WorkspaceSession;
};

export function SideNav({ activeView, collapsed, onSelectView, onToggleCollapsed, session }: SideNavProps) {
  return (
    <aside className={collapsed ? "side-nav collapsed" : "side-nav"} aria-label="Workspace navigation">
      <div className="side-nav-header">
        <Image
          alt={brand.logoAlt}
          className="side-nav-logo side-nav-logo-icon"
          height={56}
          src={brand.appIconPath}
          width={56}
        />
        <Image
          alt={brand.logoAlt}
          className="side-nav-logo side-nav-logo-lockup"
          height={78}
          priority
          src={brand.horizontalLogoPath}
          width={280}
        />
        <div className="side-nav-brand-copy">
          <strong>{brand.name}</strong>
          <span>{brand.category}</span>
        </div>
        <button
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="collapse-nav-button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </button>
      </div>

      <nav className="nav-list">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={isActive ? "nav-item active" : "nav-item"}
              key={item.label}
              onClick={() => onSelectView(item.view)}
              title={item.label}
              type="button"
            >
              <Icon size={18} aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
            </button>
          );
        })}

        {session.admin.isOwner ? (
          <button
            aria-current={activeView === "owner" ? "page" : undefined}
            aria-label={collapsed ? "Owner Console" : undefined}
            className={activeView === "owner" ? "nav-item active" : "nav-item"}
            onClick={() => onSelectView("owner")}
            title="Owner Console"
            type="button"
          >
            <Shield size={18} aria-hidden="true" />
            <span className="nav-label">Owner Console</span>
          </button>
        ) : null}
      </nav>

      <div className="side-nav-footer">
        {collapsed ? null : <span>{session.user.email ?? "Signed in"}</span>}
        <SignOutButton compact={collapsed} />
      </div>
    </aside>
  );
}
