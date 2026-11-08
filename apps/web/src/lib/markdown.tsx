import React from "react";

/**
 * Renders the markdown subset that issue descriptions use: paragraphs, bullet lists, headings, bold,
 * italic, code and links to http, https or mailto. It builds React elements and never inserts HTML, so
 * stored text cannot run as markup. Anything outside the subset is shown as plain text.
 */
const INLINE = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\))/g;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<code key={key}>{m[4]}</code>);
    else
      out.push(
        <a key={key} href={m[6]} target="_blank" rel="noopener noreferrer">
          {m[5]}
        </a>,
      );
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return (
    <div className="markdown">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*] /, ""), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.length === 1 && /^#{1,3} /.test(block)) {
          return <h4 key={bi}>{inline(block.replace(/^#{1,3} /, ""), `${bi}`)}</h4>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
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
