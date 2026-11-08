import React, { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { KindIcon, PriorityIcon } from "./meta";
import { WorkflowEditor } from "./WorkflowEditor";

export function BoardTab() {
  const { issues, project, tab, setModal, setSelectedIssue, move, loading, statuses, statusLabel, session, selected } =
    useWorkspace();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (tab !== "board") return null;
  const keys = statuses.map((s) => s.key);
  const step = (status: string, dir: -1 | 1) => keys[keys.indexOf(status) + dir];
  return (
    <div className="board">
      <div className="board-toolbar">
        <span className="board-title">
          <span className="project-icon sm">{project?.key.slice(0, 2)}</span> {project?.name}
        </span>
        <span className="muted small hide-sm">
          Drag cards between columns, or focus a card and press Alt + ← / →
        </span>
        <button
          className="secondary"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          disabled={!selected}
        >
          <Settings2 size={15} /> Workflow
        </button>
        <button className="secondary" onClick={() => setModal("issue")}>
          <Plus size={15} /> Add issue
        </button>
      </div>
      {editing && <WorkflowEditor token={session.token} projectId={selected} statuses={statuses} />}
      <div className="columns">
        {statuses.map((status, index) => {
          const list = issues.filter((i) => i.status === status.key);
          return (
            <section
              className={"column" + (over === status.key ? " drop" : "")}
              key={status.key}
              aria-label={status.name}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== status.key) setOver(status.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const issue = issues.find((i) => i.id === (dragId ?? e.dataTransfer.getData("text/plain")));
                setOver(null);
                setDragId(null);
                if (issue) move(issue, status.key);
              }}
            >
              <div className="column-title">
                <span className={"column-dot dot-" + Math.min(index, 3)} />
                <b>{status.name}</b>
                <span className="count">{list.length}</span>
              </div>
              {loading &&
                [0, 1].map((n) => (
                  <div className="issue-card" key={n}>
                    <Skeleton w="40%" h={10} />
                    <Skeleton h={12} />
                  </div>
                ))}
              {list.map((i) => (
                <article
                  className={"issue-card" + (dragId === i.id ? " dragging" : "")}
                  key={i.id}
                  draggable
                  tabIndex={0}
                  aria-label={`${project?.key}-${i.number} ${i.title}, ${statusLabel(i.status)}`}
                  onDragStart={(e) => {
                    setDragId(i.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", i.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) setSelectedIssue(i.id);
                    if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
                      e.preventDefault();
                      const to = step(i.status, e.key === "ArrowRight" ? 1 : -1);
                      if (to) move(i, to);
                    }
                  }}
                >
                  <div className="issue-top">
                    <KindIcon kind={i.kind} />
                    <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                      {project?.key}-{i.number}
                    </button>
                    <PriorityIcon priority={i.priority} label={false} />
                  </div>
                  <h4>{i.title}</h4>
                  <div className="issue-foot">
                    <PriorityIcon priority={i.priority} />
                    <select
                      aria-label="Move issue"
                      value={i.status}
                      onChange={(e) => move(i, e.target.value)}
                    >
                      {statuses.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
              {!loading && !list.length && <div className="column-empty">Drop issues here</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
