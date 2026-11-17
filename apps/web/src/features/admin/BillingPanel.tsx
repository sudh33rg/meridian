import { formatDate } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Check, X as XIcon } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
        <span className="text-slate-400">
          {v.used.toLocaleString()}
          {unit} of {fmt(v.limit, unit)}
        </span>
      </div>
      <div
        className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            pct >= 90 ? "bg-amber-500" : "bg-indigo-600"
          }`}
          style={{ width: `${v.limit ? pct : 0}%` }}
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

  if (!o) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        {ov.error ? <div className="error text-rose-600">{errorMessage(ov.error)}</div> : "Loading billing…"}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white m-0">
          Billing & Subscription
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 m-0">
          Manage your organization plan tier, resource limits, and payment methods.
        </p>
      </div>

      {error && (
        <div
          className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 text-xs font-semibold"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Current Subscription Card */}
      <Card>
        <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <CreditCard size={20} />
            </div>
            <div>
              <CardTitle>Plan: {o.plan_name}</CardTitle>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
                <span>Status:</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 capitalize">
                  {o.status.replace("_", " ")}
                </span>
                {o.current_period_end && <span>· Renews {formatDate(o.current_period_end)}</span>}
              </div>
            </div>
          </div>

          {o.stripe_enabled && o.has_customer && (
            <button
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              disabled={portal.isPending}
              onClick={() => portal.mutate()}
            >
              Manage billing portal
            </button>
          )}
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Resource Usage</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Bar label="Members" v={o.usage.seats} />
            <Bar label="Projects" v={o.usage.projects} />
            <Bar label="Webhook endpoints" v={o.usage.webhooks} />
            <Bar label="Attachment storage" v={o.usage.storage_mb} unit=" MB" />
          </div>
        </CardContent>
      </Card>

      {/* Plans Tier Comparison Grid */}
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">
          Available Subscription Plans
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {o.plans.map((p) => {
            const isCurrent = p.key === o.plan;
            return (
              <Card
                key={p.key}
                className={`relative flex flex-col justify-between ${
                  isCurrent
                    ? "border-indigo-600 ring-2 ring-indigo-500/20 shadow-md"
                    : "hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[11px] font-extrabold tracking-wider uppercase bg-indigo-600 text-white shadow-xs">
                    Current Plan
                  </div>
                )}

                <CardContent className="p-6 space-y-5 flex-1">
                  <div>
                    <h4 className="text-lg font-bold text-slate-900 dark:text-white m-0">{p.name}</h4>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {p.seat_price_cents ? `$${(p.seat_price_cents / 100).toFixed(0)}` : "$0"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {p.seat_price_cents ? "/ member / month" : "forever"}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-800 m-0 p-0 list-none">
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-600 shrink-0" />
                      <span>{fmt(p.seats)} members</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-600 shrink-0" />
                      <span>{fmt(p.projects)} projects</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-600 shrink-0" />
                      <span>{fmt(p.webhooks)} webhooks</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check size={14} className="text-emerald-600 shrink-0" />
                      <span>{fmt(p.storage_mb, " MB")} storage</span>
                    </li>
                    <li className="flex items-center gap-2">
                      {p.sso ? (
                        <Check size={14} className="text-emerald-600 shrink-0" />
                      ) : (
                        <XIcon size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                      )}
                      <span className={p.sso ? "" : "text-slate-400 line-through"}>Single sign-on</span>
                    </li>
                    <li className="flex items-center gap-2">
                      {p.scim ? (
                        <Check size={14} className="text-emerald-600 shrink-0" />
                      ) : (
                        <XIcon size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                      )}
                      <span className={p.scim ? "" : "text-slate-400 line-through"}>SCIM provisioning</span>
                    </li>
                  </ul>
                </CardContent>

                <div className="p-4 bg-slate-50/75 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800">
                  {isCurrent ? (
                    <div className="text-center text-xs font-bold text-indigo-600 dark:text-indigo-400 py-1.5">
                      Active
                    </div>
                  ) : o.stripe_enabled && p.key !== "free" ? (
                    <button
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors cursor-pointer"
                      disabled={checkout.isPending}
                      onClick={() => checkout.mutate(p.key)}
                    >
                      Choose {p.name}
                    </button>
                  ) : o.dev_plan_switch ? (
                    <button
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                      disabled={switchPlan.isPending}
                      onClick={() => switchPlan.mutate(p.key)}
                    >
                      Switch to {p.name} (dev)
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {!o.stripe_enabled && (
        <p className="text-xs text-slate-400 italic">
          {o.dev_plan_switch
            ? "Payments are disabled in development; plans can be switched instantly for testing."
            : "Payments are not configured. Contact your workspace administrator."}
        </p>
      )}
    </div>
  );
}
