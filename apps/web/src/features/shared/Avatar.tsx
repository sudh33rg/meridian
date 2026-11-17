import React from "react";

/** Deterministic hue per name, so the same person always gets the same color. */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({
  name,
  size = 28,
  square = false,
}: {
  name: string;
  size?: number;
  square?: boolean;
}) {
  const hue = hueOf(name || "?");
  return (
    <span
      className={
        "inline-grid place-items-center rounded-full text-white font-bold flex-none leading-none" +
        (square ? " rounded-[9px]" : "")
      }
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `hsl(${hue} 55% 46%)`,
      }}
    >
      {(name || "?").trim()[0]?.toUpperCase()}
    </span>
  );
}

export function Skeleton({ w, h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return (
    <span
      className="block bg-[linear-gradient(90deg,var(--surface-3)_25%,var(--surface-4)_50%,var(--surface-3)_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_linear_infinite]"
      aria-hidden="true"
      style={{ width: w ?? "100%", height: h, borderRadius: r }}
    />
  );
}
