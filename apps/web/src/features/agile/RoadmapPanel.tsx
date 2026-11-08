import { formatDate } from "../../lib/datetime";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { formatMinutes } from "./IssueDepth";
import { PortfolioOverviewView } from "./PortfolioOverviewView";
import { RaidRegisterView } from "./RaidRegisterView";

type Timeline = { kind: string; id: string; name: string; start: string | null; end: string | null; status: string | null; progress: number | null };
type Milestone = { id: string; name: string; target_on: string; reached_on: string | null };
type Critical = { path: { issue_id: string; number: number; title: string; minutes: number }[]; total_minutes: number; has_cycle: boolean };
type Update = { id: string; author_name: string; health: string; body: string; created_at: string };
type Initiative = { id: string; name: string; status: string; target_on: string | null; epics: number; epics_done: number };
type Capacity = { user_id: string; name: string; hours_per_week: number | null; open_issues: number; remaining_hours: number; utilisation_pct: number | null };
type Baseline = { id: string; name: string; items: number; created_at: string };
type Variance = { issue_id: string; number: number; title: string; variance_days: number | null; done: boolean };

const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };

/** Roadmap, portfolio, capacity and baselines for one project, plus the workspace's initiatives. */
export function RoadmapPanel() {
  const { session, selected, project, tab, setError, setSelectedIssue } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = session.token;
  const active = tab === "roadmap" && !!selected;
  const [subView, setSubView] = useState<"roadmap" | "portfolio" | "raid">("roadmap");
  const [msName, setMsName] = useState("");
  const [msDate, setMsDate] = useState("");
  const [health, setHealth] = useState("on_track");
  const [body, setBody] = useState("");
  const [initName, setInitName] = useState("");
  const [initDate, setInitDate] = useState("");
  const [baseName, setBaseName] = useState("");
  const [baseChoice, setBaseChoice] = useState("");
  const [epicPick, setEpicPick] = useState("");
  const [initPick, setInitPick] = useState("");
  const timeline = useQuery({
    queryKey: ["timeline", selected],
    queryFn: () => request<Timeline[]>(token, `/projects/${selected}/timeline`),
    enabled: active,
  });
  const milestones = useQuery({
    queryKey: ["milestones", selected],
    queryFn: () => request<Milestone[]>(token, `/projects/${selected}/milestones`),
    enabled: active,
  });
  const critical = useQuery({
    queryKey: ["critical", selected],
    queryFn: () => request<Critical>(token, `/projects/${selected}/critical-path`),
    enabled: active,
  });
  const updates = useQuery({
    queryKey: ["updates", selected],
    queryFn: () => request<Update[]>(token, `/projects/${selected}/updates`),
    enabled: active,
  });
  const initiatives = useQuery({
    queryKey: ["initiatives"],
    queryFn: () => request<Initiative[]>(token, `/initiatives`),
    enabled: active,
  });
  const capacity = useQuery({
    queryKey: ["capacity", selected],
    queryFn: () => request<Capacity[]>(token, `/capacity?project_id=${selected}`),
    enabled: active,
  });
  const baselines = useQuery({
    queryKey: ["baselines", selected],
    queryFn: () => request<Baseline[]>(token, `/projects/${selected}/baselines`),
    enabled: active,
  });
  const variance = useQuery({
    queryKey: ["variance", baseChoice],
    queryFn: () => request<Variance[]>(token, `/baselines/${baseChoice}/variance`),
    enabled: active && !!baseChoice,
  });
  const epics = (timeline.data ?? []).filter((t) => t.kind === "epic");
  if (!active) return null;

  const run = async (job: () => Promise<unknown>, message?: string) => {
    try {
      await job();
      await Promise.all(["timeline", "milestones", "critical", "updates", "initiatives", "capacity", "baselines"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ));
      if (message) toast(message);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Timeline scale: the span of every dated item, with a margin on each side.
  const dated = (timeline.data ?? []).flatMap((t) => [t.start, t.end]).filter((d): d is string => !!d).map((d) => Date.parse(d));
  const lo = dated.length ? Math.min(...dated) : Date.now();
  const hi = dated.length ? Math.max(...dated, lo + 86_400_000) : lo + 86_400_000 * 30;
  const span = Math.max(hi - lo, 86_400_000);
  const at = (d: string) => `${Math.min(100, Math.max(0, ((Date.parse(d) - lo) / span) * 100))}%`;

  return (
    <section className="planning roadmap" aria-labelledby="roadmap-title">
      <div className="planning-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 id="roadmap-title">Roadmap & Governance</h2>
          <p className="muted small">{project?.name}. Project timeline, portfolio roll-up, and RAID register.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={subView === "roadmap" ? "primary small-btn" : "secondary small-btn"}
            onClick={() => setSubView("roadmap")}
          >
            Project Roadmap
          </button>
          <button
            className={subView === "portfolio" ? "primary small-btn" : "secondary small-btn"}
            onClick={() => setSubView("portfolio")}
          >
            Portfolio Roll-up
          </button>
          <button
            className={subView === "raid" ? "primary small-btn" : "secondary small-btn"}
            onClick={() => setSubView("raid")}
          >
            RAID Register
          </button>
        </div>
      </div>

      {subView === "portfolio" && <PortfolioOverviewView />}
      {subView === "raid" && <RaidRegisterView projectId={selected} />}

      {subView === "roadmap" && (
        <>
          <section className="panel" aria-labelledby="timeline-title">
            <h3 id="timeline-title">Timeline</h3>
            {(timeline.data ?? []).filter((t) => t.start || t.end).length === 0 && (
              <p className="muted small">Add due dates to epics, target dates to releases, and sprint dates to see them here.</p>
            )}
            <ul className="timeline" aria-label="Timeline items">
              {(timeline.data ?? []).map((t) => (
                <li key={`${t.kind}-${t.id}`} className="timeline-row">
                  <span className="timeline-name">
                    <span className="chip">{t.kind}</span> {t.name}
                    {t.progress != null && <span className="small muted"> · {t.progress}%</span>}
                  </span>
                  <span className="timeline-track" aria-hidden>
                    {t.kind === "milestone" && t.end ? (
                      <span className="milestone-mark" style={{ left: at(t.end) }} />
                    ) : t.start && t.end ? (
                      <span
                        className="timeline-bar"
                        style={{ left: at(t.start), width: `calc(${at(t.end)} - ${at(t.start)})` }}
                      >
                        {t.progress != null && <span className="timeline-progress" style={{ width: `${t.progress}%` }} />}
                      </span>
                    ) : t.end ? (
                      <span className="milestone-mark" style={{ left: at(t.end) }} />
                    ) : null}
                  </span>
                  <span className="small muted">{t.end ?? t.start ?? "no date"}</span>
                </li>
              ))}
            </ul>
          </section>

      <div className="roadmap-grid">
        <section className="panel" aria-labelledby="ms-title">
          <h3 id="ms-title">Milestones</h3>
          <form
            className="row-actions wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (!msName.trim() || !msDate || !selected) return;
              run(async () => {
                await send(`/projects/${selected}/milestones`, token, "POST", { name: msName.trim(), target_on: msDate });
                setMsName("");
                setMsDate("");
              }, "Milestone added");
            }}
          >
            <input aria-label="Milestone name" placeholder="Milestone" value={msName} maxLength={120} onChange={(e) => setMsName(e.target.value)} />
            <input aria-label="Milestone date" type="date" value={msDate} onChange={(e) => setMsDate(e.target.value)} />
            <button className="secondary small-btn" disabled={!msName.trim() || !msDate}>
              Add
            </button>
          </form>
          <ul className="plain-list">
            {(milestones.data ?? []).map((m) => (
              <li key={m.id} className="small">
                <b>{m.name}</b> · {m.target_on}{" "}
                {m.reached_on ? <span className="chip success">Reached {m.reached_on}</span> : null}
                <button
                  className="secondary small-btn"
                  onClick={() => run(() => send(`/milestones/${m.id}`, token, "PATCH", { reached: !m.reached_on }))}
                >
                  {m.reached_on ? "Reopen" : "Mark reached"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="crit-title">
          <h3 id="crit-title">Critical path</h3>
          {critical.data?.has_cycle && <p className="error small">Dependencies form a loop. Break one link to see the path.</p>}
          {critical.data && !critical.data.has_cycle && critical.data.path.length === 0 && (
            <p className="muted small">No blocking links between open issues yet.</p>
          )}
          {critical.data && critical.data.path.length > 0 && (
            <>
              <p className="small">
                {critical.data.path.length} steps · {formatMinutes(critical.data.total_minutes)} of remaining work
              </p>
              <ol className="plain-list" aria-label="Critical path">
                {critical.data.path.map((p) => (
                  <li key={p.issue_id} className="small">
                    <button className="issue-number-button" onClick={() => setSelectedIssue(p.issue_id)}>
                      {project?.key}-{p.number}
                    </button>{" "}
                    {p.title} <span className="muted">· {formatMinutes(p.minutes)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="upd-title">
          <h3 id="upd-title">Project updates</h3>
          <form
            className="row-actions wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (!body.trim() || !selected) return;
              run(async () => {
                await send(`/projects/${selected}/updates`, token, "POST", { health, body: body.trim() });
                setBody("");
              }, "Update posted");
            }}
          >
            <select aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value)}>
              {Object.entries(HEALTH).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input aria-label="Update" placeholder="What changed?" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
            <button className="secondary small-btn" disabled={!body.trim()}>
              Post
            </button>
          </form>
          <ul className="plain-list">
            {(updates.data ?? []).slice(0, 10).map((u) => (
              <li key={u.id} className="small">
                <span className={"chip " + (u.health === "on_track" ? "success" : "warn")}>{HEALTH[u.health] ?? u.health}</span>{" "}
                {u.body} <span className="muted">— {u.author_name}, {formatDate(u.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="init-title">
          <h3 id="init-title">Initiatives</h3>
          <form
            className="row-actions wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (!initName.trim()) return;
              run(async () => {
                await send(`/initiatives`, token, "POST", { name: initName.trim(), target_on: initDate || null });
                setInitName("");
                setInitDate("");
              }, "Initiative created");
            }}
          >
            <input aria-label="Initiative name" placeholder="Initiative" value={initName} maxLength={120} onChange={(e) => setInitName(e.target.value)} />
            <input aria-label="Initiative target" type="date" value={initDate} onChange={(e) => setInitDate(e.target.value)} />
            <button className="secondary small-btn" disabled={!initName.trim()}>
              Add
            </button>
          </form>
          <ul className="plain-list">
            {(initiatives.data ?? []).map((n) => {
              const pct = n.epics ? Math.round((n.epics_done / n.epics) * 100) : 0;
              return (
                <li key={n.id} className="small">
                  <b>{n.name}</b> · {n.status} · {n.epics_done}/{n.epics} epics done
                  <div className="progress-track" aria-hidden>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {epics.length > 0 && (initiatives.data ?? []).length > 0 && (
            <form
              className="row-actions wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (!initPick || !epicPick) return;
                run(() => send(`/initiatives/${initPick}/epics`, token, "PUT", { issue_ids: [epicPick] }), "Epic linked");
                setEpicPick("");
              }}
            >
              <select aria-label="Initiative to link" value={initPick} onChange={(e) => setInitPick(e.target.value)}>
                <option value="">Initiative…</option>
                {(initiatives.data ?? []).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <select aria-label="Epic to link" value={epicPick} onChange={(e) => setEpicPick(e.target.value)}>
                <option value="">Epic…</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
              <button className="secondary small-btn" disabled={!initPick || !epicPick}>
                Link epic
              </button>
            </form>
          )}
        </section>

        <section className="panel" aria-labelledby="cap-title">
          <h3 id="cap-title">Capacity</h3>
          <table className="simple-table" aria-label="Capacity by member">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Hours a week</th>
                <th scope="col">Open work</th>
                <th scope="col">Load</th>
              </tr>
            </thead>
            <tbody>
              {(capacity.data ?? []).map((c) => (
                <tr key={c.user_id}>
                  <td>{c.name}</td>
                  <td>
                    <input
                      aria-label={`Hours a week for ${c.name}`}
                      type="number"
                      min={0}
                      max={168}
                      step={0.5}
                      defaultValue={c.hours_per_week ?? ""}
                      style={{ width: 80 }}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (e.target.value === "" || v === c.hours_per_week) return;
                        run(() => send(`/members/${c.user_id}/capacity`, token, "PUT", { hours_per_week: v }), "Capacity saved");
                      }}
                    />
                  </td>
                  <td>
                    {c.open_issues} issues · {c.remaining_hours.toFixed(1)} h left
                  </td>
                  <td>{c.utilisation_pct == null ? "–" : `${Math.round(c.utilisation_pct)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-labelledby="base-title">
          <h3 id="base-title">Baselines</h3>
          <form
            className="row-actions wrap"
            onSubmit={(e) => {
              e.preventDefault();
              if (!baseName.trim() || !selected) return;
              run(async () => {
                const created = await send<Baseline>(`/projects/${selected}/baselines`, token, "POST", { name: baseName.trim() });
                setBaseName("");
                setBaseChoice(created.id);
              }, "Baseline saved");
            }}
          >
            <input aria-label="Baseline name" placeholder="Baseline name" value={baseName} maxLength={120} onChange={(e) => setBaseName(e.target.value)} />
            <button className="secondary small-btn" disabled={!baseName.trim()}>
              Save baseline
            </button>
          </form>
          <select aria-label="Baseline to compare" value={baseChoice} onChange={(e) => setBaseChoice(e.target.value)}>
            <option value="">Compare with…</option>
            {(baselines.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.items} issues)
              </option>
            ))}
          </select>
          {variance.data && (
            <p className="small">
              {variance.data.filter((v) => (v.variance_days ?? 0) > 0 && !v.done).length} open issues later than baseline ·{" "}
              {variance.data.filter((v) => v.done).length} done
            </p>
          )}
        </section>
      </div>
        </>
      )}
    </section>
  );
}
