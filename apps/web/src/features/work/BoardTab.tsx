import React from "react";
import { Plus, KanbanSquare, Flag } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function BoardTab() {
  const { issues, project, tab, setModal, setSelectedIssue, move } = useWorkspace();
  return (
    <>
      {tab === "board" && (
        <div className="board">
          <div className="board-toolbar">
            <span>
              <KanbanSquare size={17} /> {project?.name}
            </span>
            <button className="secondary" onClick={() => setModal("issue")}>
              <Plus size={15} /> Add issue
            </button>
          </div>
          <div className="columns">
            {(["todo", "in_progress", "in_review", "done"] as const).map((status, index) => (
              <div className="column" key={status}>
                <div className="column-title">
                  <span className={"column-dot dot-" + index} />
                  <b>
                    {status === "todo"
                      ? "To do"
                      : status === "in_progress"
                        ? "In progress"
                        : status === "in_review"
                          ? "In review"
                          : "Done"}
                  </b>
                  <span className="count">{issues.filter((i) => i.status === status).length}</span>
                </div>
                {issues
                  .filter((i) => i.status === status)
                  .map((i) => (
                    <article className="issue-card" key={i.id}>
                      <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                        {project?.key}-{i.number}
                      </button>
                      <h4>{i.title}</h4>
                      <div className="issue-foot">
                        <span className={"priority priority-" + i.priority}>
                          <Flag size={13} /> {i.priority}
                        </span>
                        <select
                          aria-label="Move issue"
                          value={i.status}
                          onChange={(e) => move(i, e.target.value)}
                        >
                          {["todo", "in_progress", "in_review", "done"].map((x) => (
                            <option key={x} value={x}>
                              {x.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}
                {!issues.some((i) => i.status === status) && (
                  <div className="column-empty">No issues here</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
