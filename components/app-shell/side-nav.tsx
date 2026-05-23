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
import Image from "next/image";

import type { WorkspaceSession } from "@/lib/commands/session";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { brand } from "@/lib/brand";

const primaryItems = [
  { label: "Profile", icon: UserRound },
  { label: "Resume", icon: FileText },
  { label: "Applications", icon: BriefcaseBusiness },
  { label: "Artifacts", icon: Layers3 },
  { label: "Settings", icon: Settings },
];

type SideNavProps = {
  activeView: "profile" | "owner";
  collapsed: boolean;
  onSelectView: (view: "profile" | "owner") => void;
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
          const isActive = activeView === "profile" && item.label === "Profile";

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={isActive ? "nav-item active" : "nav-item"}
              key={item.label}
              onClick={() => onSelectView("profile")}
              title={collapsed ? item.label : undefined}
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
            title={collapsed ? "Owner Console" : undefined}
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
