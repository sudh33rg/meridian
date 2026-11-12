import { t } from "../../lib/i18n";
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
  ListOrdered,
  Palette,
  Plug,
  CalendarDays,
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
  Headset,
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
  {
    id: "work",
    get label() {
      return t("group.work");
    },
  },
  {
    id: "plan",
    get label() {
      return t("group.plan");
    },
  },
  {
    id: "org",
    get label() {
      return t("group.org");
    },
  },
];

export const NAV: NavItem[] = [
  {
    id: "overview",
    get label() {
      return t("nav.overview");
    },
    icon: <LayoutDashboard size={s} />,
    group: "work",
    key: "o",
    keywords: "home dashboard",
  },
  {
    id: "board",
    get label() {
      return t("nav.board");
    },
    icon: <KanbanSquare size={s} />,
    group: "work",
    key: "b",
    keywords: "kanban",
  },
  {
    id: "backlog",
    get label() {
      return t("nav.backlog");
    },
    icon: <ListOrdered size={s} />,
    group: "work",
    keywords: "product backlog team ranking plan",
  },
  {
    id: "issues",
    get label() {
      return t("nav.allWork");
    },
    icon: <ListTodo size={s} />,
    group: "work",
    key: "i",
    keywords: "issues list tasks",
  },
  {
    id: "knowledge",
    get label() {
      return t("nav.knowledge");
    },
    icon: <BookOpen size={s} />,
    group: "work",
    key: "k",
    keywords: "pages docs wiki",
  },
  {
    id: "sprints",
    get label() {
      return t("nav.sprints");
    },
    icon: <Timer size={s} />,
    group: "plan",
    key: "s",
    keywords: "iteration",
  },
  {
    id: "releases",
    get label() {
      return t("nav.releases");
    },
    icon: <Rocket size={s} />,
    group: "plan",
    key: "r",
    keywords: "version ship",
  },
  {
    id: "goals",
    get label() {
      return t("nav.goals");
    },
    icon: <Target size={s} />,
    group: "plan",
    key: "g",
    keywords: "okr objectives",
  },
  {
    id: "roadmap",
    get label() {
      return t("nav.roadmap");
    },
    icon: <CalendarDays size={s} />,
    group: "plan",
    keywords: "timeline milestones initiatives capacity baselines critical path updates",
  },
  {
    id: "service",
    get label() {
      return t("nav.service");
    },
    icon: <Headset size={s} />,
    group: "plan",
    keywords: "requests queues sla incidents changes",
  },
  {
    id: "reports",
    get label() {
      return t("nav.reports");
    },
    icon: <BarChart3 size={s} />,
    group: "plan",
    keywords: "charts flow cycle time dashboards export csv",
  },
  {
    id: "risks",
    get label() {
      return t("nav.risks");
    },
    icon: <TriangleAlert size={s} />,
    group: "plan",
  },
  {
    id: "decisions",
    get label() {
      return t("nav.decisions");
    },
    icon: <Scale size={s} />,
    group: "plan",
    key: "d",
    keywords: "adr",
  },
  {
    id: "analytics",
    get label() {
      return t("nav.analytics");
    },
    icon: <BarChart3 size={s} />,
    group: "plan",
    key: "a",
    keywords: "reports metrics",
  },
  {
    id: "portfolio",
    get label() {
      return t("nav.portfolio");
    },
    icon: <Briefcase size={s} />,
    group: "plan",
    keywords: "workload",
  },
  {
    id: "approvals",
    get label() {
      return t("nav.approvals");
    },
    icon: <Stamp size={s} />,
    group: "plan",
  },
  {
    id: "access",
    get label() {
      return t("nav.access");
    },
    icon: <KeyRound size={s} />,
    group: "plan",
    keywords: "permissions grants",
  },
  {
    id: "search",
    get label() {
      return t("nav.search");
    },
    icon: <Search size={s} />,
    group: "org",
    keywords: "find",
  },
  {
    id: "inbox",
    get label() {
      return t("nav.inbox");
    },
    icon: <Inbox size={s} />,
    group: "org",
    key: "n",
    keywords: "notifications",
  },
  {
    id: "people",
    get label() {
      return t("nav.people");
    },
    icon: <Users size={s} />,
    group: "org",
    key: "p",
    keywords: "members teams invite",
  },
  {
    id: "automation",
    get label() {
      return t("nav.automations");
    },
    icon: <Zap size={s} />,
    group: "org",
    keywords: "rules",
  },
  {
    id: "integrations",
    get label() {
      return t("nav.integrations");
    },
    icon: <Plug size={s} />,
    group: "org",
    keywords: "webhooks",
  },
  {
    id: "security",
    get label() {
      return t("nav.security");
    },
    icon: <ShieldCheck size={s} />,
    group: "org",
    keywords: "mfa 2fa sessions",
  },
  {
    id: "identity",
    get label() {
      return t("nav.identity");
    },
    icon: <Fingerprint size={s} />,
    group: "org",
    keywords: "oidc scim domains",
  },
  {
    id: "billing",
    get label() {
      return t("nav.billing");
    },
    icon: <CreditCard size={s} />,
    group: "org",
    keywords: "plan subscription",
  },
  {
    id: "audit",
    get label() {
      return t("nav.audit");
    },
    icon: <ScrollText size={s} />,
    group: "org",
    keywords: "history",
  },
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
