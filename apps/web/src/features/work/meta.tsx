import React from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
  Bug,
  CheckSquare,
  ChevronsUp,
  Inbox,
  Layers,
  BookMarked,
  Sparkles,
  TrendingUp,
} from "lucide-react";

export const STATUSES = ["todo", "in_progress", "in_review", "done"] as const;
const KIND_TONE: Record<string, string> = {
  bug: "bg-danger-soft text-danger",
  story: "bg-success-soft text-success",
  epic: "bg-accent-soft text-accent-text",
};

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-danger",
  high: "text-warning-text",
  medium: "text-info-text",
};

export const STATUS_TONE: Record<string, string> = {
  in_progress: "bg-info-soft text-info-text",
  in_review: "bg-warning-soft text-warning-text",
  done: "bg-success-soft text-success-text",
};

export const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};
export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const KINDS = ["task", "bug", "story", "epic"] as const;

export function KindIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const map: Record<string, React.ReactNode> = {
    bug: <Bug size={size} />,
    story: <BookMarked size={size} />,
    epic: <Layers size={size} />,
    task: <CheckSquare size={size} />,
    feature: <Sparkles size={size} />,
    improvement: <TrendingUp size={size} />,
    incident: <AlertTriangle size={size} />,
    request: <Inbox size={size} />,
  };
  return (
    <span
      className={`inline-grid place-items-center size-6 rounded-[7px] flex-none ${KIND_TONE[kind] ?? "bg-info-soft text-info"}`}
      title={kind}
    >
      {map[kind] ?? map.task}
    </span>
  );
}

export function PriorityIcon({
  priority,
  size = 14,
  label = true,
}: {
  priority: string;
  size?: number;
  label?: boolean;
}) {
  const icon =
    priority === "urgent" ? (
      <ChevronsUp size={size} />
    ) : priority === "high" ? (
      <ArrowUp size={size} />
    ) : priority === "low" ? (
      <ArrowDown size={size} />
    ) : (
      <ArrowRight size={size} />
    );
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-[650] capitalize ${PRIORITY_TONE[priority] ?? "text-text-subtle"}`}
      title={"Priority: " + priority}
    >
      {icon}
      {label && priority}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block text-[11px] font-bold capitalize whitespace-nowrap px-[9px] py-[3px] rounded-full ${STATUS_TONE[status] ?? "bg-surface-3 text-text-subtle"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
