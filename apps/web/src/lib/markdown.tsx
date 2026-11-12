import React from "react";

/**
 * Renders the markdown subset that issue descriptions and comments use:
 * paragraphs, bullet and numbered lists, task checklists, tables, code blocks,
 * blockquotes, headings, bold, italic, code, links, and safe images.
 * It builds React elements and never inserts HTML, so stored text cannot run as markup.
 */
const INLINE =
  /(!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\))/g;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1].startsWith("![")) {
      // Image: m[2] is alt, m[3] is url
      out.push(
        <img
          key={key}
          src={m[3]}
          alt={m[2] || "image"}
          style={{ maxWidth: "100%", borderRadius: "4px", margin: "4px 0" }}
          loading="lazy"
        />,
      );
    } else if (m[4] !== undefined) {
      out.push(<strong key={key}>{m[4]}</strong>);
    } else if (m[5] !== undefined) {
      out.push(<em key={key}>{m[5]}</em>);
    } else if (m[6] !== undefined) {
      out.push(<code key={key}>{m[6]}</code>);
    } else if (m[7] !== undefined) {
      out.push(
        <a key={key} href={m[8]} target="_blank" rel="noopener noreferrer">
          {m[7]}
        </a>,
      );
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  if (!source) return null;

  // Split into raw blocks, honoring fenced code blocks
  const lines = source.split("\n");
  const blocks: {
    type: "code" | "table" | "quote" | "checklist" | "ul" | "ol" | "h" | "p";
    lines: string[];
  }[] = [];
  let currentBlock: {
    type: "code" | "table" | "quote" | "checklist" | "ul" | "ol" | "h" | "p";
    lines: string[];
  } | null = null;
  let inCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = null;
        inCode = false;
      } else {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "code", lines: [line.replace(/^```\w*/, "")] };
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      currentBlock?.lines.push(line);
      continue;
    }

    if (trimmed.length === 0) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Check line type
    if (/^#{1,4}\s+/.test(line)) {
      if (currentBlock) blocks.push(currentBlock);
      blocks.push({ type: "h", lines: [line] });
      currentBlock = null;
    } else if (/^>\s+/.test(line)) {
      if (currentBlock?.type !== "quote") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "quote", lines: [line.replace(/^>\s*/, "")] };
      } else {
        currentBlock.lines.push(line.replace(/^>\s*/, ""));
      }
    } else if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) {
      if (currentBlock?.type !== "checklist") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "checklist", lines: [line] };
      } else {
        currentBlock.lines.push(line);
      }
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (currentBlock?.type !== "ul") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "ul", lines: [line.replace(/^\s*[-*]\s+/, "")] };
      } else {
        currentBlock.lines.push(line.replace(/^\s*[-*]\s+/, ""));
      }
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (currentBlock?.type !== "ol") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "ol", lines: [line.replace(/^\s*\d+\.\s+/, "")] };
      } else {
        currentBlock.lines.push(line.replace(/^\s*\d+\.\s+/, ""));
      }
    } else if ((line.includes("|") && lines[i + 1]?.includes("|--")) || currentBlock?.type === "table") {
      if (currentBlock?.type !== "table") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "table", lines: [line] };
      } else {
        currentBlock.lines.push(line);
      }
    } else {
      if (currentBlock?.type !== "p") {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { type: "p", lines: [line] };
      } else {
        currentBlock.lines.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return (
    <div className="markdown" style={{ lineHeight: 1.5 }}>
      {blocks.map((b, bi) => {
        if (b.type === "code") {
          return (
            <pre
              key={bi}
              style={{
                background: "var(--surface-muted, #f3f4f6)",
                padding: "8px 12px",
                borderRadius: "6px",
                overflowX: "auto",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
            >
              <code>{b.lines.join("\n")}</code>
            </pre>
          );
        }

        if (b.type === "h") {
          const text = b.lines[0].replace(/^#{1,4}\s+/, "");
          const level = b.lines[0].match(/^#{1,4}/)?.[0].length || 3;
          if (level === 1) return <h3 key={bi}>{inline(text, `${bi}`)}</h3>;
          if (level === 2) return <h4 key={bi}>{inline(text, `${bi}`)}</h4>;
          return <h5 key={bi}>{inline(text, `${bi}`)}</h5>;
        }

        if (b.type === "quote") {
          return (
            <blockquote
              key={bi}
              style={{
                borderLeft: "3px solid var(--accent, #3b82f6)",
                paddingLeft: "10px",
                margin: "6px 0",
                color: "var(--text-muted, #64748b)",
              }}
            >
              {b.lines.map((l, li) => (
                <div key={li}>{inline(l, `${bi}-${li}`)}</div>
              ))}
            </blockquote>
          );
        }

        if (b.type === "checklist") {
          return (
            <div key={bi} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {b.lines.map((l, li) => {
                const checked = /^\s*-\s+\[[xX]\]/.test(l);
                const text = l.replace(/^\s*-\s+\[[ xX]\]\s*/, "");
                return (
                  <label
                    key={li}
                    style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
                  >
                    <input type="checkbox" checked={checked} readOnly />
                    <span style={{ textDecoration: checked ? "line-through" : "none" }}>
                      {inline(text, `${bi}-${li}`)}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        }

        if (b.type === "ul") {
          return (
            <ul key={bi} style={{ paddingLeft: "18px", margin: "4px 0" }}>
              {b.lines.map((l, li) => (
                <li key={li}>{inline(l, `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }

        if (b.type === "ol") {
          return (
            <ol key={bi} style={{ paddingLeft: "18px", margin: "4px 0" }}>
              {b.lines.map((l, li) => (
                <li key={li}>{inline(l, `${bi}-${li}`)}</li>
              ))}
            </ol>
          );
        }

        if (b.type === "table") {
          const rows = b.lines.filter((l) => l.trim().startsWith("|") && !l.includes("|--"));
          const headerRow = rows[0]
            ?.split("|")
            .map((c) => c.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length);
          const bodyRows = rows.slice(1).map((r) =>
            r
              .split("|")
              .map((c) => c.trim())
              .filter((_, idx, arr) => idx > 0 && idx < arr.length),
          );

          return (
            <table
              key={bi}
              style={{
                width: "100%",
                borderCollapse: "collapse",
                margin: "8px 0",
                fontSize: "12px",
                border: "1px solid var(--border-subtle, #e2e8f0)",
              }}
            >
              {headerRow && (
                <thead>
                  <tr style={{ background: "var(--surface-muted, #f8fafc)" }}>
                    {headerRow.map((cell, ci) => (
                      <th
                        key={ci}
                        style={{
                          border: "1px solid var(--border-subtle, #e2e8f0)",
                          padding: "6px 8px",
                          textAlign: "left",
                        }}
                      >
                        {inline(cell, `${bi}-th-${ci}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {bodyRows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => (
                      <td
                        key={ci}
                        style={{
                          border: "1px solid var(--border-subtle, #e2e8f0)",
                          padding: "6px 8px",
                        }}
                      >
                        {inline(cell, `${bi}-td-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }

        return (
          <p key={bi} style={{ margin: "4px 0" }}>
            {b.lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
