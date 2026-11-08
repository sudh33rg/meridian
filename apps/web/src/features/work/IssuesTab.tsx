import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Layers, Plus, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { useToast } from "../shared/Toast";
import { KindIcon, KINDS, PRIORITIES, PriorityIcon } from "./meta";
import { errorMessage, request, send } from "../../lib/api";
import { loadIssues, type BulkResult, type SavedView } from "../../lib/issues";
import type { Issue } from "../../lib/types";
import { ImportPanel } from "./ImportPanel";

type Sort = "updated" | "priority" | "number";
type Group = "none" | "status" | "priority";
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const COLUMNS = 6;

export function IssuesTab() {
  const {
    issues,
    project,
    tab,
    search,
    setSearch,
    setSelectedIssue,
    move,
    setModal,
    loading,
    session,
    selected,
    statuses,
    statusLabel,
  } = useWorkspace();
  const token = session.token;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [group, setGroup] = useState<Group>("none");
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [viewId, setViewId] = useState("");
  // null: the name field is closed; a string: it is open with that draft.
  const [naming, setNaming] = useState<string | null>(null);

  const archivedQ = useQuery({
    queryKey: ["issues-archived", selected],
    queryFn: () => loadIssues(token, selected, true),
    enabled: showArchived && !!selected,
  });
  const viewsQ = useQuery({
    queryKey: ["views", selected],
    queryFn: () => request<SavedView[]>(token, `/projects/${selected}/views`),
    enabled: !!selected,
  });
  const views = viewsQ.data ?? [];

  const bulk = useMutation({
    mutationFn: (change: { action: string; value: string }) =>
      send<BulkResult>(`/projects/${selected}/issues/bulk`, token, "POST", {
        ids: [...picked],
        action: change.action,
        value: change.value,
      }),
    onSuccess: (r) => {
      const skipped = r.results.filter((x) => !x.ok).length;
      toast(`${r.updated} updated${skipped ? `, ${skipped} skipped (archived or not in this project)` : ""}`);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ["issues", selected] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (id: string) => send<void>(`/issues/${id}/unarchive`, token, "POST"),
    onSuccess: () => {
      toast("Issue restored");
      void qc.invalidateQueries({ queryKey: ["issues-archived", selected] });
      void qc.invalidateQueries({ queryKey: ["issues", selected] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const saveView = useMutation({
    mutationFn: (name: string) => {
      // The server stores status, priority and title search. Type and assignee filters are not part
      // of saved views yet.
      const filters: Record<string, string> = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (search.trim()) filters.q = search.trim();
      return send<SavedView>(`/projects/${selected}/views`, token, "POST", { name, filters });
    },
    onSuccess: (v) => {
      setViewId(v.id);
      setNaming(null);
      toast(`Saved view “${v.name}”`);
      void qc.invalidateQueries({ queryKey: ["views", selected] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const removeView = useMutation({
    mutationFn: (id: string) => send<void>(`/views/${id}`, token, "DELETE"),
    onSuccess: () => {
      setViewId("");
      toast("View deleted");
      void qc.invalidateQueries({ queryKey: ["views", selected] });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  // A query runs on the server against active issues and replaces the list until it is cleared.
  const queryResultsQ = useQuery({
    queryKey: ["issue-query", selected, activeQuery],
    queryFn: () =>
      request<Issue[]>(token, `/projects/${selected}/issues/search?query=${encodeURIComponent(activeQuery)}`),
    enabled: !!selected && !!activeQuery,
    retry: false,
  });
  const archivedItems = archivedQ.data;
  const source = useMemo(() => {
    if (activeQuery) return queryResultsQ.data ?? [];
    return showArchived ? (archivedItems ?? []) : issues;
  }, [activeQuery, queryResultsQ.data, showArchived, archivedItems, issues]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = source.filter(
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
  }, [source, search, status, priority, kind, sort]);

  if (tab !== "issues") return null;
  const filtering = !!(status || priority || kind || search);
  const allVisiblePicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const groups: { key: string; label: string; items: typeof rows }[] =
    group === "none"
      ? [{ key: "all", label: "", items: rows }]
      : (group === "status" ? statuses.map((s) => s.key) : [...PRIORITIES]).map((g) => ({
          key: g,
          label: group === "status" ? statusLabel(g) : g,
          items: rows.filter((i) => (group === "status" ? i.status : i.priority) === g),
        }));

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePageSelection = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (allVisiblePicked) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  const applyView = (id: string) => {
    setViewId(id);
    const v = views.find((x) => x.id === id);
    if (!v) return;
    setStatus(v.filters.status ?? "");
    setPriority(v.filters.priority ?? "");
    setSearch(v.filters.q ?? "");
  };

  const Chip = ({
    label,
    value,
    set,
    options,
    labelOf = (o: string) => o,
  }: {
    label: string;
    value: string;
    set: (v: string) => void;
    options: readonly string[];
    labelOf?: (v: string) => string;
  }) => (
    <label className={"filter-chip" + (value ? " on" : "")}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(o)}
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
        <form
          className="query-form"
          onSubmit={(e) => {
            e.preventDefault();
            setActiveQuery(queryText.trim());
          }}
        >
          <input
            aria-label="Issue query"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder='Query, e.g. status:in_progress priority:high -label:legacy cf.region:EU'
          />
          <button className="secondary" type="submit" disabled={!queryText.trim()}>
            Run
          </button>
          {activeQuery && (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setQueryText("");
                setActiveQuery("");
              }}
            >
              Clear query
            </button>
          )}
        </form>
        {queryResultsQ.error && (
          <p className="query-error" role="alert">
            {errorMessage(queryResultsQ.error)}
          </p>
        )}
        <div className="filters">
          <SlidersHorizontal size={15} className="muted" aria-hidden="true" />
          <Chip
            label="Status"
            value={status}
            set={setStatus}
            options={statuses.map((s) => s.key)}
            labelOf={statusLabel}
          />
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
                setViewId("");
              }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>
        <div className="view-opts">
          <label className="filter-chip">
            <Bookmark size={13} />
            <select aria-label="Saved view" value={viewId} onChange={(e) => applyView(e.target.value)}>
              <option value="">All issues</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {viewId && (
            <button className="secondary" onClick={() => removeView.mutate(viewId)}>
              Delete view
            </button>
          )}
          {naming === null ? (
            <button className="secondary" onClick={() => setNaming("")} disabled={!selected}>
              Save view
            </button>
          ) : (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const name = naming.trim();
                if (name) saveView.mutate(name);
              }}
            >
              <input
                aria-label="View name"
                autoFocus
                maxLength={80}
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                placeholder="View name"
              />
              <button className="primary" type="submit" disabled={!naming.trim()}>
                Save
              </button>
              <button className="secondary" type="button" onClick={() => setNaming(null)}>
                Cancel
              </button>
            </form>
          )}
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
          <button
            className="secondary"
            aria-expanded={importing}
            onClick={() => setImporting((v) => !v)}
            disabled={!selected}
          >
            Import CSV
          </button>
          <button
            className={showArchived ? "primary" : "secondary"}
            aria-pressed={showArchived}
            onClick={() => {
              setShowArchived((v) => !v);
              setPicked(new Set());
            }}
          >
            {showArchived ? "Showing archived" : "Show archived"}
          </button>
          <span className="muted small count-label">
            {rows.length} of {source.length}
          </span>
        </div>
      </div>
      {importing && <ImportPanel token={session.token} projectId={selected} />}
      {picked.size > 0 && !showArchived && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span>{picked.size} selected</span>
          <select
            aria-label="Set status for selected issues"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_status", value: e.target.value })}
          >
            <option value="">Set status…</option>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Set priority for selected issues"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_priority", value: e.target.value })}
          >
            <option value="">Set priority…</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="check-col">
                {!showArchived && (
                  <input
                    type="checkbox"
                    aria-label="Select all visible issues"
                    checked={allVisiblePicked}
                    disabled={rows.length === 0}
                    onChange={togglePageSelection}
                  />
                )}
              </th>
              <th scope="col">Issue</th>
              <th scope="col">Type</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(showArchived ? archivedQ.isLoading : loading) &&
              [0, 1, 2, 3].map((n) => (
                <tr key={n}>
                  <td colSpan={COLUMNS}>
                    <Skeleton h={14} />
                  </td>
                </tr>
              ))}
            {!(showArchived ? archivedQ.isLoading : loading) &&
              groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.label && (
                    <tr className="group-row">
                      <th colSpan={COLUMNS} scope="colgroup">
                        <span className="capitalize">{g.label}</span>{" "}
                        <span className="count">{g.items.length}</span>
                      </th>
                    </tr>
                  )}
                  {g.items.map((i) => (
                    <tr key={i.id} className="row-hover">
                      <td className="check-col">
                        {!showArchived && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${project?.key}-${i.number}`}
                            checked={picked.has(i.id)}
                            onChange={() => togglePicked(i.id)}
                          />
                        )}
                      </td>
                      <td>
                        <div className="cell-issue">
                          <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                            {project?.key}-{i.number}
                          </button>
                          <button className="issue-title-button" onClick={() => setSelectedIssue(i.id)}>
                            {i.title}
                          </button>
                          {showArchived && (
                            <button
                              className="secondary"
                              disabled={restore.isPending}
                              onClick={() => restore.mutate(i.id)}
                            >
                              <RotateCcw size={13} /> Restore
                            </button>
                          )}
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
                          disabled={showArchived}
                          onChange={(e) => move(i, e.target.value)}
                        >
                          {statuses.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.name}
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
        {!(showArchived ? archivedQ.isLoading : loading) && !rows.length && (
          <div className="panel-empty center">
            <p>
              {showArchived
                ? "No archived issues."
                : filtering
                  ? "No issues match these filters."
                  : "No issues yet."}
            </p>
            {!filtering && !showArchived && (
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
