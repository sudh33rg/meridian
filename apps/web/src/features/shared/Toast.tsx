import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type Kind = "success" | "error" | "info";
type ToastItem = { id: number; kind: Kind; text: string; action?: { label: string; run: () => void } };
type Ctx = {
  toast: (text: string, opts?: { kind?: Kind; action?: ToastItem["action"]; ms?: number }) => void;
};
const ToastCtx = createContext<Ctx>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback<Ctx["toast"]>(
    (text, opts) => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-3), { id, text, kind: opts?.kind ?? "success", action: opts?.action }]);
      window.setTimeout(() => dismiss(id), opts?.ms ?? (opts?.action ? 6000 : 3500));
    },
    [dismiss],
  );
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={"toast toast-" + t.kind} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "success" ? (
              <CheckCircle2 size={16} />
            ) : t.kind === "error" ? (
              <TriangleAlert size={16} />
            ) : (
              <Info size={16} />
            )}
            <span>{t.text}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
