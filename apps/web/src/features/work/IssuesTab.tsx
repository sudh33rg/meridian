import { formatDate } from "../../lib/datetime";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Layers, Plus, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { useToast } from "../shared/Toast";
import { KindIcon, PRIORITIES, PriorityIcon } from "./meta";
import { typeName } from "../../lib/issue-types";
import { errorMessage, request, send } from "../../lib/api";
import { loadIssues, type BulkResult, type SavedView } from "../../lib/issues";
import type { Issue, IssueRef } from "../../lib/types";
import { ImportPanel } from "./ImportPanel";
import { type Release, type Sprint, isOpenSprint, useTeams } from "../agile/agile-shared";

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
    issueTypes,
    me,
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
  // Whether a view being saved is shared with everyone who can see the project.
  const [sharedDraft, setSharedDraft] = useState(false);

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
  // Favourites and recently opened issues are this member's own lists for the project.
  const favouritesQ = useQuery({
    queryKey: ["favourites", selected],
    queryFn: () => request<IssueRef[]>(token, `/projects/${selected}/favourites`),
    enabled: !!selected,
  });
  const recentQ = useQuery({
    queryKey: ["recent", selected],
    queryFn: () => request<IssueRef[]>(token, `/projects/${selected}/recent`),
    enabled: !!selected,
  });

  const bulkOpen = picked.size > 0 && !showArchived;
  const bulkTeams = useTeams(token, bulkOpen);
  const bulkSprints = useQuery({
    queryKey: ["sprints", selected],
    queryFn: () => request<Sprint[]>(token, `/projects/${selected}/sprints`),
    enabled: bulkOpen,
  });
  const bulkReleases = useQuery({
    queryKey: ["releases", selected],
    queryFn: () => request<Release[]>(token, `/projects/${selected}/releases`),
    enabled: bulkOpen,
  });
  const bulkMembers = useQuery({
    queryKey: ["members"],
    queryFn: () => request<{ id: string; name: string }[]>(token, "/members"),
    enabled: bulkOpen,
  });
  const [bulkLabel, setBulkLabel] = useState("");

  const bulk = useMutation({
    mutationFn: (change: { action: string; value: string }) =>
      send<BulkResult>(`/projects/${selected}/issues/bulk`, token, "POST", {
        ids: [...picked],
        action: change.action,
        value: change.value,
      }),
    onSuccess: (r) => {
      const refused = r.results.filter((x) => !x.ok);
      const reason = refused[0]?.error ? `: ${refused[0].error}` : "";
      toast(`${r.updated} updated${refused.length ? `, ${refused.length} skipped${reason}` : ""}`);
      void qc.invalidateQueries({ queryKey: ["backlog", selected] });
      void qc.invalidateQueries({ queryKey: ["sprints", selected] });
      void qc.invalidateQueries({ queryKey: ["releases", selected] });
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
    mutationFn: ({ name, shared }: { name: string; shared: boolean }) => {
      const filters: Record<string, string> = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (search.trim()) filters.q = search.trim();
      if (kind) filters.kind = kind;
      if (activeQuery) filters.query = activeQuery;
      return send<SavedView>(`/projects/${selected}/views`, token, "POST", { name, filters, shared });
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
    setKind(v.filters.kind ?? "");
    setSearch(v.filters.q ?? "");
    setQueryText(v.filters.query ?? "");
    setActiveQuery(v.filters.query ?? "");
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
    <label
      className={`filter-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer select-none ${
        value
          ? "bg-accent/10 border-accent/40 text-accent font-medium shadow-xs"
          : "bg-surface border-border text-text-subtle hover:text-text-main hover:border-border-strong"
      }`}
    >
      <span className="text-[11px] uppercase tracking-wider font-semibold opacity-75">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="bg-transparent text-inherit text-xs font-medium focus:outline-none cursor-pointer border-none p-0 pr-1"
      >
        <option value="" className="bg-surface text-text-main">
          Any
        </option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-surface text-text-main">
            {labelOf(o)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="panel bg-surface rounded-2xl border border-border p-4 sm:p-6 shadow-sm space-y-4">
      <div className="list-toolbar space-y-3">
        {/* Search and Advanced Query Form */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="search relative flex-1 min-w-[220px]">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
            />
            <input
              aria-label="Filter issues"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter issues…"
              className="w-full pl-9 pr-4 py-2 bg-bg border border-border rounded-xl text-sm text-text-main placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
            />
          </div>
          <form
            className="query-form flex items-center gap-2 flex-1 lg:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveQuery(queryText.trim());
            }}
          >
            <input
              aria-label="Issue query"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Query: status:in_progress priority:high -label:legacy…"
              className="w-full px-3.5 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
            />
            <button
              className="secondary shrink-0 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors disabled:opacity-40"
              type="submit"
              disabled={!queryText.trim()}
            >
              Run
            </button>
            {activeQuery && (
              <button
                className="secondary shrink-0 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors"
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
        </div>

        {queryResultsQ.error && (
          <p
            className="query-error text-xs text-danger bg-danger/10 p-2.5 rounded-lg border border-danger/20"
            role="alert"
          >
            {errorMessage(queryResultsQ.error)}
          </p>
        )}

        {/* Filter bar */}
        <div className="filters flex flex-wrap items-center gap-2 pt-1 pb-1">
          <div className="flex items-center gap-1 text-text-subtle mr-1 text-xs font-medium">
            <SlidersHorizontal size={14} className="muted" aria-hidden="true" />
            <span className="hidden sm:inline">Filters:</span>
          </div>
          <Chip
            label="Status"
            value={status}
            set={setStatus}
            options={statuses.map((s) => s.key)}
            labelOf={statusLabel}
          />
          <Chip label="Priority" value={priority} set={setPriority} options={PRIORITIES} />
          <Chip
            label="Type"
            value={kind}
            set={setKind}
            options={issueTypes.map((t) => t.key)}
            labelOf={(k) => typeName(issueTypes, k)}
          />
          {filtering && (
            <button
              className="clear-filters inline-flex items-center gap-1 px-2.5 py-1 text-xs text-danger hover:bg-danger/10 rounded-lg transition-colors font-medium ml-auto sm:ml-0"
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

        {/* Favourites & Recent */}
        {((favouritesQ.data?.length ?? 0) > 0 || (recentQ.data?.length ?? 0) > 0) && (
          <div
            className="quick-issues flex flex-col sm:flex-row gap-2 py-1 border-t border-border/40 text-xs"
            aria-label="Favourites and recent issues"
          >
            {(favouritesQ.data?.length ?? 0) > 0 && (
              <div className="quick-issues-row flex flex-wrap items-center gap-1.5">
                <span className="muted small font-medium text-text-subtle">Favourites:</span>
                {favouritesQ.data?.map((i) => (
                  <button
                    key={i.id}
                    className="chip-button text-xs px-2 py-0.5 bg-surface-2 hover:bg-accent/10 hover:text-accent rounded-md border border-border/70 text-text-muted transition-colors max-w-[200px] truncate"
                    onClick={() => setSelectedIssue(i.id)}
                  >
                    {project?.key}-{i.number} {i.title}
                  </button>
                ))}
              </div>
            )}
            {(recentQ.data?.length ?? 0) > 0 && (
              <div className="quick-issues-row flex flex-wrap items-center gap-1.5">
                <span className="muted small font-medium text-text-subtle">Recent:</span>
                {recentQ.data?.map((i) => (
                  <button
                    key={i.id}
                    className="chip-button text-xs px-2 py-0.5 bg-surface-2 hover:bg-accent/10 hover:text-accent rounded-md border border-border/70 text-text-muted transition-colors max-w-[200px] truncate"
                    onClick={() => setSelectedIssue(i.id)}
                  >
                    {project?.key}-{i.number} {i.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Views and layout bar */}
        <div className="view-opts flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          <label className="filter-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border bg-surface text-text-main">
            <Bookmark size={13} className="text-text-subtle" />
            <select
              aria-label="Saved view"
              value={viewId}
              onChange={(e) => applyView(e.target.value)}
              className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="">All issues</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.stale
                    ? `${v.name} (stale)`
                    : v.owner_id !== me?.user_id
                      ? `${v.name} · shared by ${v.owner}`
                      : v.name}
                </option>
              ))}
            </select>
            {views.find((v) => v.id === viewId)?.stale && (
              <span className="query-error text-[10px] text-danger" role="status">
                (stale)
              </span>
            )}
          </label>

          {viewId && <ViewSubscribe token={token} viewId={viewId} />}

          {viewId && views.find((v) => v.id === viewId)?.owner_id === me?.user_id && (
            <button
              className="secondary px-2.5 py-1 text-xs bg-surface-2 hover:bg-danger/10 hover:text-danger rounded-lg border border-border transition-colors"
              onClick={() => removeView.mutate(viewId)}
            >
              Delete view
            </button>
          )}

          {naming === null ? (
            <button
              className="secondary px-2.5 py-1 text-xs bg-surface-2 hover:bg-surface-3 rounded-lg border border-border text-text-main transition-colors disabled:opacity-40"
              onClick={() => setNaming("")}
              disabled={!selected}
            >
              Save view
            </button>
          ) : (
            <form
              className="inline-form flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = naming.trim();
                if (name) saveView.mutate({ name, shared: sharedDraft });
              }}
            >
              <input
                aria-label="View name"
                autoFocus
                maxLength={80}
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                placeholder="View name"
                className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <label className="filter-chip inline-flex items-center gap-1.5 text-xs text-text-subtle">
                <input
                  type="checkbox"
                  checked={sharedDraft}
                  onChange={(e) => setSharedDraft(e.target.checked)}
                  className="rounded text-accent focus:ring-accent"
                />
                <span>Share with project</span>
              </label>
              <button
                className="primary px-3 py-1 bg-accent text-white hover:bg-accent-strong rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                type="submit"
                disabled={!naming.trim()}
              >
                Save
              </button>
              <button
                className="secondary px-2.5 py-1 bg-surface-2 hover:bg-surface-3 rounded-lg border border-border text-xs text-text-main transition-colors"
                type="button"
                onClick={() => setNaming(null)}
              >
                Cancel
              </button>
            </form>
          )}

          <div className="h-4 w-px bg-border hidden sm:block mx-0.5" />

          <label className="filter-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border bg-surface text-text-main">
            <span className="text-text-subtle text-[11px] font-semibold uppercase">Sort</span>
            <select
              aria-label="Sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="updated">Recently updated</option>
              <option value="priority">Priority</option>
              <option value="number">Number</option>
            </select>
          </label>

          <label className="filter-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border bg-surface text-text-main">
            <Layers size={13} className="text-text-subtle" />
            <select
              aria-label="Group by"
              value={group}
              onChange={(e) => setGroup(e.target.value as Group)}
              className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="none">No grouping</option>
              <option value="status">Group: status</option>
              <option value="priority">Group: priority</option>
            </select>
          </label>

          <button
            className="secondary px-2.5 py-1 text-xs bg-surface-2 hover:bg-surface-3 rounded-lg border border-border text-text-main transition-colors disabled:opacity-40"
            aria-expanded={importing}
            onClick={() => setImporting((v) => !v)}
            disabled={!selected}
          >
            Import CSV
          </button>

          <button
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              showArchived
                ? "primary bg-accent text-white border-accent font-medium shadow-xs"
                : "secondary bg-surface-2 hover:bg-surface-3 border-border text-text-main"
            }`}
            aria-pressed={showArchived}
            onClick={() => {
              setShowArchived((v) => !v);
              setPicked(new Set());
            }}
          >
            {showArchived ? "Showing archived" : "Show archived"}
          </button>

          <span className="muted small count-label text-xs text-text-subtle ml-auto font-medium">
            {rows.length} of {source.length}
          </span>
        </div>
      </div>

      {importing && <ImportPanel token={session.token} projectId={selected} />}

      {/* Bulk actions banner */}
      {picked.size > 0 && !showArchived && (
        <div
          className="bulk-bar flex flex-wrap items-center gap-2 p-3 bg-surface-2 border border-accent/30 rounded-xl shadow-sm text-xs"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="font-semibold text-accent px-1.5 py-0.5 bg-accent/10 rounded-md">
            {picked.size} selected
          </span>
          <select
            aria-label="Set status for selected issues"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_status", value: e.target.value })}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
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
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Set priority…</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            aria-label="Move selected issues to team"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_team", value: e.target.value })}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Set team…</option>
            <option value="none">No team</option>
            {(bulkTeams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Move selected issues to sprint"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_sprint", value: e.target.value })}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Set sprint…</option>
            <option value="none">No sprint</option>
            {(bulkSprints.data ?? []).filter(isOpenSprint).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Add selected issues to release"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "set_release", value: e.target.value })}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Add to release…</option>
            {(bulkReleases.data ?? [])
              .filter((r) => r.status === "planned")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Add a watcher to selected issues"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ action: "add_watcher", value: e.target.value })}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Add watcher…</option>
            {(bulkMembers.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <form
            className="bulk-label flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const v = bulkLabel.trim();
              if (v) bulk.mutate({ action: "add_label", value: v });
            }}
          >
            <input
              aria-label="Label for selected issues"
              value={bulkLabel}
              maxLength={40}
              placeholder="Label"
              onChange={(e) => setBulkLabel(e.target.value)}
              className="px-2 py-1 text-xs bg-surface border border-border rounded-lg text-text-main w-24 sm:w-28 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              className="secondary px-2 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors disabled:opacity-40"
              type="submit"
              disabled={bulk.isPending || !bulkLabel.trim()}
            >
              Add label
            </button>
            <button
              className="secondary px-2 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors disabled:opacity-40"
              type="button"
              disabled={bulk.isPending || !bulkLabel.trim()}
              onClick={() => bulk.mutate({ action: "remove_label", value: bulkLabel.trim() })}
            >
              Remove
            </button>
          </form>
          <button
            className="secondary ml-auto px-2 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors"
            onClick={() => setPicked(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Responsive table container */}
      <div className="table-scroll overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-text-subtle font-semibold text-[11px] uppercase tracking-wider">
              <th scope="col" className="check-col w-10 px-3 py-3 text-center">
                {!showArchived && (
                  <input
                    type="checkbox"
                    aria-label="Select all visible issues"
                    checked={allVisiblePicked}
                    disabled={rows.length === 0}
                    onChange={togglePageSelection}
                    className="rounded text-accent focus:ring-accent"
                  />
                )}
              </th>
              <th scope="col" className="px-4 py-3 min-w-[200px]">
                Issue
              </th>
              <th scope="col" className="px-3 py-3 min-w-[90px]">
                Type
              </th>
              <th scope="col" className="px-3 py-3 min-w-[80px]">
                Priority
              </th>
              <th scope="col" className="px-3 py-3 min-w-[120px]">
                Status
              </th>
              <th scope="col" className="px-4 py-3 min-w-[100px] text-right">
                Updated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {(showArchived ? archivedQ.isLoading : loading) &&
              [0, 1, 2, 3].map((n) => (
                <tr key={n}>
                  <td colSpan={COLUMNS} className="p-4">
                    <Skeleton h={14} />
                  </td>
                </tr>
              ))}
            {!(showArchived ? archivedQ.isLoading : loading) &&
              groups.map((g) => (
                <React.Fragment key={g.key}>
                  {g.label && (
                    <tr className="group-row bg-surface-2/60 border-t border-border">
                      <th
                        colSpan={COLUMNS}
                        scope="colgroup"
                        className="px-4 py-2 text-xs font-semibold text-text-subtle"
                      >
                        <span className="capitalize">{g.label}</span>{" "}
                        <span className="count ml-1.5 px-2 py-0.5 bg-surface border border-border/70 rounded-full text-[10px] text-text-muted">
                          {g.items.length}
                        </span>
                      </th>
                    </tr>
                  )}
                  {g.items.map((i) => (
                    <tr key={i.id} className="row-hover hover:bg-surface-2 transition-colors group">
                      <td className="check-col w-10 px-3 py-3 text-center">
                        {!showArchived && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${project?.key}-${i.number}`}
                            checked={picked.has(i.id)}
                            onChange={() => togglePicked(i.id)}
                            className="rounded text-accent focus:ring-accent"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="cell-issue flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
                          <button
                            className="issue-number-button shrink-0 font-bold text-accent hover:underline font-mono text-xs px-1.5 py-0.5 rounded bg-accent/10"
                            onClick={() => setSelectedIssue(i.id)}
                          >
                            {project?.key}-{i.number}
                          </button>
                          <button
                            className="issue-title-button font-medium text-text-main hover:text-accent text-left transition-colors truncate max-w-sm sm:max-w-md"
                            onClick={() => setSelectedIssue(i.id)}
                          >
                            {i.title}
                          </button>
                          {showArchived && (
                            <button
                              className="secondary ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-surface-2 hover:bg-surface-3 rounded border border-border text-xs text-text-main"
                              disabled={restore.isPending}
                              onClick={() => restore.mutate(i.id)}
                            >
                              <RotateCcw size={12} /> Restore
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="cell-kind capitalize inline-flex items-center gap-1.5 text-xs text-text-muted">
                          <KindIcon kind={i.kind} /> {i.kind}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <PriorityIcon priority={i.priority} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <select
                          className={`status-select ${i.status} text-xs font-medium px-2 py-1 rounded-lg border border-border bg-surface text-text-main focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer`}
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
                      <td className="px-4 py-3 text-right text-xs text-text-subtle whitespace-nowrap font-mono">
                        {formatDate(i.updated_at)}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
          </tbody>
        </table>

        {!(showArchived ? archivedQ.isLoading : loading) && !rows.length && (
          <div className="panel-empty center py-12 px-4 text-center space-y-3">
            <p className="text-sm text-text-subtle">
              {showArchived
                ? "No archived issues."
                : filtering
                  ? "No issues match these filters."
                  : "No issues yet."}
            </p>
            {!filtering && !showArchived && (
              <button
                className="primary inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
                onClick={() => setModal("issue")}
              >
                <Plus size={15} /> New issue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Subscribe to a saved view: a daily or weekly inbox notification with the matching issues. */
function ViewSubscribe({ token, viewId }: { token: string; viewId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sub = useQuery({
    queryKey: ["view-subscription", viewId],
    queryFn: () =>
      request<{ cadence: string; next_run_at: string; last_sent_at?: string | null } | null>(
        token,
        `/views/${viewId}/subscription`,
      ),
  });
  const change = useMutation({
    mutationFn: (cadence: string) => send(`/views/${viewId}/subscription`, token, "PUT", { cadence }),
    onSuccess: (_r, cadence) => {
      toast(cadence === "off" ? "Subscription removed" : `Subscribed: ${cadence} update`);
      void qc.invalidateQueries({ queryKey: ["view-subscription", viewId] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  return (
    <label className="small inline-flex items-center gap-1.5 text-xs text-text-subtle">
      <span>Updates</span>
      <select
        aria-label="Subscribe to this view"
        value={sub.data?.cadence ?? "off"}
        disabled={sub.isLoading || change.isPending}
        onChange={(e) => change.mutate(e.target.value)}
        className="bg-surface border border-border rounded-lg px-2 py-1 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
      >
        <option value="off">Not subscribed</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
    </label>
  );
}
