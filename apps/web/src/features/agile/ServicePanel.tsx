import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { formatDateTime } from "../../lib/datetime";
import type { FieldDefinition } from "../../lib/fields";
import { IncidentsView } from "./IncidentsView";
import { CustomerPortalView } from "./CustomerPortalView";

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
  // The form being built: field key to whether it is required, in the order chosen.
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
  const slaQ = useQuery({
    queryKey: ["service-sla", selected],
    queryFn: () => request<Sla[]>(token, `/projects/${selected}/service/sla`),
    enabled: active,
  });
  const fieldsQ = useQuery({
    queryKey: ["fields", selected],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${selected}/fields`),
    enabled: active,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn: () => request<Member[]>(token, "/members"),
    enabled: active,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["service-queues", selected] });
    void qc.invalidateQueries({ queryKey: ["service-types", selected] });
    void qc.invalidateQueries({ queryKey: ["service-sla", selected] });
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
      toast("Queue added");
      refresh();
    },
    onError: fail,
  });
  const addType = useMutation({
    mutationFn: () =>
      send(`/projects/${selected}/service/request-types`, token, "POST", {
        name: typeName.trim(),
        description: typeDesc,
        flow: typeFlow,
        queue_id: typeQueue,
        target_hours: Number(typeHours),
        requires_approval: typeNeedsApproval,
        approver_id: typeNeedsApproval ? typeApprover : null,
        fields: Object.entries(typeForm).map(([key, required]) => ({ key, required })),
      }),
    onSuccess: () => {
      setTypeName("");
      setTypeDesc("");
      setTypeNeedsApproval(false);
      setTypeApprover("");
      setTypeForm({});
      toast("Request type added");
      refresh();
    },
    onError: fail,
  });
  const submit = useMutation({
    mutationFn: () =>
      send(`/projects/${selected}/service/requests`, token, "POST", {
        request_type_id: reqType,
        title: reqTitle.trim(),
        description: reqText,
        values: formValues(),
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

  // The chosen request type's form, with each field's definition.
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
    <div className="service-panel">
      <div className="panel-head">
        <h3>Service management</h3>
        <span className="muted small">
          {sla.length} requests · {breached} past target
        </span>
      </div>
      <div className="ext-two-cols">
        <section className="panel" aria-label="Queues">
          <h4>Queues</h4>
          <ul className="workflow-list">
            {queues.map((q) => (
              <li key={q.id} className="workflow-row">
                <span>
                  {q.name}
                  <span className="muted small">
                    {" "}
                    · assigns to {membersQ.data?.find((m) => m.id === q.default_assignee_id)?.name ?? "nobody"}
                  </span>
                </span>
              </li>
            ))}
            {!queues.length && <li className="muted small">No queues yet.</li>}
          </ul>
          <form
            className="workflow-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (queueName.trim()) addQueue.mutate();
            }}
          >
            <input aria-label="Queue name" maxLength={80} value={queueName} onChange={(e) => setQueueName(e.target.value)} placeholder="Queue name" />
            <select aria-label="Default assignee" value={queueAssignee} onChange={(e) => setQueueAssignee(e.target.value)}>
              <option value="">No default assignee</option>
              {(membersQ.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button className="secondary" type="submit" disabled={!queueName.trim() || addQueue.isPending}>
              Add queue
            </button>
          </form>
        </section>
        <section className="panel" aria-label="Request types">
          <h4>Request types</h4>
          <ul className="workflow-list">
            {types.map((t) => (
              <li key={t.id} className="workflow-row">
                <span>
                  {t.name}
                  <span className="muted small">
                    {" "}
                    · {t.flow} · {t.target_hours} h · {queues.find((q) => q.id === t.queue_id)?.name ?? "queue"}
                  </span>
                </span>
              </li>
            ))}
            {!types.length && <li className="muted small">No request types yet.</li>}
          </ul>
          <form
            className="workflow-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (typeName.trim() && typeQueue) addType.mutate();
            }}
          >
            <input aria-label="Request type name" maxLength={80} value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="Name" />
            <input aria-label="Request type description" maxLength={2000} value={typeDesc} onChange={(e) => setTypeDesc(e.target.value)} placeholder="Description" />
            <select aria-label="Flow" value={typeFlow} onChange={(e) => setTypeFlow(e.target.value)}>
              <option value="request">Request</option>
              <option value="incident">Incident</option>
              <option value="change">Change</option>
            </select>
            <select aria-label="Queue" value={typeQueue} onChange={(e) => setTypeQueue(e.target.value)}>
              <option value="">Queue…</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
            <input aria-label="Target hours" type="number" min={1} max={8760} value={typeHours} onChange={(e) => setTypeHours(e.target.value)} />
            <label className="inline-check">
              <input type="checkbox" checked={typeNeedsApproval} onChange={(e) => setTypeNeedsApproval(e.target.checked)} /> Needs approval
            </label>
            {typeNeedsApproval && (
              <select aria-label="Approver" value={typeApprover} onChange={(e) => setTypeApprover(e.target.value)}>
                <option value="">Approver…</option>
                {(membersQ.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <fieldset className="screen-fields">
              <legend className="muted small">Form fields (in the order chosen)</legend>
              {(fieldsQ.data ?? []).map((f) => {
                const on = f.key in typeForm;
                return (
                  <span key={f.key} className="inline-check">
                    <label>
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
                      />{" "}
                      {f.label}
                    </label>
                    {on && (
                      <label>
                        {" "}
                        <input
                          type="checkbox"
                          checked={!!typeForm[f.key]}
                          onChange={(e) => setTypeForm((old) => ({ ...old, [f.key]: e.target.checked }))}
                        />{" "}
                        required
                      </label>
                    )}
                  </span>
                );
              })}
              {!(fieldsQ.data ?? []).length && <span className="muted small">Define custom fields in the board's workflow section first.</span>}
            </fieldset>
            <button className="secondary" type="submit" disabled={!typeName.trim() || !typeQueue || addType.isPending}>
              Add request type
            </button>
          </form>
        </section>
      </div>
      <section className="panel" aria-label="Submit a request">
        <h4>Submit a request</h4>
        <form
          className="workflow-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (reqType && reqTitle.trim()) submit.mutate();
          }}
        >
          <select aria-label="Request type" value={reqType} onChange={(e) => setReqType(e.target.value)}>
            <option value="">Choose a request type…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input aria-label="Request title" maxLength={200} value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="What do you need?" />
          <input aria-label="Request details" maxLength={20000} value={reqText} onChange={(e) => setReqText(e.target.value)} placeholder="Details (optional)" />
          {formFields.map((f) => (
            <label key={f.key} className="inline-check">
              {f.label}
              {f.required ? " *" : ""}
              {f.field_type === "select" ? (
                <select value={reqValues[f.key] ?? ""} onChange={(e) => setReqValues({ ...reqValues, [f.key]: e.target.value })}>
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
                  onChange={(e) => setReqValues({ ...reqValues, [f.key]: e.target.checked ? "true" : "false" })}
                />
              ) : (
                <input
                  type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                  required={f.required}
                  value={reqValues[f.key] ?? ""}
                  onChange={(e) => setReqValues({ ...reqValues, [f.key]: e.target.value })}
                />
              )}
            </label>
          ))}
          <button className="primary" type="submit" disabled={!reqType || !reqTitle.trim() || submit.isPending}>
            Submit
          </button>
        </form>
      </section>
      <section className="panel" aria-label="Service level report">
        <h4>SLA</h4>
        {sla.length === 0 && <p className="muted small">No requests yet.</p>}
        {sla.length > 0 && (
          <table className="sla-table">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Type</th>
                <th scope="col">Elapsed</th>
                <th scope="col">Target</th>
                <th scope="col">State</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {sla.map((r) => (
                <tr key={r.id}>
                  <td>
                    #{r.number} {r.title}
                  </td>
                  <td>{r.request_type}</td>
                  <td>{r.elapsed_hours.toFixed(1)} h</td>
                  <td>{r.target_hours} h</td>
                  <td>{STATE_LABEL[r.state]}</td>
                  <td>{formatDateTime(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <CustomerPortalView projectId={selected} />
      <IncidentsView projectId={selected} />
    </div>
  );
}
