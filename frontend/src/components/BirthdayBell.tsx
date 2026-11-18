import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Cake } from "lucide-react";
import { get } from "../api";
import type { PersonBrief } from "../types";
import { Avatar, useToast } from "../ui";

export interface BirthdayItem {
  id: string;
  person: PersonBrief;
  calendar: "lunar" | "solar";
  birth_date: string;
  birth_text: string;
  date: string; // 对应的公历日期
  days_until: number;
  age: number | null;
  is_self: boolean;
}

const WINDOW_DAYS = 30; // 列表显示 30 天内
const BADGE_DAYS = 7; // 7 天内未读的计入角标

function whenText(d: number) {
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  if (d === 2) return "后天";
  return `${d} 天后`;
}

function dateText(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  const w = "日一二三四五六"[new Date(`${iso}T00:00:00`).getDay()];
  return `${m}月${d}日 周${w}`;
}

/** 页头铃铛：近期生日提醒（仅本人及血亲/旁亲，且需有权看到生日）。 */
export default function BirthdayBell({ userId }: { userId: number }) {
  const toast = useToast();
  const [items, setItems] = useState<BirthdayItem[] | null>(null);
  const [birthdayMeta, setBirthdayMeta] = useState<{ bound: boolean; reason: string | null }>({ bound: true, reason: null });
  const [open, setOpen] = useState(false);
  const storeKey = `fg-seen-notices-${userId}`;
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storeKey) || "[]"));
    } catch {
      return new Set();
    }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    get<{ items: BirthdayItem[]; bound?: boolean; reason?: string | null }>(`/api/notifications/birthdays?days=${WINDOW_DAYS}`)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setBirthdayMeta({ bound: r.bound !== false, reason: r.reason ?? null });
        const today = r.items.filter((i) => i.days_until === 0 && !seen.has(i.id));
        if (r.bound !== false && today.length) {
          const names = today.map((i) => (i.is_self ? "你" : i.person.name)).join("、");
          toast("info", `今天是 ${names} 的生日 🎂`);
        }
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unread = (items || []).filter((i) => i.days_until <= BADGE_DAYS && !seen.has(i.id));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items?.length) {
      // 打开即视为已读；只保留当前仍有效的 id，避免无限增长
      const s = new Set(items.map((i) => i.id));
      localStorage.setItem(storeKey, JSON.stringify([...s]));
      // 延迟更新，打开时仍能看到哪些是新的
      setTimeout(() => setSeen(s), 1500);
    }
  };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label={`消息通知${unread.length ? `，${unread.length} 条未读` : ""}`}
        aria-expanded={open}
        title="消息通知"
        style={{ position: "relative" }}
      >
        <Bell size={18} />
        {unread.length > 0 && <span className="bell-badge">{unread.length > 99 ? "99+" : unread.length}</span>}
      </button>
      {open && (
        <div className="picker-list" style={{ left: "auto", right: 0, width: 340, maxHeight: "none" }} role="dialog" aria-label="生日提醒">
          <div className="row" style={{ padding: "10px 12px 6px" }}>
            <Cake size={16} />
            <strong>近期生日</strong>
            <span className="spacer" />
            <span className="muted small">血亲/旁亲 · {WINDOW_DAYS} 天</span>
          </div>
          {!items ? (
            <div className="muted small" style={{ padding: 12 }}>加载中…</div>
          ) : items.length === 0 ? (
            <div className="muted small" style={{ padding: 12 }}>
              {birthdayMeta.bound ? `近 ${WINDOW_DAYS} 天没有血亲旁亲过生日` : (birthdayMeta.reason || "账号尚未绑定人物")}
            </div>
          ) : (
            <ul className="notice-list">
              {items.map((i) => (
                <li key={i.id}>
                  <Link to={`/persons/${i.person.id}`} onClick={() => setOpen(false)} className={seen.has(i.id) ? "" : "unread"}>
                    <Avatar person={i.person} size={36} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {i.is_self ? "我" : i.person.name}
                        </strong>
                        <span className={`badge ${i.calendar === "lunar" ? "warning" : "primary"}`}>
                          {i.calendar === "lunar" ? "农历" : "公历"}
                        </span>
                        {i.age && <span className="muted small">{i.age} 岁</span>}
                      </div>
                      <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dateText(i.date)}
                        {i.calendar === "lunar" && ` · ${i.birth_text.replace(/^..年/, "").replace(/（\d+）$/, "")}`}
                      </div>
                    </div>
                    <span className={`badge ${i.days_until === 0 ? "danger" : ""}`} style={{ whiteSpace: "nowrap" }}>
                      {whenText(i.days_until)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
