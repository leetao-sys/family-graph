import { useMemo } from "react";
import { RichContent, toHtml, type TextFormat } from "./RichText";

interface RawSection {
  title: string;
  lines: string[];
}

interface Section {
  title: string;
  original: string[];
  originalLines: string[];
  translation: string[];
  verse: boolean;
}

function splitOriginal(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection = { title: "序", lines: [] };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      if (current.lines.some((x) => x.trim())) sections.push(current);
      current = { title: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((x) => x.trim())) sections.push(current);
  return sections;
}

function splitTranslation(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection = { title: "序", lines: [] };
  for (const line of lines) {
    const heading = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (heading) {
      if (current.lines.some((x) => x.trim())) sections.push(current);
      current = { title: heading[1].replace(/（[^）]*）\s*$/, "").trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((x) => x.trim())) sections.push(current);
  return sections;
}

function paragraphs(lines: string[], byLine = false): string[] {
  const text = lines.join("\n").trim();
  if (!text) return [];
  return text
    .split(byLine ? /\n+/ : /\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseArticle(content: string, format: TextFormat): Section[] | null {
  if (format !== "markdown") return null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  // 译文以引用块开头；第一篇文章的译文从 “> 天地生人…” 开始，一直到文末
  const quoteAt = lines.findIndex((line) => /^>\s?/.test(line));
  if (quoteAt < 2) return null;
  const originals = splitOriginal(lines.slice(0, quoteAt));
  const translations = splitTranslation(lines.slice(quoteAt).map((line) => line.replace(/^>\s?/, "")));
  if (originals.length < 2 || translations.length < 2 || originals.length !== translations.length) return null;
  return originals.map((o, i) => {
    const t = translations[i];
    const originalLines = o.lines.map((x) => x.trim()).filter(Boolean);
    return {
      title: o.title,
      original: paragraphs(o.lines),
      originalLines,
      translation: paragraphs(t.lines, true),
      verse: o.title.includes("题"),
    };
  });
}

function Paragraphs({ items }: { items: string[] }) {
  const html = useMemo(() => items.map((p) => toHtml(p, "markdown")).join(""), [items]);
  return <div className="article-copy" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 古文 / 今译对照阅读。只有识别到“多节原文 + 末尾译文”的文章才启用，其余文章保持普通正文。 */
export default function ArticleReader({
  content,
  format,
  className,
}: {
  content: string;
  format: TextFormat;
  className?: string;
}) {
  const sections = useMemo(() => parseArticle(content, format), [content, format]);
  if (!sections) return <RichContent content={content} format={format} className={className} />;

  return (
    <div className={`article-reader ${className || ""}`}>
      <div className="article-reader-head">
        <span className="article-reader-seal">对</span>
        <div>
          <strong>原文 · 今译</strong>
          <span>按节左右对照 · 手机端上下排列</span>
        </div>
        <span className="spacer" />
        <span className="muted small">{sections.length} 节</span>
      </div>

      {sections.map((section, index) => (
        <section className={`article-part${section.verse ? " is-verse" : ""}`} key={`${section.title}-${index}`}>
          <header className="article-part-head">
            <span className="article-part-no">{String(index + 1).padStart(2, "0")}</span>
            <h2>{section.title}</h2>
          </header>
          <div className="article-compare">
            <div className="article-col original">
              <div className="article-col-label">原文</div>
              {section.verse ? (
                <div className="article-verse">
                  {section.originalLines.map((line, i) => {
                    const note = line.match(/^(.*?)(〔[\s\S]*〕)$/);
                    return (
                      <p key={i}>
                        {note ? note[1] : line}
                        {note && <span className="verse-note">{note[2]}</span>}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <Paragraphs items={section.original} />
              )}
            </div>
            <div className="article-col translation">
              <div className="article-col-label">今译</div>
              <Paragraphs items={section.translation} />
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
