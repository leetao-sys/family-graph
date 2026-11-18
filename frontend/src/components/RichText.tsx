import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import TurndownService from "turndown";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";

export type TextFormat = "markdown" | "html";

marked.setOptions({ gfm: true, breaks: true });
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

// 外链统一新窗口打开
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function toHtml(content: string, format: TextFormat) {
  const raw = format === "html" ? content : (marked.parse(content || "", { async: false }) as string);
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button"] });
}

/** 渲染 Markdown 或富文本（HTML 经过 DOMPurify 净化）。 */
export function RichContent({ content, format, className }: { content: string; format: TextFormat; className?: string }) {
  const html = useMemo(() => toHtml(content, format), [content, format]);
  return <div className={`rich-content ${className || ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()} // 保留编辑区选区
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Markdown ---------- */
function MarkdownEditor({ value, onChange, minHeight, id }: { value: string; onChange: (v: string) => void; minHeight: number; id?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"edit" | "split" | "preview">("split");

  const wrap = (before: string, after = before, placeholder = "文字") => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const linePrefix = (prefix: string) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const block = value.slice(lineStart, e);
    const replaced = block
      .split("\n")
      .map((l, i) => (prefix === "1. " ? `${i + 1}. ` : prefix) + l)
      .join("\n");
    onChange(value.slice(0, lineStart) + replaced + value.slice(e));
    requestAnimationFrame(() => ta.focus());
  };

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <ToolBtn title="二级标题" onClick={() => linePrefix("## ")}><Heading2 size={16} /></ToolBtn>
        <ToolBtn title="三级标题" onClick={() => linePrefix("### ")}><Heading3 size={16} /></ToolBtn>
        <ToolBtn title="加粗" onClick={() => wrap("**")}><Bold size={16} /></ToolBtn>
        <ToolBtn title="斜体" onClick={() => wrap("*")}><Italic size={16} /></ToolBtn>
        <ToolBtn title="删除线" onClick={() => wrap("~~")}><Strikethrough size={16} /></ToolBtn>
        <ToolBtn title="引用" onClick={() => linePrefix("> ")}><Quote size={16} /></ToolBtn>
        <ToolBtn title="无序列表" onClick={() => linePrefix("- ")}><List size={16} /></ToolBtn>
        <ToolBtn title="有序列表" onClick={() => linePrefix("1. ")}><ListOrdered size={16} /></ToolBtn>
        <ToolBtn title="代码" onClick={() => wrap("`")}><Code size={16} /></ToolBtn>
        <ToolBtn title="链接" onClick={() => wrap("[", "](https://)", "链接文字")}><Link2 size={16} /></ToolBtn>
        <ToolBtn title="图片" onClick={() => wrap("![", "](https://)", "图片说明")}><ImageIcon size={16} /></ToolBtn>
        <ToolBtn title="分隔线" onClick={() => wrap("\n\n---\n\n", "", "")}><Minus size={16} /></ToolBtn>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Markdown 视图">
          {(["edit", "split", "preview"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {{ edit: "编辑", split: "分栏", preview: "预览" }[k]}
            </button>
          ))}
        </div>
      </div>
      <div className={`md-panes ${view}`} style={{ minHeight }}>
        {view !== "preview" && (
          <textarea
            id={id}
            ref={ref}
            className="md-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="支持 Markdown：# 标题、**加粗**、- 列表、> 引用、[链接](https://…)"
            style={{ minHeight }}
          />
        )}
        {view !== "edit" && (
          <div className="md-preview">
            {value.trim() ? <RichContent content={value} format="markdown" /> : <span className="muted small">预览区</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 富文本（所见即所得） ---------- */
function WysiwygEditor({ value, onChange, minHeight, id }: { value: string; onChange: (v: string) => void; minHeight: number; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>("");

  useEffect(() => {
    // 只在外部值变化（如切换模式）时写入，避免打字时光标跳动
    if (ref.current && value !== last.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value);
      last.current = value;
    }
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? "";
    last.current = html;
    onChange(html === "<br>" ? "" : html);
  };
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <ToolBtn title="二级标题" onClick={() => exec("formatBlock", "<h2>")}><Heading2 size={16} /></ToolBtn>
        <ToolBtn title="三级标题" onClick={() => exec("formatBlock", "<h3>")}><Heading3 size={16} /></ToolBtn>
        <ToolBtn title="加粗" onClick={() => exec("bold")}><Bold size={16} /></ToolBtn>
        <ToolBtn title="斜体" onClick={() => exec("italic")}><Italic size={16} /></ToolBtn>
        <ToolBtn title="下划线" onClick={() => exec("underline")}><Underline size={16} /></ToolBtn>
        <ToolBtn title="删除线" onClick={() => exec("strikeThrough")}><Strikethrough size={16} /></ToolBtn>
        <ToolBtn title="引用" onClick={() => exec("formatBlock", "<blockquote>")}><Quote size={16} /></ToolBtn>
        <ToolBtn title="无序列表" onClick={() => exec("insertUnorderedList")}><List size={16} /></ToolBtn>
        <ToolBtn title="有序列表" onClick={() => exec("insertOrderedList")}><ListOrdered size={16} /></ToolBtn>
        <ToolBtn
          title="链接"
          onClick={() => {
            const url = window.prompt("链接地址", "https://");
            if (url && /^(https?:|mailto:|\/)/i.test(url)) exec("createLink", url);
          }}
        >
          <Link2 size={16} />
        </ToolBtn>
        <ToolBtn
          title="图片"
          onClick={() => {
            const url = window.prompt("图片地址", "https://");
            if (url && /^(https?:|\/)/i.test(url)) exec("insertImage", url);
          }}
        >
          <ImageIcon size={16} />
        </ToolBtn>
        <ToolBtn title="分隔线" onClick={() => exec("insertHorizontalRule")}><Minus size={16} /></ToolBtn>
        <ToolBtn title="正文段落" onClick={() => exec("formatBlock", "<p>")}><span style={{ fontSize: 12, fontWeight: 600 }}>正文</span></ToolBtn>
      </div>
      <div
        id={id}
        ref={ref}
        className="rich-content wysiwyg"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="在此输入内容，可用上方工具栏设置格式"
        onInput={emit}
        onBlur={emit}
        style={{ minHeight }}
      />
    </div>
  );
}

/** Markdown / 富文本二选一的编辑器。切换模式时自动转换已有内容。 */
export function RichEditor({
  value,
  format,
  onChange,
  minHeight = 220,
  id,
}: {
  value: string;
  format: TextFormat;
  onChange: (value: string, format: TextFormat) => void;
  minHeight?: number;
  id?: string;
}) {
  const switchTo = (f: TextFormat) => {
    if (f === format) return;
    if (!value.trim()) return onChange("", f);
    const converted = f === "html" ? toHtml(value, "markdown") : turndown.turndown(DOMPurify.sanitize(value));
    onChange(converted, f);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="segmented" role="group" aria-label="编辑器类型" style={{ alignSelf: "flex-start" }}>
        <button type="button" aria-pressed={format === "markdown"} onClick={() => switchTo("markdown")}>
          Markdown
        </button>
        <button type="button" aria-pressed={format === "html"} onClick={() => switchTo("html")}>
          富文本
        </button>
      </div>
      {format === "markdown" ? (
        <MarkdownEditor id={id} value={value} onChange={(v) => onChange(v, "markdown")} minHeight={minHeight} />
      ) : (
        <WysiwygEditor id={id} value={value} onChange={(v) => onChange(v, "html")} minHeight={minHeight} />
      )}
    </div>
  );
}
