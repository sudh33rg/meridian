import React from "react";
import { Search, Flag } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function IssuesTab() {
  const { filtered, project, tab, search, setSearch, setSelectedIssue, move } = useWorkspace();
  return (
    <>
      {tab === "issues" && (
        <div className="panel">
          <div className="list-toolbar">
            <div className="search">
              <Search size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search issues…"
              />
            </div>
            <span>{filtered.length} issues</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                        {project?.key}-{i.number}
                      </button>
                      <button className="issue-title-button" onClick={() => setSelectedIssue(i.id)}>
                        {i.title}
                      </button>
                    </td>
                    <td className="capitalize">{i.kind}</td>
                    <td>
                      <span className={"priority priority-" + i.priority}>
                        <Flag size={13} />
                        {i.priority}
                      </span>
                    </td>
                    <td>
                      <select value={i.status} onChange={(e) => move(i, e.target.value)}>
                        {["todo", "in_progress", "in_review", "done"].map((x) => (
                          <option key={x} value={x}>
                            {x.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{new Date(i.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <div className="panel-empty">No matching issues.</div>}
          </div>
        </div>
      )}
    </>
  );
}
