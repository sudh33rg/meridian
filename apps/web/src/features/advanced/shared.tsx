import { formatDate } from "../../lib/datetime";
import React from "react";
import { Sparkles } from "lucide-react";
import type { Item } from "../../lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

export const str = (x: unknown) => String(x ?? "");
export const count = (x: unknown) => Number(x || 0);
export const day = (x: unknown) => (x ? formatDate(str(x)) : "—");

export function Empty({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="ext-empty py-12 px-4 text-center flex flex-col items-center justify-center text-muted">
      <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent flex items-center justify-center mb-3">
        <Sparkles size={24} />
      </div>
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-xs sm:text-sm mt-1 text-muted max-w-sm">{caption}</p>
    </div>
  );
}

export function Analytics({ data }: { data: Item | Item[] }) {
  const d: Item = Array.isArray(data) ? {} : data;
  const statuses = (d.statuses || []) as Item[];
  const types = (d.types || []) as Item[];
  const sum = statuses.reduce((a, r) => a + count(r.count), 0);

  return (
    <div className="ext-two-cols grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
      <Card className="panel">
        <CardHeader>
          <CardTitle>Issue flow</CardTitle>
        </CardHeader>
        <CardContent className="ext-form-body space-y-3">
          {statuses.map((r) => (
            <div
              className="stat-row flex items-center justify-between gap-4 text-xs sm:text-sm"
              key={str(r.status)}
            >
              <span className="font-medium text-text capitalize min-w-[100px]">
                {str(r.status).replaceAll("_", " ")}
              </span>
              <div className="progress-track flex-1 h-2 bg-surface-3 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all"
                  style={{ width: `${sum ? (count(r.count) * 100) / sum : 0}%` }}
                />
              </div>
              <b className="font-semibold text-text min-w-[28px] text-right">{count(r.count)}</b>
            </div>
          ))}
          {!statuses.length && <Empty title="No delivery data" caption="Create some issues to see trends." />}
        </CardContent>
      </Card>

      <Card className="panel">
        <CardHeader>
          <CardTitle>Work mix</CardTitle>
        </CardHeader>
        <CardContent className="ext-form-body space-y-3">
          {types.map((r) => (
            <div className="stat-row flex items-center justify-between text-xs sm:text-sm" key={str(r.kind)}>
              <span className="capitalize font-medium text-text">{str(r.kind)}</span>
              <b className="font-semibold text-text">{count(r.count)}</b>
            </div>
          ))}
          <div className="stat-row total pt-3 border-t border-border flex items-center justify-between text-xs sm:text-sm">
            <span className="font-medium text-muted">Overdue, open issues</span>
            <strong className="font-bold text-danger-text">{count(d.overdue)}</strong>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
