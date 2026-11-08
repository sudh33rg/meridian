import { formatDate } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";

type Limit = { used: number; limit: number | null };
type Overview = {
  plan: string;
  plan_name: string;
  status: string;
  current_period_end: string | null;
  has_customer: boolean;
  stripe_enabled: boolean;
  dev_plan_switch: boolean;
  usage: { seats: Limit; projects: Limit; webhooks: Limit; storage_mb: Limit };
  features: { sso: boolean; scim: boolean };
  plans: {
    key: string;
    name: string;
    seat_price_cents: number;
    seats: number | null;
    projects: number | null;
    webhooks: number | null;
    storage_mb: number | null;
    sso: boolean;
    scim: boolean;
  }[];
};

const fmt = (n: number | null, unit = "") => (n === null ? "Unlimited" : `${n.toLocaleString()}${unit}`);
function Bar({ label, v, unit = "" }: { label: string; v: Limit; unit?: string }) {
  const pct = v.limit ? Math.min(100, Math.round((v.used / v.limit) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row-gap" style={{ justifyContent: "space-between", fontSize: 13 }}>
        <span>{label}</span>
        <span className="muted">
          {v.used.toLocaleString()}
          {unit} of {fmt(v.limit, unit)}
        </span>
      </div>
      <div
        style={{ height: 8, background: "#e6eaf2", borderRadius: 6 }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          style={{
            width: `${v.limit ? pct : 0}%`,
            height: 8,
            borderRadius: 6,
            background: pct >= 90 ? "#d9480f" : "#3468e5",
          }}
        />
      </div>
    </div>
  );
}

export function BillingPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const ov = useQuery({ queryKey: ["billing"], queryFn: () => api<Overview>("/billing") });
  const fail = (e: unknown) => setError(errorMessage(e));
  const go = (url: string) => window.location.assign(url);
  const checkout = useMutation({
    mutationFn: (plan: string) => send<{ url: string }>("/billing/checkout", "", "POST", { plan }),
    onSuccess: (r) => go(r.url),
    onError: fail,
  });
  const portal = useMutation({
    mutationFn: () => send<{ url: string }>("/billing/portal", "", "POST"),
    onSuccess: (r) => go(r.url),
    onError: fail,
  });
  const switchPlan = useMutation({
    mutationFn: (plan: string) => send<void>("/billing/plan", "", "POST", { plan }),
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: fail,
  });
  const o = ov.data;
  if (!o)
    return (
      <div className="ext-wrap">
        {ov.error ? <div className="error">{errorMessage(ov.error)}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  return (
    <div className="ext-wrap">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="panel-card">
        <h3>
          <CreditCard size={18} /> Plan: {o.plan_name}
        </h3>
        <p className="muted">
          Status: <span className="tag">{o.status.replace("_", " ")}</span>
          {o.current_period_end ? ` · renews ${formatDate(o.current_period_end)}` : ""}
        </p>
        <Bar label="Members" v={o.usage.seats} />
        <Bar label="Projects" v={o.usage.projects} />
        <Bar label="Webhook endpoints" v={o.usage.webhooks} />
        <Bar label="Attachment storage" v={o.usage.storage_mb} unit=" MB" />
        {o.stripe_enabled && o.has_customer && (
          <button className="secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
            Manage billing
          </button>
        )}
      </div>
      <div className="plan-grid">
        {o.plans.map((p) => (
          <div key={p.key} className={"panel-card" + (p.key === o.plan ? " current-plan" : "")}>
            <h3>{p.name}</h3>
            <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>
              {p.seat_price_cents ? `$${(p.seat_price_cents / 100).toFixed(0)}` : "$0"}
              <small className="muted">{p.seat_price_cents ? " / member / month" : " forever"}</small>
            </p>
            <ul className="plan-features">
              <li>{fmt(p.seats)} members</li>
              <li>{fmt(p.projects)} projects</li>
              <li>{fmt(p.webhooks)} webhooks</li>
              <li>{fmt(p.storage_mb, " MB")} storage</li>
              <li className={p.sso ? "" : "off"}>Single sign-on</li>
              <li className={p.scim ? "" : "off"}>SCIM provisioning</li>
            </ul>
            {p.key === o.plan ? (
              <span className="tag">Current plan</span>
            ) : o.stripe_enabled && p.key !== "free" ? (
              <button
                className="primary"
                disabled={checkout.isPending}
                onClick={() => checkout.mutate(p.key)}
              >
                Choose {p.name}
              </button>
            ) : o.dev_plan_switch ? (
              <button
                className="secondary"
                disabled={switchPlan.isPending}
                onClick={() => switchPlan.mutate(p.key)}
              >
                Switch (development)
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!o.stripe_enabled && (
        <p className="muted small">
          {o.dev_plan_switch
            ? "Payments are not configured in this environment, so plans can be switched directly for development."
            : "Payments are not configured. Contact the operator to change the plan."}
        </p>
      )}
    </div>
  );
}
