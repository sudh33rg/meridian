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
          <div className="text-[11px] font-extrabold tracking-wider uppercase text-accent mb-1.5 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-main font-display truncate">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-text-muted mt-1 max-w-3xl leading-relaxed">{subtitle}</p>}
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
      className={`bg-surface border border-border rounded-xl shadow-xs transition-all text-text-main ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-4 py-3.5 sm:px-6 sm:py-4 border-b border-border flex items-center justify-between gap-3 ${className}`}
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
      className={`text-sm sm:text-base font-bold text-text-main flex items-center gap-2 m-0 ${className}`}
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
      className={`px-4 py-3 sm:px-6 sm:py-3.5 bg-surface-2 border-t border-border flex items-center justify-between gap-3 ${className}`}
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
    indigo: "bg-accent-soft text-accent border-accent/20",
    violet: "bg-accent-soft-2 text-accent-strong border-accent/20",
    emerald: "bg-success-soft text-success-text border-success-border",
    amber: "bg-warning-soft text-warning-text border-warning-border",
    rose: "bg-danger-soft text-danger-text border-danger-border",
    sky: "bg-info-soft text-info-text border-info/20",
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
          {Icon && (
            <div className={`p-2 rounded-lg border ${colorMap[color]}`}>
              <Icon size={18} />
            </div>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-black text-text-main tracking-tight">{value}</div>
          {trend && (
            <span
              className={`inline-flex items-center text-xs font-bold gap-0.5 ${
                trend.positive ? "text-success-text" : "text-danger-text"
              }`}
            >
              <TrendingUp size={13} className={trend.positive ? "" : "rotate-180"} />
              {trend.value}
            </span>
          )}
        </div>
        {subvalue && <p className="text-xs text-text-muted mt-1 mb-0 truncate">{subvalue}</p>}
      </CardContent>
    </Card>
  );
}

/** Status Badge */
export function StatusBadge({ status }: { status: string }) {
  const norm = (status || "").toLowerCase().replace(/[\s-]/g, "_");
  const styles: Record<string, { bg: string; dot: string; label: string }> = {
    todo: {
      bg: "bg-surface-3 text-text-muted border border-border",
      dot: "bg-text-subtle",
      label: "To Do",
    },
    in_progress: {
      bg: "bg-info-soft text-info-text border border-info/30",
      dot: "bg-info",
      label: "In Progress",
    },
    in_review: {
      bg: "bg-warning-soft text-warning-text border border-warning-border",
      dot: "bg-warning",
      label: "In Review",
    },
    done: {
      bg: "bg-success-soft text-success-text border border-success-border",
      dot: "bg-success",
      label: "Done",
    },
    backlog: {
      bg: "bg-surface-3 text-text-subtle border border-border",
      dot: "bg-text-subtle",
      label: "Backlog",
    },
  };

  const style = styles[norm] || {
    bg: "bg-surface-3 text-text-muted border border-border",
    dot: "bg-text-subtle",
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
      bg: "bg-danger-soft text-danger-text border border-danger-border",
      text: "Urgent",
      label: "Urgent",
    },
    high: {
      bg: "bg-warning-soft text-warning-text border border-warning-border",
      text: "High",
      label: "High",
    },
    medium: {
      bg: "bg-accent-soft text-accent-text border border-accent/20",
      text: "Medium",
      label: "Medium",
    },
    low: {
      bg: "bg-surface-3 text-text-muted border border-border",
      text: "Low",
      label: "Low",
    },
  };

  const style = styles[norm] || {
    bg: "bg-surface-3 text-text-muted border border-border",
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
          ? "bg-danger-soft text-danger-text border border-danger-border"
          : isStory
            ? "bg-success-soft text-success-text border border-success-border"
            : isEpic
              ? "bg-accent-soft-2 text-accent-strong border border-accent/20"
              : "bg-accent-soft text-accent-text border border-accent/20"
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
    <div className="py-12 sm:py-16 px-4 text-center border-2 border-dashed border-border rounded-2xl bg-surface/40">
      <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl bg-accent-soft border border-accent/20 flex items-center justify-center text-accent shadow-2xs">
        <Icon size={28} />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-text-main mb-1.5">{title}</h3>
      <p className="text-xs sm:text-sm text-text-muted max-w-md mx-auto mb-6">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent-strong active:bg-accent-strong shadow-xs transition-colors cursor-pointer"
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-overlay backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${maxWidth} bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden my-auto z-10 text-text-main`}
      >
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-text-main m-0">{title}</h2>
            {subtitle && <p className="text-xs sm:text-sm text-text-muted mt-0.5 m-0">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 sm:p-6 max-h-[75vh] overflow-y-auto">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 sm:px-6 sm:py-4 bg-surface-2 border-t border-border flex items-center justify-end gap-3 flex-wrap">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
