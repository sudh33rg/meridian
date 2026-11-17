import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { Globe, ExternalLink, Send, Search } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

export type PortalInfo = {
  project_id: string;
  project_name: string;
  portal_name: string;
  welcome_message: string;
  request_types: { id: string; name: string; description: string }[];
};

export type CustomerRequestStatus = {
  id: string;
  number: number;
  summary: string;
  status: string;
  created_at: string;
};

export function CustomerPortalView({ projectId }: { projectId: string }) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [requestTypeId, setRequestTypeId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [trackingResult, setTrackingResult] = useState<CustomerRequestStatus | null>(null);

  const portal = useQuery({
    queryKey: ["portal-info", projectId],
    queryFn: () => request<PortalInfo>(session.token, `/portal/projects/${projectId}`),
  });

  const submitPublicRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !summary.trim() || !requestTypeId) return;
    try {
      const res = await send<CustomerRequestStatus>(
        `/portal/projects/${projectId}/requests`,
        session.token,
        "POST",
        {
          email: email.trim(),
          summary: summary.trim(),
          description: description.trim() || null,
          request_type_id: requestTypeId,
        },
      );
      toast(`Request #${res.number} created via Customer Portal!`);
      setEmail("");
      setSummary("");
      setDescription("");
      setTrackingResult(res);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const lookupRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackId.trim()) return;
    try {
      const res = await request<CustomerRequestStatus>(session.token, `/portal/requests/${trackId.trim()}`);
      setTrackingResult(res);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const data = portal.data;

  return (
    <Card className="panel mt-4 space-y-4 p-4 sm:p-6" aria-label="Customer Portal">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-bold text-text-main">
            <Globe size={18} className="text-blue-500" /> Customer Support Portal
          </CardTitle>
          <p className="text-xs sm:text-sm text-text-subtle mt-1">
            Self-service intake for non-authenticated clients, customers, and partners.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-semibold capitalize whitespace-nowrap">
          <ExternalLink size={12} /> Portal Active
        </span>
      </CardHeader>

      <CardContent className="p-0">
        {portal.isLoading && (
          <p className="text-xs text-text-subtle p-6 text-center">Loading portal settings…</p>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Intake Ticket Form */}
            <div className="bg-surface-2 p-4 sm:p-5 rounded-xl border border-border space-y-3">
              <h5 className="text-sm font-bold text-text-main">Intake Ticket Form</h5>
              <p className="text-xs text-text-subtle">
                {data.welcome_message || `Welcome to the ${data.portal_name}. Submit a request below.`}
              </p>
              <form onSubmit={submitPublicRequest} className="space-y-3">
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-text-subtle">Request Type</span>
                  <select
                    value={requestTypeId}
                    onChange={(e) => setRequestTypeId(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                  >
                    <option value="">Select a service category…</option>
                    {data.request_types.map((rt) => (
                      <option key={rt.id} value={rt.id}>
                        {rt.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-text-subtle">Contact Email</span>
                  <input
                    type="email"
                    placeholder="customer@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-text-subtle">Summary</span>
                  <input
                    type="text"
                    placeholder="Short description of the issue"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-text-subtle">Details</span>
                  <textarea
                    rows={2}
                    placeholder="Additional context, steps to reproduce..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm disabled:opacity-50 justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px]"
                  disabled={!email.trim() || !summary.trim() || !requestTypeId}
                >
                  <Send size={12} /> Submit Request
                </button>
              </form>
            </div>

            {/* Track Ticket Status */}
            <div className="bg-surface-2 p-4 sm:p-5 rounded-xl border border-border space-y-3">
              <h5 className="text-sm font-bold text-text-main">Track Ticket Status</h5>
              <p className="text-xs text-text-subtle">
                Customers can look up their ticket status at any time using their ticket reference UUID.
              </p>
              <form onSubmit={lookupRequest} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste Request UUID"
                  value={trackId}
                  onChange={(e) => setTrackId(e.target.value)}
                  required
                  className="flex-1 px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main justify-center whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                  disabled={!trackId.trim()}
                >
                  <Search size={14} /> Look up
                </button>
              </form>

              {trackingResult && (
                <div className="p-3.5 bg-surface border border-border rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm font-bold text-text-main">
                      Ticket #{trackingResult.number}
                    </strong>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 capitalize whitespace-nowrap">
                      {trackingResult.status}
                    </span>
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-text-main">
                    {trackingResult.summary}
                  </div>
                  <div className="font-mono text-[11px] text-text-subtle">ID: {trackingResult.id}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
