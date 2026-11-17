import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { formatDateTime } from "../../lib/datetime";
import type { FieldDefinition } from "../../lib/fields";
import { IncidentsView } from "./IncidentsView";
import { CustomerPortalView } from "./CustomerPortalView";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type Queue = { id: string; name: string; default_assignee_id: string | null };
type RequestType = {
  id: string;
  name: string;
  description: string;
  flow: string;
  queue_id: string;
  target_hours: number;
  requires_approval: boolean;
  approver_id: string | null;
  fields: { key: string; required: boolean }[];
};
type Sla = {
  id: string;
  number: number;
  title: string;
  status: string;
  request_type: string;
  flow: string;
  target_hours: number;
  started_at: string;
  resolved_at: string | null;
  elapsed_hours: number;
  state: "met" | "missed" | "on_track" | "breached";
};
type Member = { id: string; name: string };

const STATE_LABEL: Record<Sla["state"], string> = {
  met: "Met",
  missed: "Missed",
  on_track: "On track",
  breached: "Breached",
};

/** Service management: queues, request types, submitted requests and the SLA report. */
export function ServicePanel() {
  const { session, selected, tab } = useWorkspace();
  const token = session.token;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [queueName, setQueueName] = useState("");
  const [queueAssignee, setQueueAssignee] = useState("");
  const [typeName, setTypeName] = useState("");
  const [typeDesc, setTypeDesc] = useState("");
  const [typeFlow, setTypeFlow] = useState("request");
  const [typeQueue, setTypeQueue] = useState("");
  const [typeHours, setTypeHours] = useState("72");
  const [reqType, setReqType] = useState("");
  const [reqTitle, setReqTitle] = useState("");
  const [reqText, setReqText] = useState("");
  const [typeNeedsApproval, setTypeNeedsApproval] = useState(false);
  const [typeApprover, setTypeApprover] = useState("");
  const [typeForm, setTypeForm] = useState<Record<string, boolean>>({});
  const [reqValues, setReqValues] = useState<Record<string, string>>({});
  const active = tab === "service" && !!selected;

  const queuesQ = useQuery({
    queryKey: ["service-queues", selected],
    queryFn: () => request<Queue[]>(token, `/projects/${selected}/service/queues`),
    enabled: active,
  });
  const typesQ = useQuery({
    queryKey: ["service-types", selected],
    queryFn: () => request<RequestType[]>(token, `/projects/${selected}/service/request-types`),
    enabled: active,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn: () => request<Member[]>(token, "/members"),
    enabled: active,
  });
  const fieldsQ = useQuery({
    queryKey: ["fields", selected],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${selected}/fields`),
    enabled: active,
  });
  const slaQ = useQuery({
    queryKey: ["service-sla", selected],
    queryFn: () => request<Sla[]>(token, `/projects/${selected}/service/sla`),
    enabled: active,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["service-queues", selected] });
    void qc.invalidateQueries({ queryKey: ["service-types", selected] });
    void qc.invalidateQueries({ queryKey: ["service-sla", selected] });
    void qc.invalidateQueries({ queryKey: ["issues", selected] });
  };
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });

  const addQueue = useMutation({
    mutationFn: () =>
      send(`/projects/${selected}/service/queues`, token, "POST", {
        name: queueName.trim(),
        default_assignee_id: queueAssignee || null,
      }),
    onSuccess: () => {
      setQueueName("");
      setQueueAssignee("");
      toast("Queue created");
      refresh();
    },
    onError: fail,
  });

  const addType = useMutation({
    mutationFn: () =>
      send(`/projects/${selected}/service/request-types`, token, "POST", {
        name: typeName.trim(),
        description: typeDesc.trim(),
        flow: typeFlow,
        queue_id: typeQueue,
        target_hours: Number(typeHours),
        requires_approval: typeNeedsApproval,
        approver_id: typeNeedsApproval && typeApprover ? typeApprover : null,
        fields: Object.entries(typeForm).map(([key, required]) => ({ key, required })),
      }),
    onSuccess: () => {
      setTypeName("");
      setTypeDesc("");
      setTypeQueue("");
      setTypeHours("72");
      setTypeNeedsApproval(false);
      setTypeApprover("");
      setTypeForm({});
      toast("Request type created");
      refresh();
    },
    onError: fail,
  });

  const submit = useMutation({
    mutationFn: () =>
      send(`/projects/${selected}/service/requests`, token, "POST", {
        request_type_id: reqType,
        title: reqTitle.trim(),
        description: reqText.trim() || undefined,
        custom_fields: formValues(),
      }),
    onSuccess: () => {
      setReqTitle("");
      setReqText("");
      setReqValues({});
      toast("Request submitted");
      refresh();
    },
    onError: fail,
  });

  const chosen = (typesQ.data ?? []).find((t) => t.id === reqType);
  const formFields = (chosen?.fields ?? [])
    .map((ff) => ({ def: (fieldsQ.data ?? []).find((f) => f.key === ff.key), required: ff.required }))
    .filter((x): x is { def: FieldDefinition; required: boolean } => !!x.def)
    .map((x) => ({ ...x.def, required: x.required }));

  function formValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of formFields) {
      const raw = reqValues[f.key];
      if (raw === undefined || raw === "") continue;
      if (f.field_type === "number") out[f.key] = Number(raw);
      else if (f.field_type === "boolean") out[f.key] = raw === "true";
      else out[f.key] = raw;
    }
    return out;
  }

  if (!active) return null;
  const queues = queuesQ.data ?? [];
  const types = typesQ.data ?? [];
  const sla = slaQ.data ?? [];
  const breached = sla.filter((r) => r.state === "breached" || r.state === "missed").length;

  return (
    <div className="service-panel space-y-6">
      <div className="flex justify-between items-center border-b border-border px-[18px] py-3.5 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-[7px] [&_h3]:text-[15px] [&_h3]:m-0 [&_h3]:tracking-[-0.2px] [&>button]:text-accent-text [&>button]:text-xs [&>button]:font-semibold [&>button]:hover:underline">
        <PageHeader
          title="Service management"
          subtitle={`${sla.length} requests · ${breached} past target`}
        />
        <h3 className="sr-only">Service management</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start max-[900px]:grid-cols-1">
        {/* Queues Section */}
        <Card
          className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]"
          aria-label="Queues"
        >
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Queues
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            <ul className="divide-y divide-border/60 m-0 p-0 list-none grid gap-1.5">
              {queues.map((q) => (
                <li
                  key={q.id}
                  className="py-2 text-xs flex items-center justify-between grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
                >
                  <span className="font-medium text-text-main">
                    {q.name}
                    <span className="text-text-subtle text-[11px]">
                      {" "}
                      · assigns to{" "}
                      {membersQ.data?.find((m) => m.id === q.default_assignee_id)?.name ?? "nobody"}
                    </span>
                  </span>
                </li>
              ))}
              {!queues.length && <li className="text-xs text-text-subtle py-2">No queues yet.</li>}
            </ul>

            <form
              className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border items-center [&_input]:min-w-[180px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (queueName.trim()) addQueue.mutate();
              }}
            >
              <input
                aria-label="Queue name"
                maxLength={80}
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                placeholder="Queue name"
                className="flex-1 px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <select
                aria-label="Default assignee"
                value={queueAssignee}
                onChange={(e) => setQueueAssignee(e.target.value)}
                className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
              >
                <option value="">No default assignee</option>
                {(membersQ.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                className="px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] border border-border-strong hover:text-text-main"
                type="submit"
                disabled={!queueName.trim() || addQueue.isPending}
              >
                Add queue
              </button>
            </form>
          </CardContent>
        </Card>

        {/* Request Types Section */}
        <Card
          className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]"
          aria-label="Request types"
        >
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Request types
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            <ul className="divide-y divide-border/60 m-0 p-0 list-none grid gap-1.5">
              {types.map((t) => (
                <li
                  key={t.id}
                  className="py-2 text-xs flex items-center justify-between grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
                >
                  <span className="font-medium text-text-main">
                    {t.name}
                    <span className="text-text-subtle text-[11px]">
                      {" "}
                      · {t.flow} · {t.target_hours} h ·{" "}
                      {queues.find((q) => q.id === t.queue_id)?.name ?? "queue"}
                    </span>
                  </span>
                </li>
              ))}
              {!types.length && <li className="text-xs text-text-subtle py-2">No request types yet.</li>}
            </ul>

            <form
              className="space-y-2.5 pt-2 border-t border-border flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (typeName.trim() && typeQueue) addType.mutate();
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  aria-label="Request type name"
                  maxLength={80}
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  placeholder="Name"
                  className="px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                  aria-label="Request type description"
                  maxLength={2000}
                  value={typeDesc}
                  onChange={(e) => setTypeDesc(e.target.value)}
                  placeholder="Description"
                  className="px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  aria-label="Flow"
                  value={typeFlow}
                  onChange={(e) => setTypeFlow(e.target.value)}
                  className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
                >
                  <option value="request">Request</option>
                  <option value="incident">Incident</option>
                  <option value="change">Change</option>
                </select>
                <select
                  aria-label="Queue"
                  value={typeQueue}
                  onChange={(e) => setTypeQueue(e.target.value)}
                  className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
                >
                  <option value="">Queue…</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Target hours"
                  type="number"
                  min={1}
                  max={8760}
                  value={typeHours}
                  onChange={(e) => setTypeHours(e.target.value)}
                  placeholder="Target hours"
                  className="px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-check flex items-center gap-1.5 text-xs text-text-subtle cursor-pointer">
                  <input
                    type="checkbox"
                    checked={typeNeedsApproval}
                    onChange={(e) => setTypeNeedsApproval(e.target.checked)}
                    className="rounded text-accent"
                  />{" "}
                  Needs approval
                </label>
                {typeNeedsApproval && (
                  <select
                    aria-label="Approver"
                    value={typeApprover}
                    onChange={(e) => setTypeApprover(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
                  >
                    <option value="">Approver…</option>
                    {(membersQ.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <fieldset className="screen-fields p-3 bg-surface-2 rounded-xl border border-border space-y-1.5">
                <legend className="text-[11px] font-semibold text-text-subtle px-1">
                  Form fields (in order)
                </legend>
                <div className="flex flex-wrap gap-2">
                  {(fieldsQ.data ?? []).map((f) => {
                    const on = f.key in typeForm;
                    return (
                      <span
                        key={f.key}
                        className="inline-check inline-flex items-center gap-1.5 p-1 bg-surface rounded-lg border border-border text-xs"
                      >
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setTypeForm((old) => {
                                const next = { ...old };
                                if (f.key in next) delete next[f.key];
                                else next[f.key] = false;
                                return next;
                              })
                            }
                            className="rounded text-accent"
                          />{" "}
                          {f.label}
                        </label>
                        {on && (
                          <label className="flex items-center gap-1 text-[10px] text-text-subtle ml-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!typeForm[f.key]}
                              onChange={(e) => setTypeForm((old) => ({ ...old, [f.key]: e.target.checked }))}
                              className="rounded text-accent"
                            />{" "}
                            required
                          </label>
                        )}
                      </span>
                    );
                  })}
                  {!(fieldsQ.data ?? []).length && (
                    <span className="text-xs text-text-subtle italic">
                      Define custom fields in the board's workflow section first.
                    </span>
                  )}
                </div>
              </fieldset>

              <button
                className="w-full py-2 bg-accent text-white rounded-xl text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 border border-border-strong hover:text-text-main"
                type="submit"
                disabled={!typeName.trim() || !typeQueue || addType.isPending}
              >
                Add request type
              </button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Submit Request Section */}
      <Card
        className="bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]"
        aria-label="Submit a request"
      >
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
            Submit a request
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <form
            className="space-y-3 flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (reqType && reqTitle.trim()) submit.mutate();
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                aria-label="Request type"
                value={reqType}
                onChange={(e) => setReqType(e.target.value)}
                className="px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main"
              >
                <option value="">Choose a request type…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Request title"
                maxLength={200}
                value={reqTitle}
                onChange={(e) => setReqTitle(e.target.value)}
                placeholder="What do you need?"
                className="px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <input
              aria-label="Request details"
              maxLength={20000}
              value={reqText}
              onChange={(e) => setReqText(e.target.value)}
              placeholder="Details (optional)"
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {formFields.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-surface-2 rounded-xl border border-border">
                {formFields.map((f) => (
                  <label key={f.key} className="inline-check block space-y-1 text-xs">
                    <span className="font-semibold text-text-subtle">
                      {f.label}
                      {f.required ? " *" : ""}
                    </span>
                    {f.field_type === "select" ? (
                      <select
                        value={reqValues[f.key] ?? ""}
                        onChange={(e) => setReqValues({ ...reqValues, [f.key]: e.target.value })}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                      >
                        <option value="">—</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.field_type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={reqValues[f.key] === "true"}
                        onChange={(e) =>
                          setReqValues({ ...reqValues, [f.key]: e.target.checked ? "true" : "false" })
                        }
                        className="rounded text-accent ml-2"
                      />
                    ) : (
                      <input
                        type={
                          f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"
                        }
                        required={f.required}
                        value={reqValues[f.key] ?? ""}
                        onChange={(e) => setReqValues({ ...reqValues, [f.key]: e.target.value })}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
            <button
              className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)]"
              type="submit"
              disabled={!reqType || !reqTitle.trim() || submit.isPending}
            >
              Submit
            </button>
          </form>
        </CardContent>
      </Card>

      {/* SLA Service Level Report Table */}
      <Card
        className="overflow-hidden bg-surface border border-border rounded-[var(--radius-lg)] mb-4 shadow-[var(--shadow-sm)]"
        aria-label="Service level report"
      >
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">SLA</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sla.length === 0 && <p className="p-6 text-center text-xs text-text-subtle">No requests yet.</p>}
          {sla.length > 0 && (
            <div className="overflow-x-auto">
              <table className="sla-table w-full text-left text-xs">
                <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                  <tr>
                    <th scope="col" className="p-3">
                      Request
                    </th>
                    <th scope="col" className="p-3">
                      Type
                    </th>
                    <th scope="col" className="p-3">
                      Elapsed
                    </th>
                    <th scope="col" className="p-3">
                      Target
                    </th>
                    <th scope="col" className="p-3">
                      State
                    </th>
                    <th scope="col" className="p-3">
                      Started
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sla.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2 transition-colors">
                      <td className="p-3 font-medium text-text-main">
                        #{r.number} {r.title}
                      </td>
                      <td className="p-3 text-text-subtle">{r.request_type}</td>
                      <td className="p-3 font-mono">{r.elapsed_hours.toFixed(1)} h</td>
                      <td className="p-3 font-mono">{r.target_hours} h</td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${
                            r.state === "met"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : r.state === "on_track"
                                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {STATE_LABEL[r.state]}
                        </span>
                      </td>
                      <td className="p-3 text-text-subtle font-mono">{formatDateTime(r.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerPortalView projectId={selected} />
      <IncidentsView projectId={selected} />
    </div>
  );
}
