import React from "react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  CreditCard,
  Fingerprint,
  Inbox,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Palette,
  Plug,
  Rocket,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  Stamp,
  Target,
  Timer,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import type { Tab } from "../workspace/useWorkspace";

export type NavItem = {
  id: Tab;
  label: string;
  icon: React.ReactNode;
  group: NavGroupId;
  key?: string;
  keywords?: string;
};
export type NavGroupId = "work" | "plan" | "org";

const s = 17;
export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: "work", label: "Work" },
  { id: "plan", label: "Plan & connect" },
  { id: "org", label: "Organization" },
];

export const NAV: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: <LayoutDashboard size={s} />,
    group: "work",
    key: "o",
    keywords: "home dashboard",
  },
  {
    id: "board",
    label: "Board",
    icon: <KanbanSquare size={s} />,
    group: "work",
    key: "b",
    keywords: "kanban",
  },
  {
    id: "issues",
    label: "All work",
    icon: <ListTodo size={s} />,
    group: "work",
    key: "i",
    keywords: "issues list tasks",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: <BookOpen size={s} />,
    group: "work",
    key: "k",
    keywords: "pages docs wiki",
  },
  {
    id: "sprints",
    label: "Sprints",
    icon: <Timer size={s} />,
    group: "plan",
    key: "s",
    keywords: "iteration",
  },
  {
    id: "releases",
    label: "Releases",
    icon: <Rocket size={s} />,
    group: "plan",
    key: "r",
    keywords: "version ship",
  },
  {
    id: "goals",
    label: "Goals",
    icon: <Target size={s} />,
    group: "plan",
    key: "g",
    keywords: "okr objectives",
  },
  { id: "risks", label: "Risks", icon: <TriangleAlert size={s} />, group: "plan" },
  { id: "decisions", label: "Decisions", icon: <Scale size={s} />, group: "plan", key: "d", keywords: "adr" },
  {
    id: "analytics",
    label: "Analytics",
    icon: <BarChart3 size={s} />,
    group: "plan",
    key: "a",
    keywords: "reports metrics",
  },
  { id: "portfolio", label: "Portfolio", icon: <Briefcase size={s} />, group: "plan", keywords: "workload" },
  { id: "approvals", label: "Approvals", icon: <Stamp size={s} />, group: "plan" },
  {
    id: "access",
    label: "Access",
    icon: <KeyRound size={s} />,
    group: "plan",
    keywords: "permissions grants",
  },
  { id: "search", label: "Search", icon: <Search size={s} />, group: "org", keywords: "find" },
  {
    id: "inbox",
    label: "Inbox",
    icon: <Inbox size={s} />,
    group: "org",
    key: "n",
    keywords: "notifications",
  },
  {
    id: "people",
    label: "People",
    icon: <Users size={s} />,
    group: "org",
    key: "p",
    keywords: "members teams invite",
  },
  { id: "automation", label: "Automations", icon: <Zap size={s} />, group: "org", keywords: "rules" },
  { id: "integrations", label: "Integrations", icon: <Plug size={s} />, group: "org", keywords: "webhooks" },
  {
    id: "security",
    label: "Security",
    icon: <ShieldCheck size={s} />,
    group: "org",
    keywords: "mfa 2fa sessions",
  },
  {
    id: "identity",
    label: "Identity & SSO",
    icon: <Fingerprint size={s} />,
    group: "org",
    keywords: "oidc scim domains",
  },
  {
    id: "billing",
    label: "Billing",
    icon: <CreditCard size={s} />,
    group: "org",
    keywords: "plan subscription",
  },
  { id: "audit", label: "Audit log", icon: <ScrollText size={s} />, group: "org", keywords: "history" },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette size={s} />,
    group: "org",
    key: "t",
    keywords: "theme dark light accent density",
  },
];

export const NAV_BY_ID = Object.fromEntries(NAV.map((n) => [n.id, n])) as Record<string, NavItem>;

/** Tabs that show on the mobile bottom bar. */
export const BOTTOM_TABS: Tab[] = ["overview", "board", "issues", "knowledge"];
