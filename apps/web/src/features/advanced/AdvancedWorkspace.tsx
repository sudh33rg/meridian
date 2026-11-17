import React, { useEffect, useState, useCallback } from "react";
import {
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  Flag,
  GitBranch,
  Globe2,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Target,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { request } from "../../lib/api";
import type { Item, Session, ProjectRef } from "../../lib/types";
import { str, count, day, Empty, Analytics } from "./shared";
import { NotificationPreferences } from "./NotificationPreferences";
import { AutomationBuilder } from "./AutomationBuilder";
import { AuditPanel } from "./AuditPanel";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

export type ExtraTab =
  | "sprints"
  | "releases"
  | "goals"
  | "risks"
  | "decisions"
  | "automation"
  | "analytics"
  | "portfolio"
  | "people"
  | "inbox"
  | "search"
  | "audit"
  | "integrations"
  | "approvals"
  | "security"
  | "access"
  | "identity"
  | "billing";

const configs: Partial<
  Record<
    ExtraTab,
    {
      title: string;
      subtitle: string;
      endpoint: string;
      fields: [string, string, "text" | "long" | "select" | "number" | "date", string[]?][];
    }
  >
> = {
  sprints: {
    title: "Sprint planning",
    subtitle: "Plan iterations and deliver with focus.",
    endpoint: "sprints",
    fields: [
      ["name", "Sprint name", "text"],
      ["goal", "Sprint goal", "long"],
      ["starts_at", "Start date", "date"],
      ["ends_at", "End date", "date"],
    ],
  },
  releases: {
    title: "Releases",
    subtitle: "Track upcoming product delivery.",
    endpoint: "releases",
    fields: [
      ["name", "Release name", "text"],
      ["description", "What is included?", "long"],
      ["target_at", "Target date", "date"],
    ],
  },
  goals: {
    title: "Goals & outcomes",
    subtitle: "Give every team a clear destination.",
    endpoint: "goals",
    fields: [
      ["title", "Goal", "text"],
      ["description", "What success looks like", "long"],
      ["progress", "Progress (%)", "number"],
    ],
  },
  risks: {
    title: "Risk register",
    subtitle: "Surface concerns before they become blockers.",
    endpoint: "risks",
    fields: [
      ["title", "Risk title", "text"],
      ["mitigation", "Mitigation plan", "long"],
      ["likelihood", "Likelihood (1–5)", "number"],
      ["impact", "Impact (1–5)", "number"],
    ],
  },
  decisions: {
    title: "Decision records",
    subtitle: "Architecture & product decisions that stay visible.",
    endpoint: "decisions",
    fields: [
      ["title", "Decision title", "text"],
      ["context", "Context & alternatives considered", "long"],
      ["status", "Status", "select", ["proposed", "accepted", "deprecated", "superseded"]],
    ],
  },
  automation: {
    title: "Project automation",
    subtitle: "Rules that automate repeatable workflows.",
    endpoint: "automations",
    fields: [
      ["name", "Rule name", "text"],
      [
        "trigger_event",
        "Trigger event",
        "select",
        ["issue_created", "status_changed", "assigned", "sprint_started", "due_soon"],
      ],
      [
        "action_type",
        "Action",
        "select",
        ["notify_project_admins", "add_comment", "set_priority_high", "assign_lead"],
      ],
    ],
  },
};

export function AdvancedWorkspace({
  tab,
  session,
  project,
  onSessionChange,
  onError,
  onOpenSearch,
}: {
  tab: ExtraTab;
  session: Session;
  project?: ProjectRef;
  onSessionChange: (s: Session) => void;
  onError: (msg: string) => void;
  onOpenSearch: (item: Item) => void;
}) {
  const cfg = configs[tab];
  const path =
    cfg && project
      ? `/projects/${project.id}/${cfg.endpoint}`
      : tab === "approvals" && project
        ? `/projects/${project.id}/approvals`
        : tab === "analytics" && project
          ? `/projects/${project.id}/analytics`
          : tab === "portfolio"
            ? "/portfolio"
            : tab === "people"
              ? "/members"
              : tab === "inbox"
                ? "/notifications"
                : tab === "audit"
                  ? null
                  : tab === "integrations"
                    ? "/admin/webhooks"
                    : null;
  const [data, setData] = useState<Item[] | Item>([]),
    [loading, setLoading] = useState(false),
    [form, setForm] = useState<Record<string, string>>({}),
    [editing, setEditing] = useState(false),
    [query, setQuery] = useState(""),
    [searchResults, setSearchResults] = useState<Item[]>([]),
    [inviteToken, setInviteToken] = useState(""),
    [workspaces, setWorkspaces] = useState<Item[]>([]),
    [membersList, setMembersList] = useState<Item[]>([]),
    [subjects, setSubjects] = useState<Item[]>([]);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await request<Item[] | Item>(session.token, path));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, session.token, onError]);

  useEffect(() => {
    setData([]);
    setForm({});
    setEditing(false);
    if (path) void load();
  }, [path, load]);

  const projectId = project?.id;
  useEffect(() => {
    if (tab === "approvals" && projectId) {
      Promise.all([
        request<Item[]>(session.token, "/members"),
        request<Item[]>(session.token, `/projects/${projectId}/issues`),
      ])
        .then(([m, items]) => {
          setMembersList(m);
          setSubjects(items);
        })
        .catch((e) => onError(e.message));
    }
  }, [tab, session.token, projectId, onError]);

  useEffect(() => {
    if (tab === "people")
      void request<Item[]>(session.token, "/workspaces")
        .then(setWorkspaces)
        .catch((e) => onError(e.message));
  }, [tab, session.token, onError]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path) return;
    try {
      const payload: Record<string, unknown> = { ...form };
      if (tab === "automation") {
        payload.trigger_event ||= "issue_created";
        payload.action_type ||= "notify_project_admins";
      }
      for (const k of ["progress", "likelihood", "impact"]) {
        if (payload[k]) payload[k] = Number(payload[k]);
      }
      for (const k of ["starts_at", "ends_at", "target_at"]) {
        if (payload[k]) payload[k] = new Date(str(payload[k])).toISOString();
        else delete payload[k];
      }
      await request(session.token, path, { method: "POST", body: JSON.stringify(payload) });
      setForm({});
      setEditing(false);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    try {
      setSearchResults(await request<Item[]>(session.token, "/search?q=" + encodeURIComponent(query)));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const markRead = async (id: string) => {
    try {
      await request(session.token, `/notifications/${id}/read`, { method: "POST" });
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const changeTenant = async (id: string) => {
    try {
      onSessionChange(
        await request<Session>(session.token, "/workspaces/switch", {
          method: "POST",
          body: JSON.stringify({ tenant_id: id }),
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const exportData = async () => {
    if (!project) return;
    try {
      const payload = await request<Item>(session.token, `/projects/${project.id}/export`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `meridian-${project.key.toLowerCase()}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await request<{ invite_token: string }>(session.token, "/invitations", {
        method: "POST",
        body: JSON.stringify({ email: form.email, role: form.role || "member" }),
      });
      setInviteToken(r.invite_token);
      setForm({});
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const title =
    cfg?.title ||
    (
      {
        analytics: "Delivery insights",
        portfolio: "Portfolio pulse",
        people: "People & access",
        inbox: "Notifications",
        search: "Global search",
        audit: "Audit trail",
        integrations: "Integrations & data",
        approvals: "Approval center",
      } as Record<string, string>
    )[tab];

  const subtitle =
    cfg?.subtitle ||
    (
      {
        analytics: "A clearer view of progress and bottlenecks.",
        portfolio: "All projects and goals, together.",
        people: "Collaborate safely across your organization.",
        inbox: "Updates from your workspace.",
        search: "Find work and knowledge in one place.",
        audit: "An accountable record of workspace activity.",
        integrations: "Connect and export your work.",
        approvals: "Send work for review and track decisions.",
      } as Record<string, string>
    )[tab];

  const rows = Array.isArray(data) ? data : [];

  if (tab === "automation" && project) {
    return <AutomationBuilder project={project} session={session} onError={onError} />;
  }

  return (
    <section className="space-y-6 pb-20 md:pb-6 flex flex-col gap-[23px]">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2 max-[760px]:w-full [&_button]:max-[760px]:flex-1">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
              onClick={() => void load()}
              disabled={!path || loading}
            >
              <RefreshCcw size={15} /> Refresh
            </button>
            {cfg && project && (
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
                onClick={() => setEditing(!editing)}
              >
                <Plus size={16} /> New {tab === "automation" ? "rule" : tab.slice(0, -1)}
              </button>
            )}
          </div>
        }
      />

      {loading && (
        <div role="status" className="text-center py-8 text-sm text-muted">
          Loading workspace data…
        </div>
      )}

      {cfg && (
        <>
          {editing && (
            <Card className="mb-6 bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden shadow-[var(--shadow-sm)]">
              <CardHeader className="flex items-center justify-between border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
                <CardTitle>{`Create ${tab === "automation" ? "automation rule" : "entry"}`}</CardTitle>
                <button
                  type="button"
                  className="p-1 rounded text-muted hover:text-text cursor-pointer"
                  onClick={() => setEditing(false)}
                >
                  <X size={18} />
                </button>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4 p-[21px] flex flex-col items-stretch gap-[9px] [&_label]:my-1 [&_p]:text-xs [&_p]:text-text-muted [&_p]:leading-[1.7]"
                  onSubmit={save}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {cfg.fields.map(([field, label, type, options]) => (
                      <label
                        key={field}
                        className={`block text-xs sm:text-sm font-medium text-text space-y-1.5 ${
                          type === "long" ? "sm:col-span-2" : ""
                        }`}
                      >
                        <span>{label}</span>
                        {type === "long" ? (
                          <textarea
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm"
                            value={form[field] || ""}
                            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                          />
                        ) : type === "select" ? (
                          <select
                            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm capitalize"
                            value={form[field] || options?.[0] || ""}
                            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                          >
                            {options?.map((option) => (
                              <option key={option} value={option}>
                                {option.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={type === "date" ? "date" : type}
                            min={type === "number" ? 0 : undefined}
                            max={type === "number" ? 100 : undefined}
                            required={field === "name" || field === "title"}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm"
                            value={form[field] || ""}
                            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end pt-2">
                    <button className="px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]">
                      Create
                    </button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            {rows.map((r, n) => (
              <Card
                className="flex flex-col justify-between p-4 sm:p-5 hover:border-accent/40 transition-colors bg-surface border border-border rounded-[14px] gap-[15px] items-start min-h-[154px] shadow-[var(--shadow-sm)] max-[760px]:p-3.5 [&_h3]:text-[13px] [&_h3]:mt-0.5 [&_h3]:mb-2.5 [&_p]:text-xs [&_p]:text-text-muted [&_p]:leading-[1.6] [&_p]:m-0 [&_p]:mb-[15px] [&_p]:whitespace-pre-wrap [&_small]:text-[10px] [&_small]:text-text-subtle"
                key={str(r.id || n)}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-muted min-w-[37px] place-items-center">
                        {tab === "sprints" ? (
                          <GitBranch size={16} />
                        ) : tab === "goals" ? (
                          <Target size={16} />
                        ) : tab === "automation" ? (
                          <Workflow size={16} />
                        ) : (
                          <Flag size={16} />
                        )}
                      </div>
                      <h3 className="font-semibold text-text text-sm sm:text-base leading-tight">
                        {str(r.name || r.title)}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text border border-border shrink-0 capitalize whitespace-nowrap">
                      {str(r.state || r.status || (r.enabled ? "Enabled" : "Registered"))}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-muted line-clamp-3 mb-3">
                    {str(r.goal || r.description || r.mitigation || r.context || r.trigger_event || "")}
                  </p>

                  {tab === "goals" && (
                    <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden mb-3 flex-1 min-w-[25px] [&>div]:bg-accent [&>div]:h-full [&>div]:rounded-[20px] [&>div]:transition-[width] [&>div]:duration-200">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${count(r.progress)}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
                  <small className="text-xs text-muted">
                    {tab === "risks"
                      ? `Risk score ${count(r.likelihood) * count(r.impact)} / 25`
                      : tab === "automation"
                        ? `Action: ${str(r.action_type).replaceAll("_", " ")}`
                        : tab === "goals"
                          ? `${count(r.progress)}% completed`
                          : r.target_at
                            ? `Target ${day(r.target_at)}`
                            : r.ends_at
                              ? `Ends ${day(r.ends_at)}`
                              : `Created ${day(r.created_at)}`}
                  </small>

                  {tab === "sprints" && r.state !== "completed" && (
                    <button
                      className="text-xs px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                      onClick={async () => {
                        try {
                          await request(session.token, `/sprints/${r.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ state: r.state === "planned" ? "active" : "completed" }),
                          });
                          await load();
                        } catch (e) {
                          onError((e as Error).message);
                        }
                      }}
                    >
                      {r.state === "planned" ? "Start sprint" : "Complete"}
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {rows.length === 0 && !loading && (
            <Empty
              title="A fresh start"
              caption={`Create the first ${tab === "automation" ? "automation rule" : tab.slice(0, -1)} for this project.`}
            />
          )}
        </>
      )}

      {tab === "approvals" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-[900px]:grid-cols-1">
          <Card className="lg:col-span-2 bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Approval requests</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-[22px] items-center border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(r.id)}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <ShieldCheck size={18} className="text-accent shrink-0 mt-0.5 sm:mt-0" />
                    <div>
                      <b className="font-semibold text-text text-xs sm:text-sm block">{str(r.title)}</b>
                      <small className="text-xs text-muted">
                        {str(r.subject_type)} · {str(r.status)}
                      </small>
                    </div>
                  </div>
                  {r.reviewer_id === session.user_id && r.status === "pending" ? (
                    <div className="flex items-center gap-2 max-[760px]:w-full [&_button]:max-[760px]:flex-1">
                      {(["approved", "rejected"] as const).map((next) => (
                        <button
                          key={next}
                          className="text-xs px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                          onClick={async () => {
                            try {
                              await request(session.token, `/approvals/${r.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ status: next }),
                              });
                              await load();
                            } catch (e) {
                              onError((e as Error).message);
                            }
                          }}
                        >
                          {next === "approved" ? "Approve" : "Reject"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text border border-border self-start sm:self-auto capitalize whitespace-nowrap">
                      {str(r.status)}
                    </span>
                  )}
                </div>
              ))}
              {!rows.length && (
                <Empty
                  title="Nothing to review"
                  caption="Request an approval to capture an explicit decision."
                />
              )}
            </CardContent>
          </Card>

          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Request approval</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await request(session.token, path!, { method: "POST", body: JSON.stringify(form) });
                    setForm({});
                    await load();
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}
              >
                <label className="block text-xs sm:text-sm font-medium text-text space-y-1">
                  <span>Title</span>
                  <input
                    required
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                    value={form.title || ""}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </label>
                <label className="block text-xs sm:text-sm font-medium text-text space-y-1">
                  <span>Issue</span>
                  <select
                    required
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                    value={form.subject_id || ""}
                    onChange={(e) => setForm({ ...form, subject_id: e.target.value, subject_type: "issue" })}
                  >
                    <option value="">Choose work</option>
                    {subjects.map((x) => (
                      <option key={str(x.id)} value={str(x.id)}>
                        {str(x.title)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs sm:text-sm font-medium text-text space-y-1">
                  <span>Reviewer</span>
                  <select
                    required
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                    value={form.reviewer_id || ""}
                    onChange={(e) => setForm({ ...form, reviewer_id: e.target.value })}
                  >
                    <option value="">Choose reviewer</option>
                    {membersList.map((x) => (
                      <option key={str(x.id)} value={str(x.id)}>
                        {str(x.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="w-full py-2 rounded-lg text-xs sm:text-sm font-medium text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 shadow-[var(--shadow-sm)]">
                  Request review
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "analytics" && <Analytics data={data} />}

      {tab === "portfolio" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-[900px]:grid-cols-1">
          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {(((data as Item).projects as Item[]) || []).map((p) => (
                <div
                  className="flex items-center justify-between py-3 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(p.id)}
                >
                  <div>
                    <b className="font-semibold text-text text-xs sm:text-sm block">{str(p.name)}</b>
                    <small className="text-xs text-muted">
                      {str(p.key)} · {count(p.issues)} issues
                    </small>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success-soft text-success-text border border-success-border capitalize whitespace-nowrap">
                    {count(p.done)} delivered
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Goals</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {(((data as Item).goals as Item[]) || []).map((g) => (
                <div
                  className="flex items-center justify-between py-3 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(g.id)}
                >
                  <div>
                    <b className="font-semibold text-text text-xs sm:text-sm block">{str(g.title)}</b>
                    <small className="text-xs text-muted capitalize">
                      {str(g.status).replaceAll("_", " ")}
                    </small>
                  </div>
                  <b className="font-semibold text-accent text-xs sm:text-sm">{count(g.progress)}%</b>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "people" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-[900px]:grid-cols-1">
          <Card className="lg:col-span-2 bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex items-center justify-between border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Members</CardTitle>
              <Users size={17} className="text-muted" />
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  className="flex items-center justify-between py-3 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(r.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center text-xs place-items-center">
                      {str(r.name)[0]?.toUpperCase()}
                    </span>
                    <div>
                      <b className="font-semibold text-text text-xs sm:text-sm block">{str(r.name)}</b>
                      <small className="text-xs text-muted">{str(r.email)}</small>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text border border-border capitalize whitespace-nowrap">
                    {str(r.role)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
              <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
                <CardTitle>Invite team members</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4 p-[21px] flex flex-col items-stretch gap-[9px] [&_label]:my-1 [&_p]:text-xs [&_p]:text-text-muted [&_p]:leading-[1.7]"
                  onSubmit={invite}
                >
                  <label className="block text-xs sm:text-sm font-medium text-text space-y-1">
                    <span>Work email</span>
                    <input
                      type="email"
                      required
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                      value={form.email || ""}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs sm:text-sm font-medium text-text space-y-1">
                    <span>Role</span>
                    <select
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-accent/20 capitalize"
                      value={form.role || "member"}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      <option>member</option>
                      <option>viewer</option>
                      <option>guest</option>
                      <option>admin</option>
                    </select>
                  </label>
                  <button className="w-full py-2 rounded-lg text-xs sm:text-sm font-medium text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 shadow-[var(--shadow-sm)]">
                    Generate invitation
                  </button>
                  {inviteToken && (
                    <div className="p-3 bg-surface-2 rounded-lg border border-border space-y-2 mt-3 min-w-0 [&_p]:break-all [&_p]:font-mono [&_p]:text-xs [&_small]:block [&_small]:mt-2.5">
                      <b className="block text-xs font-semibold text-text">Copy this invitation token once</b>
                      <p className="text-xs font-mono break-all text-muted p-2 bg-surface rounded border border-border">
                        {inviteToken}
                      </p>
                      <button
                        type="button"
                        className="w-full py-1.5 rounded-md text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-text-muted hover:text-text-main"
                        onClick={() => navigator.clipboard.writeText(inviteToken)}
                      >
                        Copy token
                      </button>
                      <small className="block text-[11px] text-muted">
                        An invitation email has been queued. You can also share this token yourself.
                      </small>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>

            <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
              <CardHeader className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
                <CardTitle>Your workspaces</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {workspaces.map((w) => (
                  <div
                    className="flex items-center justify-between py-2.5 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                    key={str(w.id)}
                  >
                    <div>
                      <b className="font-semibold text-text text-xs sm:text-sm block">{str(w.name)}</b>
                      <small className="text-xs text-muted capitalize">{str(w.role)}</small>
                    </div>
                    <button
                      className="text-xs px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                      disabled={w.id === session.tenant_id}
                      onClick={() => changeTenant(str(w.id))}
                    >
                      {w.id === session.tenant_id ? "Current" : "Switch"}
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "inbox" && (
        <div className="space-y-6">
          <NotificationPreferences token={session.token} onError={onError} />
          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  className="flex items-start justify-between gap-3 py-3 px-[22px] border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(r.id)}
                >
                  <div className="flex items-start gap-3">
                    <Bell size={18} className="text-accent shrink-0 mt-0.5" />
                    <div>
                      <b className="font-semibold text-text text-xs sm:text-sm block">{str(r.title)}</b>
                      <small className="text-xs text-muted block mt-0.5">
                        {str(r.body)} · {day(r.created_at)}
                      </small>
                    </div>
                  </div>
                  {!r.read_at && (
                    <button
                      className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer shrink-0 justify-center whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                      onClick={() => markRead(str(r.id))}
                    >
                      <Check size={14} /> Mark read
                    </button>
                  )}
                </div>
              ))}
              {rows.length === 0 && (
                <Empty title="All caught up" caption="Updates from your projects will appear here." />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "search" && (
        <div className="space-y-6">
          <form
            className="flex items-center gap-2 bg-surface border border-border rounded-[13px] py-2.5 pr-3 pl-5 text-accent-text [&_input]:border-0 [&_input]:outline-none [&_input]:flex-1 [&_input]:min-w-20 [&_input]:text-sm"
            onSubmit={runSearch}
          >
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                aria-label="Search work and knowledge"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface text-text text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-accent/20"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, issues and decisions…"
                minLength={2}
              />
            </div>
            <button className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]">
              Search
            </button>
          </form>

          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardContent className="p-0 divide-y divide-border">
              {searchResults.map((r) => (
                <button
                  className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-surface-2 transition-colors cursor-pointer px-[22px] py-4 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden bg-transparent"
                  type="button"
                  key={str(r.id)}
                  onClick={() => onOpenSearch(r)}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-muted shrink-0 min-w-[37px] place-items-center">
                      {r.kind === "page" ? <BookOpen size={16} /> : <Flag size={16} />}
                    </span>
                    <div>
                      <b className="font-semibold text-text text-xs sm:text-sm block">{str(r.title)}</b>
                      <small className="text-xs text-muted line-clamp-1">
                        {str(r.kind)} · {str(r.preview)}
                      </small>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted shrink-0" />
                </button>
              ))}
              {!searchResults.length && (
                <Empty
                  title="Connected search"
                  caption="Search all accessible work and knowledge in your workspace."
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "audit" && <AuditPanel token={session.token} onError={onError} />}

      {tab === "integrations" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-[900px]:grid-cols-1">
          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex items-center justify-between border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Project export</CardTitle>
              <Download size={18} className="text-muted" />
            </CardHeader>
            <CardContent className="space-y-4 p-[21px] flex flex-col items-stretch gap-[9px] [&_label]:my-1 [&_p]:text-xs [&_p]:text-text-muted [&_p]:leading-[1.7]">
              <p className="text-xs sm:text-sm text-muted">
                Download issues, pages, sprints, and project details as JSON. Large projects require paginated
                export.
              </p>
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50 justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
                disabled={!project}
                onClick={exportData}
              >
                <Download size={16} /> Export {project?.key || "project"}
              </button>
              <p className="text-xs text-muted">
                Integration webhooks are registered disabled until safe delivery is configured.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]">
            <CardHeader className="flex items-center justify-between border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
              <CardTitle>Registered webhooks</CardTitle>
              <Globe2 size={18} className="text-muted" />
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {rows.map((r) => (
                <div
                  className="flex items-center justify-between py-3 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
                  key={str(r.id)}
                >
                  <div>
                    <b className="font-semibold text-text text-xs sm:text-sm block">{str(r.name)}</b>
                    <small className="text-xs text-muted">{str(r.url)}</small>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text border border-border capitalize whitespace-nowrap">
                    Disabled
                  </span>
                </div>
              ))}
              {!rows.length && (
                <Empty
                  title="No connections yet"
                  caption="Webhook registration API is available to workspace admins."
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
