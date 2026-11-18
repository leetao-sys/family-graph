import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Search, X, XCircle } from "lucide-react";
import { get, qs } from "./api";
import { avatarOf } from "./avatars";
import type { PersonBrief } from "./types";

/* ---------- 印章 ---------- */
export function Seal({
  char = "谱",
  size = 34,
  ghost = false,
  className = "",
  title,
}: {
  char?: string;
  size?: number;
  ghost?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`seal ${ghost ? "ghost" : ""} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.54) }}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      {char}
    </span>
  );
}

/* ---------- 头像 ---------- */
export function Avatar({
  person,
  size = 36,
  square = false,
}: {
  person: Pick<PersonBrief, "avatar" | "gender" | "name"> & { is_living?: boolean };
  size?: number;
  square?: boolean;
}) {
  return (
    <img
      className={`avatar ${square ? "square" : ""} ${person.is_living === false ? "deceased" : ""} ${person.avatar ? "custom" : "default"}`}
      src={avatarOf(person)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
    />
  );
}

export function PersonLine({ p, extra }: { p: PersonBrief; extra?: ReactNode }) {
  return (
    <span className="row" style={{ minWidth: 0 }}>
      <Avatar person={p} size={28} />
      <span
        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-serif)" }}
        title={p.name}
      >
        {p.name}
        {!p.is_living && <span className="muted small">（已故）</span>}
      </span>
      {p.birth_year && <span className="muted small num">{p.birth_year}</span>}
      {p.hint && (
        <span
          className="muted small"
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={p.hint}
        >
          {p.hint}
        </span>
      )}
      {extra}
    </span>
  );
}

/* ---------- 弹窗 ---------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm";
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size || ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <span className="seal sm">笺</span>
          <h2 id={titleId}>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- 二次确认 ---------- */
type ConfirmOpts = { title: string; message: ReactNode; okText?: string; danger?: boolean };
const ConfirmContext = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);
export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async () => false);
};

/* ---------- 轻提示 ---------- */
type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2800);
  }, []);
  const ask = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={ask}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>
              {t.kind === "success" ? <CheckCircle2 size={17} /> : t.kind === "error" ? <XCircle size={17} /> : null}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        {confirm && (
          <Modal
            size="sm"
            title={confirm.title}
            onClose={() => close(false)}
            footer={
              <>
                <button className="btn" onClick={() => close(false)}>
                  取消
                </button>
                <button className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} autoFocus>
                  {confirm.okText || "确定"}
                </button>
              </>
            }
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              {confirm.danger && <AlertTriangle size={20} color="var(--danger)" style={{ flex: "none" }} />}
              <div>{confirm.message}</div>
            </div>
          </Modal>
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

/* ---------- 状态组件 ---------- */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={42} strokeWidth={1.2} />
      <div className="empty-title">{title}</div>
      {hint && <div className="small" style={{ maxWidth: 420 }}>{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <XCircle size={38} strokeWidth={1.2} color="var(--danger)" />
      <div className="empty-title" style={{ color: "var(--danger)" }}>
        {message}
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row">
          <Skeleton h={32} w={32} r={16} />
          <Skeleton h={13} w={`${38 + ((i * 17) % 42)}%`} />
        </div>
      ))}
    </div>
  );
}

/* ---------- 防抖 ---------- */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- 人物选择器（搜索） ---------- */
export function PersonPicker({
  value,
  onChange,
  placeholder = "寻人 · 姓名 / 字 / 号",
  autoFocus,
  clearOnSelect,
  exclude,
  ariaLabel,
}: {
  value?: PersonBrief | null;
  onChange: (p: PersonBrief | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  clearOnSelect?: boolean;
  exclude?: number[];
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value?.name || "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PersonBrief[]>([]);
  const [active, setActive] = useState(0);
  const q = useDebounced(text, 200);
  const listId = useId();

  useEffect(() => {
    if (value) setText(value.name);
  }, [value?.id, value?.name]);
  useEffect(() => {
    if (!open || !q.trim() || q === value?.name) {
      setItems([]);
      return;
    }
    let alive = true;
    get<{ items: PersonBrief[] }>(`/api/persons?${qs({ q, size: 12 })}`)
      .then((r) => alive && setItems(r.items.filter((p) => !exclude?.includes(p.id))))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [q, open, value?.name, exclude]);

  const pick = (p: PersonBrief) => {
    onChange(p);
    setOpen(false);
    setText(clearOnSelect ? "" : p.name);
  };

  return (
    <div className="picker">
      <div className="picker-input">
        <Search size={15} />
        <input
          className="input"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          role="combobox"
          aria-label={ariaLabel || placeholder}
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (value && e.target.value !== value.name) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              pick(items[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {!open && !clearOnSelect && text.trim() && !value && (
        <span className="error small" role="alert">
          请从下拉列表中选择人物
        </span>
      )}
      {open && items.length > 0 && (
        <ul className="picker-list" role="listbox" id={listId}>
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <PersonLine p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Pagination({
  page,
  size,
  total,
  onPage,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span className="muted small num">共 {total} 条</span>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span className="small num">
        {page} / {pages}
      </span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </div>
  );
}

/* 页面标题：竖排小签 + 标题 + 副标题 */
export function PageHeading({
  mark = "谱",
  title,
  sub,
  actions,
}: {
  mark?: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        <span className="vertical-mark">{mark}</span>
        <div>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <span className="spacer" />
      {actions}
    </div>
  );
}
