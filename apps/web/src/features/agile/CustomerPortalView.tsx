import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { Globe, ExternalLink, Send, Search } from "lucide-react";

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
      const res = await send<CustomerRequestStatus>(`/portal/projects/${projectId}/requests`, session.token, "POST", {
        email: email.trim(),
        summary: summary.trim(),
        description: description.trim() || null,
        request_type_id: requestTypeId,
      });
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
    <section className="panel" aria-label="Customer Portal" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h4 style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <Globe size={18} color="#3b82f6" /> Customer Support Portal
          </h4>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Self-service intake for non-authenticated clients, customers, and partners.
          </p>
        </div>
        <span className="chip success">
          <ExternalLink size={12} style={{ marginRight: 4 }} /> Portal Active
        </span>
      </div>

      {portal.isLoading && <p className="small muted">Loading portal settings…</p>}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "var(--bg-subtle)", padding: 14, borderRadius: 6 }}>
            <h5 style={{ margin: "0 0 8px" }}>Intake Ticket Form</h5>
            <p className="small muted" style={{ margin: "0 0 12px" }}>
              {data.welcome_message || `Welcome to the ${data.portal_name}. Submit a request below.`}
            </p>
            <form onSubmit={submitPublicRequest}>
              <label className="small" style={{ display: "block", marginBottom: 8 }}>
                Request Type
                <select value={requestTypeId} onChange={(e) => setRequestTypeId(e.target.value)} required>
                  <option value="">Select a service category…</option>
                  {data.request_types.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="small" style={{ display: "block", marginBottom: 8 }}>
                Contact Email
                <input
                  type="email"
                  placeholder="customer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="small" style={{ display: "block", marginBottom: 8 }}>
                Summary
                <input
                  type="text"
                  placeholder="Short description of the issue"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required
                />
              </label>
              <label className="small" style={{ display: "block", marginBottom: 12 }}>
                Details
                <textarea
                  rows={2}
                  placeholder="Additional context, steps to reproduce..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="primary small-btn"
                disabled={!email.trim() || !summary.trim() || !requestTypeId}
              >
                <Send size={12} /> Submit Request
              </button>
            </form>
          </div>

          <div style={{ background: "var(--bg-subtle)", padding: 14, borderRadius: 6 }}>
            <h5 style={{ margin: "0 0 8px" }}>Track Ticket Status</h5>
            <p className="small muted" style={{ margin: "0 0 12px" }}>
              Customers can look up their ticket status at any time using their ticket reference UUID.
            </p>
            <form onSubmit={lookupRequest} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Paste Request UUID"
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                required
                style={{ flex: 1 }}
              />
              <button type="submit" className="secondary small-btn" disabled={!trackId.trim()}>
                <Search size={14} /> Look up
              </button>
            </form>

            {trackingResult && (
              <div style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: 12, borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <strong>Ticket #{trackingResult.number}</strong>
                  <span className="chip small success">{trackingResult.status}</span>
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{trackingResult.summary}</div>
                <div className="small muted">ID: {trackingResult.id}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
