import React from "react";
import { Bookmark, Bug, CheckCircle2, Layers, TrendingUp, X } from "lucide-react";

/** Uniform Page Header with mobile-first responsive layout */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="text-[11px] font-extrabold tracking-wider uppercase text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white font-display truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0 w-full sm:w-auto">{actions}</div>
      )}
    </div>
  );
}

/** Uniform Card Container */
export function Card({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-xs transition-all ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = "",
  id,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      id={id}
      {...props}
      className={`text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 m-0 ${className}`}
    >
      {children}
    </h3>
  );
}

export function CardContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 sm:p-6 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-4 py-3 sm:px-6 sm:py-3.5 bg-slate-50/70 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-3 ${className}`}
    >
      {children}
    </div>
  );
}

/** Uniform Stat / Metric Card */
export function StatCard({
  label,
  value,
  subvalue,
  icon: Icon,
  trend,
  color = "indigo",
}: {
  label: string;
  value: string | number;
  subvalue?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  trend?: { value: string; positive?: boolean };
  color?: "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet";
}) {
  const colorMap = {
    indigo:
      "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50",
    emerald:
      "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50",
    amber:
      "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/50",
    rose: "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900/50",
    sky: "bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border-sky-100 dark:border-sky-900/50",
    violet:
      "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-900/50",
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {label}
          </span>
          {Icon && (
            <div className={`p-2 rounded-lg border ${colorMap[color]}`}>
              <Icon size={18} />
            </div>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            {value}
          </div>
          {trend && (
            <span
              className={`inline-flex items-center text-xs font-bold gap-0.5 ${
                trend.positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
              }`}
            >
              <TrendingUp size={13} className={trend.positive ? "" : "rotate-180"} />
              {trend.value}
            </span>
          )}
        </div>
        {subvalue && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-0 truncate">{subvalue}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Status Badge */
export function StatusBadge({ status }: { status: string }) {
  const norm = (status || "").toLowerCase().replace(/[\s-]/g, "_");
  const styles: Record<string, { bg: string; dot: string; label: string }> = {
    todo: {
      bg: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
      dot: "bg-slate-400",
      label: "To Do",
    },
    in_progress: {
      bg: "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60",
      dot: "bg-sky-500",
      label: "In Progress",
    },
    in_review: {
      bg: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60",
      dot: "bg-amber-500",
      label: "In Review",
    },
    done: {
      bg: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60",
      dot: "bg-emerald-500",
      label: "Done",
    },
    backlog: {
      bg: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
      dot: "bg-slate-400",
      label: "Backlog",
    },
  };

  const style = styles[norm] || {
    bg: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
    label: status.replace(/_/g, " "),
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${style.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      <span className="capitalize">{style.label}</span>
    </span>
  );
}

/** Priority Badge */
export function PriorityBadge({ priority }: { priority: string }) {
  const norm = (priority || "").toLowerCase();
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    urgent: {
      bg: "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60",
      text: "Urgent",
      label: "Urgent",
    },
    high: {
      bg: "bg-orange-100 dark:bg-orange-950/70 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-900/60",
      text: "High",
      label: "High",
    },
    medium: {
      bg: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50",
      text: "Medium",
      label: "Medium",
    },
    low: {
      bg: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
      text: "Low",
      label: "Low",
    },
  };

  const style = styles[norm] || {
    bg: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
    text: priority,
    label: priority,
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${style.bg}`}
    >
      {style.label}
    </span>
  );
}

/** Kind / Type Badge */
export function KindBadge({ kind }: { kind: string }) {
  const norm = (kind || "").toLowerCase();
  const isBug = norm === "bug";
  const isStory = norm === "story";
  const isEpic = norm === "epic";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
        isBug
          ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50"
          : isStory
            ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50"
            : isEpic
              ? "bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-900/50"
              : "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50"
      }`}
    >
      {isBug ? (
        <Bug size={12} />
      ) : isStory ? (
        <Bookmark size={12} />
      ) : isEpic ? (
        <Layers size={12} />
      ) : (
        <CheckCircle2 size={12} />
      )}
      <span className="capitalize">{kind}</span>
    </span>
  );
}

/** Reusable Empty State */
export function EmptyState({
  icon: Icon = Layers,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; icon?: React.ComponentType<{ size?: number }> };
}) {
  return (
    <div className="py-12 sm:py-16 px-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white/40 dark:bg-slate-900/40">
      <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-2xs">
        <Icon size={28} />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1.5">{title}</h3>
      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-xs transition-colors cursor-pointer"
        >
          {action.icon && <action.icon size={16} />}
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Uniform Responsive Modal */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${maxWidth} bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto z-10`}
      >
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white m-0">{title}</h2>
            {subtitle && (
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5 m-0">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 sm:p-6 max-h-[75vh] overflow-y-auto">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 sm:px-6 sm:py-4 bg-slate-50/80 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3 flex-wrap">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
