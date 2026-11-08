import { formatDate } from "../../lib/datetime";
import React from "react";
import { Sparkles } from "lucide-react";
import type { Item } from "../../lib/types";

export const str = (x: unknown) => String(x ?? "");
export const count = (x: unknown) => Number(x || 0);
export const day = (x: unknown) => (x ? formatDate(str(x)) : "—");
export function Empty({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="ext-empty">
      <Sparkles size={25} />
      <h3>{title}</h3>
      <p>{caption}</p>
    </div>
  );
}
export function Analytics({ data }: { data: Item | Item[] }) {
  const d: Item = Array.isArray(data) ? {} : data;
  const statuses = (d.statuses || []) as Item[];
  const types = (d.types || []) as Item[];
  const sum = statuses.reduce((a, r) => a + count(r.count), 0);
  return (
    <div className="ext-two-cols">
      <div className="panel">
        <div className="panel-head">
          <h3>Issue flow</h3>
        </div>
        <div className="ext-form-body">
          {statuses.map((r) => (
            <div className="stat-row" key={str(r.status)}>
              <span>{str(r.status).replaceAll("_", " ")}</span>
              <div className="progress-track">
                <div style={{ width: `${sum ? (count(r.count) * 100) / sum : 0}%` }} />
              </div>
              <b>{count(r.count)}</b>
            </div>
          ))}
          {!statuses.length && <Empty title="No delivery data" caption="Create some issues to see trends." />}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Work mix</h3>
        </div>
        <div className="ext-form-body">
          {types.map((r) => (
            <div className="stat-row" key={str(r.kind)}>
              <span>{str(r.kind)}</span>
              <b>{count(r.count)}</b>
            </div>
          ))}
          <div className="stat-row total">
            <span>Overdue, open issues</span>
            <strong>{count(d.overdue)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
