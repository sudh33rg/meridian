import { formatDate } from "../../lib/datetime";
import React from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  ListTodo,
  Plus,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { KindIcon, StatusPill } from "./meta";
import { statusClass, type ProjectStatus } from "../../lib/statuses";

function Ring({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width="58"
      height="58"
      viewBox="0 0 58 58"
      role="img"
      aria-label={`${pct}% complete`}
      className="ring"
    >
      <circle cx="29" cy="29" r={r} className="ring-bg" />
      <circle
        cx="29"
        cy="29"
        r={r}
        className="ring-fg"
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
        transform="rotate(-90 29 29)"
      />
      <text x="29" y="33" textAnchor="middle" className="ring-text">
        {pct}%
      </text>
    </svg>
  );
}

export function OverviewTab() {
  const { issues, pages, project, tab, setTab, setActivePage, setModal, loading, statuses } = useWorkspace();
  if (tab !== "overview") return null;
  // Counts follow each status's category, so a custom status behaves like the built-in one it matches.
  const categoryOf = (key: string) => statuses.find((s) => s.key === key)?.category;
  const done = issues.filter((i) => categoryOf(i.status) === "done").length;
  const inProg = issues.filter((i) => categoryOf(i.status) === "in_progress").length;
  const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;
  const steps = [
    { label: "Create a project", done: !!project, run: () => setModal("project") },
    { label: "Add your first issue", done: issues.length > 0, run: () => setModal("issue") },
    {
      label: "Move an issue forward",
      done: issues.some((i) => i.status !== "todo"),
      run: () => setTab("board"),
    },
    { label: "Write a knowledge page", done: pages.length > 0, run: () => setModal("page") },
    { label: "Invite a teammate", done: false, run: () => setTab("people") },
  ];
  const finished = steps.filter((s) => s.done).length;
  return (
    <>
      <div className="metrics">
        <div className="metric">
          <span>
            Total issues <ListTodo size={16} />
          </span>
          {loading ? <Skeleton w={60} h={30} /> : <strong>{issues.length}</strong>}
          <small>Across {project?.name}</small>
        </div>
        <div className="metric">
          <span>
            In progress <Clock3 size={16} />
          </span>
          {loading ? <Skeleton w={60} h={30} /> : <strong>{inProg}</strong>}
          <small>Currently moving</small>
        </div>
        <div className="metric metric-ring">
          <div>
            <span>
              Completed <CheckCircle2 size={16} />
            </span>
            {loading ? <Skeleton w={60} h={30} /> : <strong>{done}</strong>}
            <small>Work delivered</small>
          </div>
          <Ring pct={pct} />
        </div>
        <div className="metric">
          <span>
            Knowledge pages <BookOpen size={16} />
          </span>
          {loading ? <Skeleton w={60} h={30} /> : <strong>{pages.length}</strong>}
          <small>Shared with your team</small>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="panel breakdown">
          <div className="panel-head">
            <h3>Status breakdown</h3>
            <span className="muted small">{issues.length} issues</span>
          </div>
          <div className="stack-bar" role="img" aria-label="Issues by status">
            {statuses.map((s: ProjectStatus) => {
              const n = issues.filter((i) => i.status === s.key).length;
              return n ? (
                <i
                  key={s.key}
                  className={"seg-" + statusClass(s)}
                  style={{ flex: n }}
                  title={`${s.name}: ${n}`}
                />
              ) : null;
            })}
          </div>
          <div className="legend">
            {statuses.map((s: ProjectStatus) => (
              <span key={s.key}>
                <i className={"seg-" + statusClass(s)} /> {s.name}{" "}
                <b>{issues.filter((i) => i.status === s.key).length}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {finished < steps.length && (
        <div className="panel onboarding">
          <div className="panel-head">
            <h3>
              <Sparkles size={15} /> Getting started
            </h3>
            <span className="muted small">
              {finished} of {steps.length} done
            </span>
          </div>
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${(finished / steps.length) * 100}%` }} />
          </div>
          <ul className="checklist">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? "done" : ""}>
                <button onClick={s.run} disabled={s.done}>
                  {s.done ? <Check size={15} /> : <Circle size={15} />}
                  <span>{s.label}</span>
                  {!s.done && <ArrowUpRight size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Recent work</h3>
            <button onClick={() => setTab("issues")}>
              View all <ArrowUpRight size={14} />
            </button>
          </div>
          {loading &&
            [0, 1, 2].map((n) => (
              <div className="work-row" key={n}>
                <Skeleton w={28} h={28} r={7} />
                <div>
                  <Skeleton w="60%" h={12} />
                </div>
              </div>
            ))}
          {!loading &&
            issues.slice(0, 6).map((i) => (
              <div className="work-row" key={i.id}>
                <KindIcon kind={i.kind} />
                <div>
                  <b>{i.title}</b>
                  <small>
                    {project?.key}-{i.number} · {i.kind}
                  </small>
                </div>
                <StatusPill status={i.status} />
              </div>
            ))}
          {!loading && !issues.length && (
            <div className="panel-empty">
              <p>No work yet.</p>
              <button className="primary" onClick={() => setModal("issue")}>
                <Plus size={15} /> Create your first issue
              </button>
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Team knowledge</h3>
            <button onClick={() => setTab("knowledge")}>
              Explore <ArrowUpRight size={14} />
            </button>
          </div>
          {pages.slice(0, 5).map((p) => (
            <button
              key={p.id}
              className="doc-row"
              onClick={() => {
                setTab("knowledge");
                setActivePage(p);
              }}
            >
              <FileText size={17} />
              <span>
                <b>{p.title}</b>
                <small>
                  Version {p.version} · Updated {formatDate(p.updated_at)}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!loading && !pages.length && (
            <div className="panel-empty">
              <p>Capture project decisions, notes, and documentation.</p>
              <button className="secondary" onClick={() => setModal("page")}>
                <Plus size={15} /> New page
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
