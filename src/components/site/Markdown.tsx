import Link from "next/link";
import type { ReactNode } from "react";

/** A small, safe Markdown renderer for site articles: headings (##, ###),
 * paragraphs, bullet and numbered lists, quotes, **bold**, *italic* and links.
 * No HTML is passed through; links go only to this site or https pages. */
export function Markdown({ source, base }: { source: string; base: string }) {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
      {blocks.map((b, i) => block(b.trim(), i, base))}
    </div>
  );
}

function block(b: string, key: number, base: string): ReactNode {
  if (!b) return null;
  const h = b.match(/^(#{2,3})\s+(.+)$/);
  if (h && !b.includes("\n")) {
    return h[1].length === 2
      ? <h2 key={key} className="pt-2 text-xl font-semibold text-[#0b2a6b]">{inline(h[2], base)}</h2>
      : <h3 key={key} className="pt-1 text-base font-semibold text-[#0b2a6b]">{inline(h[2], base)}</h3>;
  }
  const lines = b.split("\n");
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return <ul key={key} className="list-disc space-y-1 pl-5">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""), base)}</li>)}</ul>;
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return <ol key={key} className="list-decimal space-y-1 pl-5">{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), base)}</li>)}</ol>;
  }
  if (lines.every((l) => l.startsWith(">"))) {
    return <blockquote key={key} className="border-l-4 border-slate-200 pl-4 text-slate-600">{inline(lines.map((l) => l.replace(/^>\s?/, "")).join(" "), base)}</blockquote>;
  }
  return <p key={key}>{inline(lines.join(" "), base)}</p>;
}

function inline(text: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2];
      if (/^\/(?![/\\])/.test(href)) out.push(<Link key={k++} href={href === "/" ? base || "/" : `${base}${href}`} className="text-[#1565c0] hover:underline">{m[1]}</Link>);
      else if (/^https:\/\//.test(href)) out.push(<a key={k++} href={href} rel="nofollow noopener" className="text-[#1565c0] hover:underline">{m[1]}</a>);
      else out.push(m[1]);
    } else if (m[3] !== undefined) out.push(<strong key={k++} className="font-semibold text-slate-800">{m[3]}</strong>);
    else out.push(<em key={k++}>{m[4]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
