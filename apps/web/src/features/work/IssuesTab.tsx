import React, { useMemo, useState } from "react";
import { Layers, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { KindIcon, KINDS, PRIORITIES, PriorityIcon, STATUSES, STATUS_LABEL } from "./meta";

type Sort = "updated" | "priority" | "number";
type Group = "none" | "status" | "priority";
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function IssuesTab() {
  const { issues, project, tab, search, setSearch, setSelectedIssue, move, setModal, loading } =
    useWorkspace();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [group, setGroup] = useState<Group>("none");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = issues.filter(
      (i) =>
        (!status || i.status === status) &&
        (!priority || i.priority === priority) &&
        (!kind || i.kind === kind) &&
        (!q || (i.title + " " + i.kind + " " + i.number).toLowerCase().includes(q)),
    );
    return [...list].sort((a, b) =>
      sort === "priority"
        ? (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9)
        : sort === "number"
          ? a.number - b.number
          : +new Date(b.updated_at) - +new Date(a.updated_at),
    );
  }, [issues, search, status, priority, kind, sort]);

  if (tab !== "issues") return null;
  const filtering = !!(status || priority || kind || search);
  const groups: { key: string; label: string; items: typeof rows }[] =
    group === "none"
      ? [{ key: "all", label: "", items: rows }]
      : (group === "status" ? [...STATUSES] : [...PRIORITIES]).map((g) => ({
          key: g,
          label: group === "status" ? STATUS_LABEL[g] : g,
          items: rows.filter((i) => (group === "status" ? i.status : i.priority) === g),
        }));

  const Chip = ({
    label,
    value,
    set,
    options,
  }: {
    label: string;
    value: string;
    set: (v: string) => void;
    options: readonly string[];
  }) => (
    <label className={"filter-chip" + (value ? " on" : "")}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {STATUS_LABEL[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="panel">
      <div className="list-toolbar">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Filter issues"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter issues…"
          />
        </div>
        <div className="filters">
          <SlidersHorizontal size={15} className="muted" aria-hidden="true" />
          <Chip label="Status" value={status} set={setStatus} options={STATUSES} />
          <Chip label="Priority" value={priority} set={setPriority} options={PRIORITIES} />
          <Chip label="Type" value={kind} set={setKind} options={KINDS} />
          {filtering && (
            <button
              className="clear-filters"
              onClick={() => {
                setStatus("");
                setPriority("");
                setKind("");
                setSearch("");
              }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>
        <div className="view-opts">
          <label className="filter-chip">
            <span>Sort</span>
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="updated">Recently updated</option>
              <option value="priority">Priority</option>
              <option value="number">Number</option>
            </select>
          </label>
          <label className="filter-chip">
            <Layers size={13} />
            <select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
              <option value="none">No grouping</option>
              <option value="status">Group: status</option>
              <option value="priority">Group: priority</option>
            </select>
          </label>
          <span className="muted small count-label">
            {rows.length} of {issues.length}
          </span>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Issue</th>
              <th scope="col">Type</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              [0, 1, 2, 3].map((n) => (
                <tr key={n}>
                  <td colSpan={5}>
                    <Skeleton h={14} />
                  </td>
                </tr>
              ))}
            {!loading &&
              groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.label && (
                    <tr className="group-row">
                      <th colSpan={5} scope="colgroup">
                        <span className="capitalize">{g.label}</span>{" "}
                        <span className="count">{g.items.length}</span>
                      </th>
                    </tr>
                  )}
                  {g.items.map((i) => (
                    <tr key={i.id} className="row-hover">
                      <td>
                        <div className="cell-issue">
                          <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                            {project?.key}-{i.number}
                          </button>
                          <button className="issue-title-button" onClick={() => setSelectedIssue(i.id)}>
                            {i.title}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="cell-kind capitalize">
                          <KindIcon kind={i.kind} /> {i.kind}
                        </span>
                      </td>
                      <td>
                        <PriorityIcon priority={i.priority} />
                      </td>
                      <td>
                        <select
                          className={"status-select " + i.status}
                          aria-label={`Status of ${project?.key}-${i.number}`}
                          value={i.status}
                          onChange={(e) => move(i, e.target.value)}
                        >
                          {STATUSES.map((x) => (
                            <option key={x} value={x}>
                              {STATUS_LABEL[x]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{new Date(i.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
          </tbody>
        </table>
        {!loading && !rows.length && (
          <div className="panel-empty center">
            <p>{filtering ? "No issues match these filters." : "No issues yet."}</p>
            {!filtering && (
              <button className="primary" onClick={() => setModal("issue")}>
                <Plus size={15} /> New issue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
