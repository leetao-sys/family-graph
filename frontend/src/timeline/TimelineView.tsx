import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Filter, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { get, qs } from "../api";
import type { PersonBrief } from "../types";
import { Empty, ErrorState, ListSkeleton, PersonPicker } from "../ui";

interface TimelineEvent {
  id: string;
  type: "birth" | "death" | "marriage" | "divorce";
  label: string;
  date: string;
  title: string;
  persons: PersonBrief[];
  place: string | null;
}

const TYPES: { key: TimelineEvent["type"]; label: string; color: string }[] = [
  { key: "birth", label: "出生", color: "#16a34a" },
  { key: "marriage", label: "结婚", color: "#db2777" },
  { key: "divorce", label: "离异", color: "#ea580c" },
  { key: "death", label: "去世", color: "#6b8bc2" },
];
const COLOR = Object.fromEntries(TYPES.map((t) => [t.key, t.color]));

const ML = 48;
const MR = 48;
const ROW_H = 40;
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

/** "1985-06-18" / "1985-06" / "1985" → 小数年份 */
function toYear(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return y + ((m || 1) - 1) / 12 + ((day || 1) - 1) / 365;
}

function textWidth(s: string, px: number) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ]/.test(ch) ? px * 0.56 : px;
  return w;
}

/** 年谱：家族事件（出生、结婚、离异、去世）时间轴，可缩放平移。 */
export default function TimelineView({ onPick }: { onPick: (id: number) => void }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");
  const [types, setTypes] = useState<string[]>(TYPES.map((t) => t.key));
  const [scopePerson, setScopePerson] = useState<PersonBrief | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<[number, number] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; view: [number, number]; moved: boolean } | null>(null);

  useEffect(() => {
    setEvents(null);
    get<{ events: TimelineEvent[] }>(`/api/timeline?${qs({ types: types.join(",") || "none", person_id: scopePerson?.id })}`)
      .then((r) => {
        setEvents(r.events);
        setView(null);
      })
      .catch((e) => setError(e.message));
  }, [types, scopePerson?.id]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [events !== null]);

  const full = useMemo<[number, number]>(() => {
    if (!events?.length) return [1900, 2030];
    const ys = events.map((e) => toYear(e.date));
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = Math.max(2, (hi - lo) * 0.04);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [events]);
  const [t0, t1] = view ?? full;
  const plotW = Math.max(100, size.w - ML - MR);
  const x = (t: number) => ML + ((t - t0) / (t1 - t0)) * plotW;
  const tAt = (px: number) => t0 + ((px - ML) / plotW) * (t1 - t0);
  const axisY = Math.round(size.h * 0.6);

  const zoomAround = (px: number, factor: number) => {
    const center = tAt(px);
    const span = Math.min((full[1] - full[0]) * 1.5, Math.max(1, (t1 - t0) * factor));
    const ratio = (px - ML) / plotW;
    setView([center - span * ratio, center - span * ratio + span]);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(e.clientX - rect.left, Math.exp(e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onDown = (e: RPointerEvent) => {
    drag.current = { x: e.clientX, view: [t0, t1], moved: false };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) (e.currentTarget as Element).setPointerCapture(e.pointerId);
    d.moved = true;
    const dt = (dx / plotW) * (d.view[1] - d.view[0]);
    setView([d.view[0] - dt, d.view[1] - dt]);
  };
  const onUp = () => {
    setTimeout(() => (drag.current = null), 0);
  };

  // —— 刻度 ——
  const span = t1 - t0;
  const step = TICK_STEPS.find((s) => span / s <= Math.max(4, plotW / 80)) ?? 1000;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);

  // —— 事件密度曲线 ——
  const visible = (events || []).filter((e) => {
    const t = toYear(e.date);
    return t >= t0 && t <= t1;
  });
  const density = useMemo(() => {
    if (!events?.length) return "";
    const bw = Math.max(0.5, span / 45);
    const n = 160;
    const ys = events.map((e) => toYear(e.date));
    const vals = Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + (i / n) * span;
      return ys.reduce((s, y) => s + Math.exp(-0.5 * ((t - y) / bw) ** 2), 0);
    });
    const max = Math.max(...vals, 1e-6);
    const pts = vals.map((v, i) => `${(ML + (i / n) * plotW).toFixed(1)},${(axisY - (v / max) * 48).toFixed(1)}`);
    return `M${ML},${axisY} L${pts.join(" L")} L${ML + plotW},${axisY} Z`;
  }, [events, t0, span, plotW, axisY]);

  // —— 标签排布：上下交替，逐行找不重叠的位置 ——
  const placed = useMemo(() => {
    const rowsAbove = Math.max(1, Math.floor((axisY - 80) / ROW_H));
    const rowsBelow = Math.max(1, Math.floor((size.h - axisY - 50) / ROW_H));
    const lastAbove = new Array(rowsAbove).fill(-Infinity);
    const lastBelow = new Array(rowsBelow).fill(-Infinity);
    const out: { ev: TimelineEvent; x: number; side: "above" | "below"; row: number }[] = [];
    const sorted = [...visible].sort((a, b) => toYear(a.date) - toYear(b.date));
    for (const ev of sorted) {
      const px = x(toYear(ev.date));
      const w = Math.max(textWidth(ev.title, 13), textWidth(ev.date, 12)) + 14;
      let done = false;
      for (let k = 0; k < Math.max(rowsAbove, rowsBelow) && !done; k++) {
        for (const side of ["above", "below"] as const) {
          const last = side === "above" ? lastAbove : lastBelow;
          if (k < last.length && px >= last[k]) {
            last[k] = px + w;
            out.push({ ev, x: px, side, row: k });
            done = true;
            break;
          }
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length, t0, t1, size.w, size.h, events]);

  if (error) return <ErrorState message={error} />;

  return (
    <div className="timeline-wrap">
      <div className="row" style={{ padding: "12px 16px", gap: 8, position: "relative" }}>
        <button className={`btn btn-sm ${types.length < TYPES.length || scopePerson ? "btn-primary" : ""}`} onClick={() => setShowFilter((s) => !s)} aria-expanded={showFilter}>
          <Filter size={14} /> 筛选
        </button>
        <div className="row wrap small" style={{ gap: 12 }}>
          {TYPES.filter((t) => types.includes(t.key)).map((t) => (
            <span key={t.key} className="row" style={{ gap: 4 }}>
              <span className="dot" style={{ background: t.color }} /> {t.label}
            </span>
          ))}
        </div>
        {scopePerson && <span className="badge primary">{scopePerson.name} 及近亲</span>}
        <span className="spacer" />
        {events && <span className="muted small">{visible.length} 个事件{visible.length > placed.length ? `，${visible.length - placed.length} 个未显示标签，可放大查看` : ""}</span>}
        {showFilter && (
          <div className="floating" style={{ left: 16, top: 52, width: 320, padding: 14, zIndex: 30 }}>
            <div className="stack" style={{ gap: 10 }}>
              <strong className="small">事件类型</strong>
              <div className="row wrap" style={{ gap: 6 }}>
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    className="chip"
                    aria-pressed={types.includes(t.key)}
                    onClick={() => setTypes((x) => (x.includes(t.key) ? x.filter((k) => k !== t.key) : [...x, t.key]))}
                  >
                    <span className="dot" style={{ background: t.color }} /> {t.label}
                  </button>
                ))}
              </div>
              <strong className="small">只看某人及其近亲（两步以内）</strong>
              <PersonPicker value={scopePerson} onChange={setScopePerson} placeholder="留空为全部人物" />
              <button className="btn btn-sm" onClick={() => setShowFilter(false)}>完成</button>
            </div>
          </div>
        )}
      </div>
      {!events ? (
        <div className="page"><ListSkeleton /></div>
      ) : events.length === 0 ? (
        <Empty title="暂无事件" hint="为人物填写出生、去世日期，或为配偶关系填写开始时间后，会出现在年谱中。" />
      ) : (
        <svg
          ref={svgRef}
          className="timeline-svg"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          role="img"
          aria-label="家族事件年谱"
        >
          <path className="density" d={density} />
          <line className="axis" x1={ML} x2={ML + plotW} y1={axisY} y2={axisY} />
          {ticks.map((t) => (
            <g key={t} className="tick" transform={`translate(${x(t)},${axisY})`}>
              <line y2={6} className="axis" />
              <text y={24} textAnchor="middle">{t}年</text>
            </g>
          ))}
          {placed.map(({ ev, x: px, side, row }) => {
            const titleY = side === "above" ? axisY - 74 - row * ROW_H : axisY + 52 + row * ROW_H;
            const lineEnd = side === "above" ? titleY + 22 : titleY - 13;
            const isActive = active === ev.id;
            return (
              <g key={ev.id}>
                <line className={`leader ${isActive ? "active" : ""}`} x1={px} x2={px} y1={axisY} y2={lineEnd} />
                <g
                  className={`ev-label ${isActive ? "active" : ""}`}
                  onClick={() => {
                    if (drag.current?.moved) return;
                    setActive(ev.id);
                    onPick(ev.persons[0].id);
                  }}
                >
                  <title>{`${ev.title}  ${ev.date}${ev.place ? `  ${ev.place}` : ""}`}</title>
                  <text className="title" x={px + 5} y={titleY}>{ev.title}</text>
                  <text className="date" x={px + 5} y={titleY + 17} style={{ fill: COLOR[ev.type] }}>{ev.date}</text>
                </g>
              </g>
            );
          })}
          {visible.map((ev) => (
            <circle key={ev.id} cx={x(toYear(ev.date))} cy={axisY} r={active === ev.id ? 7 : 5} fill={COLOR[ev.type]} stroke="var(--surface)" strokeWidth={1.5}>
              <title>{`${ev.title}  ${ev.date}`}</title>
            </circle>
          ))}
        </svg>
      )}
      <div className="floating zoom-ctrl">
        <button className="icon-btn" aria-label="放大" title="放大" onClick={() => zoomAround(ML + plotW / 2, 0.6)}><ZoomIn size={18} /></button>
        <button className="icon-btn" aria-label="缩小" title="缩小" onClick={() => zoomAround(ML + plotW / 2, 1.6)}><ZoomOut size={18} /></button>
        <button className="icon-btn" aria-label="显示全部" title="显示全部" onClick={() => setView(null)}><Maximize2 size={18} /></button>
      </div>
    </div>
  );
}
