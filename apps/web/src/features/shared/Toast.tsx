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
      <div
        className="fixed right-5 bottom-5 z-[80] flex flex-col gap-2 items-end max-[820px]:inset-x-3 max-[820px]:bottom-[84px] max-[820px]:items-stretch"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2.5 min-w-60 max-w-[min(420px,calc(100vw-32px))] px-3 py-2.5 bg-text-main text-text-inverse rounded-[var(--radius)] shadow-[var(--shadow-lg)] text-[13px] animate-[toast-in_0.25s_var(--ease)]"
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={16} className="in-data-[theme=light]:text-[#6ee7a0]" />
            ) : t.kind === "error" ? (
              <TriangleAlert size={16} />
            ) : (
              <Info size={16} />
            )}
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                className="font-bold underline text-inherit"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
