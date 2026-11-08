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
    <span className={"kind-chip kind-" + kind} title={kind}>
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
    <span className={"priority priority-" + priority} title={"Priority: " + priority}>
      {icon}
      {label && priority}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={"status " + status}>{STATUS_LABEL[status] ?? status}</span>;
}
