import React from "react";
import { BookOpen, ArrowUpRight, CheckCircle2, Clock3, ListTodo, FileText } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function OverviewTab() {
  const { issues, pages, project, tab, setTab, setActivePage } = useWorkspace();
  return (
    <>
      {tab === "overview" && (
        <>
          <div className="metrics">
            <div className="metric">
              <span>
                Total issues <ListTodo size={17} />
              </span>
              <strong>{issues.length}</strong>
              <small>Across {project?.name}</small>
            </div>
            <div className="metric">
              <span>
                In progress <Clock3 size={17} />
              </span>
              <strong>{issues.filter((i) => i.status === "in_progress").length}</strong>
              <small>Currently moving</small>
            </div>
            <div className="metric">
              <span>
                Completed <CheckCircle2 size={17} />
              </span>
              <strong>{issues.filter((i) => i.status === "done").length}</strong>
              <small>Work delivered</small>
            </div>
            <div className="metric">
              <span>
                Knowledge pages <BookOpen size={17} />
              </span>
              <strong>{pages.length}</strong>
              <small>Shared with your team</small>
            </div>
          </div>
          <div className="section-grid">
            <div className="panel">
              <div className="panel-head">
                <h3>Recent work</h3>
                <button onClick={() => setTab("issues")}>
                  View all <ArrowUpRight size={15} />
                </button>
              </div>
              {issues.slice(0, 6).map((i) => (
                <div className="work-row" key={i.id}>
                  <span className={"kind-icon " + i.kind}>{i.kind === "bug" ? "!" : "✓"}</span>
                  <div>
                    <b>{i.title}</b>
                    <small>
                      {project?.key}-{i.number} · {i.kind}
                    </small>
                  </div>
                  <span className={"status " + i.status}>{i.status.replace("_", " ")}</span>
                </div>
              ))}
              {!issues.length && <div className="panel-empty">No work yet. Create your first issue.</div>}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h3>Team knowledge</h3>
                <button onClick={() => setTab("knowledge")}>
                  Explore <ArrowUpRight size={15} />
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
                  <FileText size={18} />
                  <span>
                    <b>{p.title}</b>
                    <small>
                      Version {p.version} · Updated {new Date(p.updated_at).toLocaleDateString()}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {!pages.length && (
                <div className="panel-empty">Capture project decisions, notes, and documentation.</div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
