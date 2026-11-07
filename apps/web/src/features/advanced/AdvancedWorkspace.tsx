import React, { useEffect, useState } from "react";
import {
  Activity,
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
  | "access";
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
    subtitle: "Keep context and rationale connected to work.",
    endpoint: "decisions",
    fields: [
      ["title", "Decision", "text"],
      ["context", "Context", "long"],
      ["outcome", "Outcome", "long"],
    ],
  },
  automation: {
    title: "Automation rules",
    subtitle: "Start with safe, predictable actions.",
    endpoint: "automations",
    fields: [
      ["name", "Rule name", "text"],
      ["trigger_event", "When", "select", ["issue_created", "issue_status_changed"]],
      ["action_type", "Then", "select", ["notify_project_admins", "set_priority_high"]],
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
                  ? "/audit"
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
  const load = async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await request<Item[] | Item>(session.token, path));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setData([]);
    setForm({});
    setEditing(false);
    if (path) void load();
  }, [path, session.token]);
  useEffect(() => {
    if (tab === "approvals" && project) {
      Promise.all([
        request<Item[]>(session.token, "/members"),
        request<Item[]>(session.token, `/projects/${project.id}/issues`),
      ])
        .then(([m, items]) => {
          setMembersList(m);
          setSubjects(items);
        })
        .catch((e) => onError(e.message));
    }
  }, [tab, session.token, project?.id]);
  useEffect(() => {
    if (tab === "people")
      void request<Item[]>(session.token, "/workspaces")
        .then(setWorkspaces)
        .catch((e) => onError(e.message));
  }, [tab, session.token]);
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
  return (
    <section className="extended">
      <div className="ext-title">
        <div>
          <div className="eyebrow blue">MERIDIAN / {project?.key || "WORKSPACE"}</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ext-actions">
          <button className="secondary" onClick={() => void load()} disabled={!path || loading}>
            <RefreshCcw size={15} /> Refresh
          </button>
          {cfg && project && (
            <button className="primary" onClick={() => setEditing(!editing)}>
              <Plus size={16} /> New {tab === "automation" ? "rule" : tab.slice(0, -1)}
            </button>
          )}
        </div>
      </div>
      {loading && (
        <div role="status" className="ext-loading">
          Loading workspace data…
        </div>
      )}
      {cfg && (
        <>
          {editing && (
            <form className="ext-form panel" onSubmit={save}>
              <div className="panel-head">
                <h3>Create {tab === "automation" ? "automation rule" : "entry"}</h3>
                <button type="button" onClick={() => setEditing(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="ext-form-body">
                {cfg.fields.map(([field, label, type, options]) => (
                  <label key={field}>
                    {label}
                    {type === "long" ? (
                      <textarea
                        rows={3}
                        value={form[field] || ""}
                        onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      />
                    ) : type === "select" ? (
                      <select
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
                        value={form[field] || ""}
                        onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      />
                    )}
                  </label>
                ))}
                <button className="primary">Create</button>
              </div>
            </form>
          )}
          <div className="ext-cards">
            {rows.map((r, n) => (
              <div className="ext-card" key={str(r.id || n)}>
                <div className="ext-card-icon">
                  {tab === "sprints" ? (
                    <GitBranch size={18} />
                  ) : tab === "goals" ? (
                    <Target size={18} />
                  ) : tab === "automation" ? (
                    <Workflow size={18} />
                  ) : (
                    <Flag size={18} />
                  )}
                </div>
                <div className="ext-card-content">
                  <div className="ext-card-top">
                    <h3>{str(r.name || r.title)}</h3>
                    <span className="chip">
                      {str(r.state || r.status || (r.enabled ? "Enabled" : "Registered"))}
                    </span>
                  </div>
                  <p>{str(r.goal || r.description || r.mitigation || r.context || r.trigger_event || "")}</p>
                  {tab === "goals" && (
                    <div className="progress-track">
                      <div style={{ width: `${count(r.progress)}%` }} />
                    </div>
                  )}
                  <small>
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
                </div>
                {tab === "sprints" && r.state !== "completed" && (
                  <button
                    className="secondary"
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
            ))}
            {rows.length === 0 && !loading && (
              <Empty
                title="A fresh start"
                caption={`Create the first ${tab === "automation" ? "automation rule" : tab.slice(0, -1)} for this project.`}
              />
            )}
          </div>
        </>
      )}
      {tab === "approvals" && (
        <>
          <div className="ext-two-cols">
            <div className="panel">
              <div className="panel-head">
                <h3>Approval requests</h3>
              </div>
              {rows.map((r) => (
                <div className="ext-line" key={str(r.id)}>
                  <ShieldCheck size={18} />
                  <div>
                    <b>{str(r.title)}</b>
                    <small>
                      {str(r.subject_type)} · {str(r.status)}
                    </small>
                  </div>
                  {r.reviewer_id === session.user_id && r.status === "pending" ? (
                    <div className="ext-actions">
                      {(["approved", "rejected"] as const).map((next) => (
                        <button
                          key={next}
                          className="secondary"
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
                    <span className="chip">{str(r.status)}</span>
                  )}
                </div>
              ))}
              {!rows.length && (
                <Empty
                  title="Nothing to review"
                  caption="Request an approval to capture an explicit decision."
                />
              )}
            </div>
            <form
              className="panel"
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
              <div className="panel-head">
                <h3>Request approval</h3>
              </div>
              <div className="ext-form-body">
                <label>
                  Title
                  <input
                    required
                    value={form.title || ""}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </label>
                <label>
                  Issue
                  <select
                    required
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
                <label>
                  Reviewer
                  <select
                    required
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
                <button className="primary">Request review</button>
              </div>
            </form>
          </div>
        </>
      )}
      {tab === "analytics" && <Analytics data={data} />}
      {tab === "portfolio" && (
        <div className="ext-two-cols">
          <div className="panel">
            <div className="panel-head">
              <h3>Projects</h3>
            </div>
            {(((data as Item).projects as Item[]) || []).map((p) => (
              <div className="ext-line" key={str(p.id)}>
                <div>
                  <b>{str(p.name)}</b>
                  <small>
                    {str(p.key)} · {count(p.issues)} issues
                  </small>
                </div>
                <span className="chip success">{count(p.done)} delivered</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Goals</h3>
            </div>
            {(((data as Item).goals as Item[]) || []).map((g) => (
              <div className="ext-line" key={str(g.id)}>
                <div>
                  <b>{str(g.title)}</b>
                  <small>{str(g.status).replaceAll("_", " ")}</small>
                </div>
                <b>{count(g.progress)}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "people" && (
        <div className="ext-two-cols">
          <div className="panel">
            <div className="panel-head">
              <h3>Members</h3>
              <Users size={17} />
            </div>
            {rows.map((r) => (
              <div className="ext-line" key={str(r.id)}>
                <span className="ext-avatar">{str(r.name)[0]?.toUpperCase()}</span>
                <div>
                  <b>{str(r.name)}</b>
                  <small>{str(r.email)}</small>
                </div>
                <span className="chip">{str(r.role)}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Invite team members</h3>
            </div>
            <form className="ext-form-body" onSubmit={invite}>
              <label>
                Work email
                <input
                  type="email"
                  required
                  value={form.email || ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={form.role || "member"}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option>member</option>
                  <option>viewer</option>
                  <option>admin</option>
                </select>
              </label>
              <button className="primary">Generate invitation</button>
              {inviteToken && (
                <div className="ext-secret">
                  <b>Copy this invitation token once</b>
                  <p>{inviteToken}</p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigator.clipboard.writeText(inviteToken)}
                  >
                    Copy token
                  </button>
                  <small>An invitation email has been queued. You can also share this token yourself.</small>
                </div>
              )}
            </form>
            <div className="panel-head">
              <h3>Your workspaces</h3>
            </div>
            {workspaces.map((w) => (
              <div className="ext-line" key={str(w.id)}>
                <div>
                  <b>{str(w.name)}</b>
                  <small>{str(w.role)}</small>
                </div>
                <button
                  className="secondary"
                  disabled={w.id === session.tenant_id}
                  onClick={() => changeTenant(str(w.id))}
                >
                  Switch
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "inbox" && (
        <div className="panel">
          {rows.map((r) => (
            <div className="ext-line" key={str(r.id)}>
              <Bell size={20} />
              <div>
                <b>{str(r.title)}</b>
                <small>
                  {str(r.body)} · {day(r.created_at)}
                </small>
              </div>
              {!r.read_at && (
                <button className="secondary" onClick={() => markRead(str(r.id))}>
                  <Check size={15} /> Mark read
                </button>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <Empty title="All caught up" caption="Updates from your projects will appear here." />
          )}
        </div>
      )}
      {tab === "search" && (
        <>
          <form className="ext-search" onSubmit={runSearch}>
            <Search size={20} />
            <input
              aria-label="Search work and knowledge"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages, issues and decisions…"
              minLength={2}
            />
            <button className="primary">Search</button>
          </form>
          <div className="panel">
            {searchResults.map((r) => (
              <button
                className="ext-line ext-result"
                type="button"
                key={str(r.id)}
                onClick={() => onOpenSearch(r)}
              >
                <span className="ext-card-icon">
                  {r.kind === "page" ? <BookOpen size={18} /> : <Flag size={18} />}
                </span>
                <div>
                  <b>{str(r.title)}</b>
                  <small>
                    {str(r.kind)} · {str(r.preview)}
                  </small>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
            {!searchResults.length && (
              <Empty
                title="Connected search"
                caption="Search all accessible work and knowledge in your workspace."
              />
            )}
          </div>
        </>
      )}
      {tab === "audit" && (
        <div className="panel">
          {rows.map((r, n) => (
            <div className="ext-line" key={n}>
              <Activity size={17} />
              <div>
                <b>
                  {str(r.actor)} {str(r.action)} {str(r.entity_type)}
                </b>
                <small>
                  {str(r.entity_id)} · {day(r.occurred_at)}
                </small>
              </div>
            </div>
          ))}
          {!rows.length && (
            <Empty title="No recorded events" caption="Administrative activity will appear here." />
          )}
        </div>
      )}
      {tab === "integrations" && (
        <div className="ext-two-cols">
          <div className="panel">
            <div className="panel-head">
              <h3>Project export</h3>
              <Download size={18} />
            </div>
            <div className="ext-form-body">
              <p>
                Download issues, pages, sprints, and project details as JSON. Large projects require paginated
                export.
              </p>
              <button className="primary" disabled={!project} onClick={exportData}>
                <Download size={16} /> Export {project?.key || "project"}
              </button>
              <p className="subtle-note">
                Integration webhooks are registered disabled until safe delivery is configured.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Registered webhooks</h3>
              <Globe2 size={18} />
            </div>
            {rows.map((r) => (
              <div className="ext-line" key={str(r.id)}>
                <div>
                  <b>{str(r.name)}</b>
                  <small>{str(r.url)}</small>
                </div>
                <span className="chip">Disabled</span>
              </div>
            ))}
            {!rows.length && (
              <Empty
                title="No connections yet"
                caption="Webhook registration API is available to workspace admins."
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
