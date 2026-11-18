import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, ChevronsDown, Download, Home, Maximize, Minus, Plus, X } from "lucide-react";
import { get, qs } from "../api";
import { useAuth } from "../auth";
import { avatarOf, GENDER_COLOR } from "../avatars";
import KinshipCalculator from "../components/KinshipCalculator";
import PersonPanel, { generationText } from "../components/PersonPanel";
import MapView from "../map/MapView";
import TimelineView from "../timeline/TimelineView";
import { CARD_H, CARD_W, layoutTree, ROW_H, type TreeLayout } from "../tree/layout";
import { cssVar } from "../theme";
import type { PersonBrief, TreeData, TreePerson } from "../types";
import { GENDER_LABEL } from "../types";
import { Avatar, Empty, ErrorState, ListSkeleton, PersonPicker, useDebounced, useToast } from "../ui";

type View = { x: number; y: number; k: number };

function years(p: TreePerson) {
  const b = p.birth_date?.slice(0, 4) || p.birth_year;
  const d = p.death_date?.slice(0, 4);
  if (!b && !d) return p.is_living ? "" : "已故";
  return `${b || "?"}–${d || (p.is_living ? "" : "?")}`;
}

export default function Tree() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const me = user?.person_id ?? null;
  const root = Number(params.get("root")) || me;
  const mode = (params.get("mode") as TreeData["mode"]) || "hourglass";
  const gen = Number(params.get("gen")) || 3;
  type Tab = "tree" | "list" | "map" | "timeline";
  const tab = ((params.get("view") as Tab) || "tree") as Tab;
  const setTab = (v: Tab) => {
    const next = new URLSearchParams(params);
    if (v === "tree") next.delete("view");
    else next.set("view", v);
    setParams(next);
  };
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcA, setCalcA] = useState<PersonBrief | null>(null);
  const [calcB, setCalcB] = useState<PersonBrief | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [reload, setReload] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next);
  };

  useEffect(() => {
    if (!root) return;
    let alive = true;
    setError("");
    get<TreeData>(`/api/graph/tree?${qs({ root, mode, gen })}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // 默认只展开到本人、配偶、父母和子女；孙辈及更远的分支先折叠，
        // 卡片上的 + 可以按支逐层展开，避免一进族谱就是一张巨大的全谱。
        if (d.mode === "hourglass" || d.mode === "descendants") {
          setCollapsed(new Set(Object.keys(d.persons).map(Number).filter((id) => id !== d.root)));
        } else {
          setCollapsed(new Set());
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [root, mode, gen, reload]);

  const layout: TreeLayout | null = useMemo(() => (data ? layoutTree(data, collapsed) : null), [data, collapsed]);
  const spousesByPid = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const s of data?.spouses ?? []) {
      if (!m.has(s.a)) m.set(s.a, []);
      if (!m.has(s.b)) m.set(s.b, []);
      m.get(s.a)!.push(s.b);
      m.get(s.b)!.push(s.a);
    }
    return m;
  }, [data]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !layout || !layout.cards.length) return;
    const { x1, y1, x2, y2 } = layout.bounds;
    const w = el.clientWidth - 120;
    const h = el.clientHeight - 40;
    const k = Math.min(1.2, Math.max(0.2, Math.min(w / (x2 - x1), h / (y2 - y1))));
    setView({ k, x: 96 + (w - (x2 - x1) * k) / 2 - x1 * k, y: 20 + (h - (y2 - y1) * k) / 2 - y1 * k });
  }, [layout]);

  const focusOn = useCallback(
    (pid: number) => {
      const el = wrapRef.current;
      const c = layout?.cards.find((c) => c.pid === pid);
      if (!el || !c) return false;
      setView((v) => ({ ...v, x: el.clientWidth / 2 - c.x * v.k, y: el.clientHeight / 2 - c.y * v.k }));
      return true;
    },
    [layout],
  );

  // 就近聚焦：族谱往往很大，先以本人为视觉中心，保持可读的字号；
  // 想看全谱时点右下角「适应屏幕」。
  const focusRoot = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !layout || !data) return;
    const c = layout.cards.find((x) => x.pid === data.root);
    if (!c) return;
    // 以本人为锚点、固定可读字号；家族很大时横向拖动即可继续看，
    // 不在首屏强行塞下所有子女与配偶（那会把字号压得很小）。
    const k = 0.82;
    const offset = el.clientWidth > 820 ? 40 : 0;
    setView({ k, x: el.clientWidth / 2 - c.x * k + offset, y: el.clientHeight / 2 - c.y * k });
  }, [layout, data]);
  const fittedFor = useRef("");
  useEffect(() => {
    if (!layout || !data || tab !== "tree") return;
    const key = `${data.root}|${data.mode}|${data.gen}`;
    if (fittedFor.current !== key) {
      fittedFor.current = key;
      focusRoot();
    }
  }, [layout, data, focusRoot, tab]);

  // —— 平移 / 缩放（鼠标、触控、双指） ——
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinch = useRef<number | null>(null);
  const moved = useRef(false);
  const onPointerDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
  };
  const onPointerMove = (e: RPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch.current) {
        const rect = svgRef.current!.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, dist / lastPinch.current);
      }
      lastPinch.current = dist;
      moved.current = true;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (!moved.current && Math.abs(dx) + Math.abs(dy) > 2) {
      moved.current = true;
      // 开始拖动后才捕获指针，避免影响卡片点击
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
  };
  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.15, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [tab, data]);

  const onCardClick = (pid: number) => {
    if (moved.current) return;
    const p = data?.persons[pid];
    if (!p) return;
    if (calcOpen && pickMode) {
      if (!calcA || (calcA && calcB)) {
        setCalcA(p);
        setCalcB(null);
      } else {
        setCalcB(p);
        setPickMode(false);
      }
      return;
    }
    setSelected(pid);
  };

  const exportPng = async () => {
    if (!svgRef.current || !layout) return;
    try {
      await exportTreePng(svgRef.current, layout);
    } catch {
      toast("error", "导出失败，请重试");
    }
  };

  const hl = new Set(highlight);
  const hlPairs = new Set<string>();
  for (let i = 1; i < highlight.length; i++) {
    hlPairs.add(`${highlight[i - 1]}-${highlight[i]}`);
    hlPairs.add(`${highlight[i]}-${highlight[i - 1]}`);
  }

  if (!root) {
    return (
      <div className="page">
        <Empty
          title="请选择一位人物作为族谱的起点"
          action={
            <div style={{ width: 280 }}>
              <PersonPicker onChange={(p) => p && setParam("root", String(p.id))} autoFocus />
            </div>
          }
        />
      </div>
    );
  }

  const rootPerson = data?.persons[root];

  return (
    <div className="graph-page">
      <div className="toolbar">
        {tab === "tree" && (<>
        <div style={{ width: 200 }}>
          <PersonPicker
            value={rootPerson ?? null}
            onChange={(p) => p && setParam("root", String(p.id))}
            placeholder="选择族谱起点人物"
            ariaLabel="族谱起点人物"
          />
        </div>
        {me && root !== me && (
          <button className="btn btn-sm" onClick={() => setParam("root", String(me))}>
            <Home size={14} /> 回到我
          </button>
        )}
        <div className="segmented" role="group" aria-label="树类型">
          {(
            [
              ["hourglass", "上下三代"],
              ["blood", "血亲旁系"],
              ["ancestors", "祖先"],
              ["descendants", "后代"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setParam("mode", m)}>
              {label}
            </button>
          ))}
        </div>
        <label className="row small">
          <span className="hide-mobile">代数</span>
          <select className="select" style={{ height: 30, width: 72 }} value={gen} onChange={(e) => setParam("gen", e.target.value)} aria-label="上下代数">
            {[1, 2, 3, 4, 5, 6, 8].map((g) => (
              <option key={g} value={g}>
                {g} 代
              </option>
            ))}
          </select>
        </label>
        <button className="icon-btn" title="展开全部已加载世代" aria-label="展开全部已加载世代" onClick={() => setCollapsed(new Set())}>
          <ChevronsDown size={16} />
        </button>
        </>)}
        <span className="spacer" />
        <div className="tabs" style={{ borderBottom: "none" }} role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "tree"} onClick={() => setTab("tree")}>
            世代树
          </button>
          <button className="tab" role="tab" aria-selected={tab === "list"} onClick={() => setTab("list")}>
            人物列表
          </button>
          <button className="tab" role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>
            地图
          </button>
          <button className="tab" role="tab" aria-selected={tab === "timeline"} onClick={() => setTab("timeline")}>
            年谱
          </button>
        </div>
        <button className={`btn btn-sm ${calcOpen ? "btn-primary" : ""}`} onClick={() => setCalcOpen((o) => !o)}>
          <Calculator size={14} /> 称呼计算器
        </button>
        {tab === "tree" && (
          <button className="btn btn-sm hide-mobile" onClick={exportPng} title="导出为 PNG 图片">
            <Download size={14} /> 导出
          </button>
        )}
      </div>

      <div className="canvas-wrap" ref={wrapRef}>
        {error ? (
          <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />
        ) : tab === "map" ? (
          <MapView onPick={(id) => setSelected(id)} focusPersonId={selected} />
        ) : tab === "timeline" ? (
          <TimelineView onPick={(id) => setSelected(id)} />
        ) : tab === "list" ? (
          <PersonList onPick={(id) => setSelected(id)} onRoot={(id) => { setParam("root", String(id)); setTab("tree"); }} />
        ) : !data || !layout ? (
          <div className="page">
            <ListSkeleton />
          </div>
        ) : (
          <>
            <GenRail layout={layout} data={data} view={view} />
            <svg
              ref={svgRef}
              className="tree-svg"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="img"
              aria-label={`${rootPerson?.name || ""}的族谱树`}
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {layout.levels.map((lv) => {
                  const bandX = layout.bounds.x1 - 260;
                  const bandW = Math.max(1, layout.bounds.x2 - layout.bounds.x1 + 520);
                  const bandY = lv * ROW_H - CARD_H / 2 - 24;
                  return (
                    <g key={`band-${lv}`} className={`tree-band ${lv % 2 ? "alt" : ""}`} aria-hidden="true">
                      <rect x={bandX} y={bandY} width={bandW} height={CARD_H + 48} />
                      <line x1={bandX} y1={bandY} x2={bandX + bandW} y2={bandY} />
                    </g>
                  );
                })}

                {layout.links.map((l) => {
                  const lit = hlPairs.has(`${l.ids[0]}-${l.ids[1]}`);
                  const marriage = l.kind.startsWith("marriage");
                  return (
                    <path
                      key={l.key}
                      d={l.d}
                      className={
                        marriage
                          ? `tree-marriage ${l.kind === "marriage-ended" ? "ended" : ""} ${lit ? "tree-link highlight" : ""}`
                          : `tree-link ${l.kind === "adoptive" ? "adoptive" : ""} ${lit ? "highlight" : ""}`
                      }
                      fill="none"
                    />
                  );
                })}


                {layout.cards.map((c) => {
                  const p = data.persons[c.pid];
                  if (!p) return null;
                  const deceased = !p.is_living;
                  const cls = [
                    "tree-card",
                    c.pid === data.root ? "root" : "",
                    p.gender,
                    deceased ? "deceased" : "",
                    hl.has(c.pid) ? "highlight" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const name = p.name.length > 6 ? p.name.slice(0, 6) + "…" : p.name;
                  const subText = [years(p), p.generation_name].filter(Boolean).join(" · ");
                  const sub = subText.length > 16 ? subText.slice(0, 16) + "…" : subText;
                  const spouseIds = spousesByPid.get(c.pid) ?? [];
                  return (
                    <g
                      key={c.key}
                      className={cls}
                      transform={`translate(${c.x - CARD_W / 2},${c.y - CARD_H / 2})`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onCardClick(c.pid)}
                      onKeyDown={(e) => e.key === "Enter" && onCardClick(c.pid)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${p.name}，${GENDER_LABEL[p.gender]}，${years(p)}${deceased ? "，已故" : ""}`}
                    >
                      <g className="tree-card-inner">
                        <rect className="card-shadow" x={1.5} y={2.5} width={CARD_W} height={CARD_H} rx={4} />
                        <rect className="card-bg" width={CARD_W} height={CARD_H} rx={4} />
                        <rect
                          width={3}
                          height={CARD_H - 20}
                          x={0}
                          y={10}
                          rx={1.5}
                          fill={deceased ? "var(--deceased)" : GENDER_COLOR[p.gender]}
                        />
                        <rect className="card-photo-bg" x={8} y={8} width={54} height={54} rx={3} />
                        <clipPath id={`clip-${c.key}`}>
                          <rect x={8} y={8} width={54} height={54} rx={3} />
                        </clipPath>
                        <image
                          href={avatarOf(p)}
                          className={p.avatar ? "custom-avatar" : "default-avatar"}
                          x={8}
                          y={8}
                          width={54}
                          height={54}
                          clipPath={`url(#clip-${c.key})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                        <text className="card-name" x={72} y={31}>
                          {name}
                        </text>
                        <text x={72} y={52} className="sub">
                          {sub}
                        </text>
                        {spouseIds.slice(0, 3).map((sid, i) => {
                          const sp = data.persons[sid];
                          if (!sp) return null;
                          return (
                            <rect
                              key={`sp-${sid}`}
                              className="card-spouse-pill"
                              x={CARD_W - 10 - i * 10}
                              y={-6}
                              width={7}
                              height={4}
                              rx={2}
                              fill={!sp.is_living ? "var(--deceased)" : GENDER_COLOR[sp.gender]}
                            />
                          );
                        })}
                        {deceased && (
                          <g className="card-deceased">
                            <rect x={46} y={2} width={18} height={16} rx={1} />
                            <text x={55} y={13} textAnchor="middle">
                              故
                            </text>
                          </g>
                        )}
                        {c.pid === data.root && <circle className="card-root-dot" cx={10} cy={CARD_H - 10} r={3.2} />}
                        {c.pid === me && (
                          <text className="card-me" x={CARD_W - 8} y={15} textAnchor="end">
                            我
                          </text>
                        )}
                        {c.canCollapse && (
                          <g
                            className="card-collapse"
                            transform={`translate(${CARD_W / 2},${CARD_H})`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (moved.current) return;
                              setCollapsed((s) => {
                                const n = new Set(s);
                                if (n.has(c.pid)) n.delete(c.pid);
                                else n.add(c.pid);
                                return n;
                              });
                            }}
                            role="button"
                            aria-label={c.hasHiddenChildren ? "展开分支" : "折叠分支"}
                          >
                            <circle r={11} />
                            <text textAnchor="middle" y={4}>
                              {c.hasHiddenChildren ? `+${c.hasHiddenChildren}` : "−"}
                            </text>
                          </g>
                        )}
                      </g>
                    </g>
                  );
                })}              </g>
            </svg>
            <div className="tree-legend hide-mobile" aria-label="族谱图例">
              <span className="row" style={{ gap: 4 }}><i className="dot" style={{ background: GENDER_COLOR.male }} />男</span>
              <span className="row" style={{ gap: 4 }}><i className="dot" style={{ background: GENDER_COLOR.female }} />女</span>
              <span className="row" style={{ gap: 4 }}><i className="dot" style={{ background: GENDER_COLOR.unknown }} />未知</span>
              <span className="row" style={{ gap: 4 }}><i className="dot deceased" />已故</span>
              <span className="muted">拖动缩放 · 点 + 展开</span>
            </div>
            <div className="floating zoom-ctrl">
              <button className="icon-btn" aria-label="放大" title="放大" onClick={() => zoomAt((wrapRef.current?.clientWidth || 0) / 2, (wrapRef.current?.clientHeight || 0) / 2, 1.25)}>
                <Plus size={18} />
              </button>
              <button className="icon-btn" aria-label="缩小" title="缩小" onClick={() => zoomAt((wrapRef.current?.clientWidth || 0) / 2, (wrapRef.current?.clientHeight || 0) / 2, 0.8)}>
                <Minus size={18} />
              </button>
              <button className="icon-btn" aria-label="适应屏幕" title="适应屏幕" onClick={fit}>
                <Maximize size={18} />
              </button>
              {me && (
                <button
                  className="icon-btn"
                  aria-label="定位到我"
                  title="定位到我"
                  onClick={() => {
                    if (!focusOn(me)) setParam("root", String(me));
                  }}
                >
                  <Home size={18} />
                </button>
              )}
            </div>
            {layout.cards.length <= 1 && (
              <div className="floating" style={{ top: 16, left: "50%", transform: "translateX(-50%)", padding: "8px 14px" }}>
                <span className="small muted">暂无更多族谱关系，可切换模式或增加代数</span>
              </div>
            )}
          </>
        )}

        {calcOpen && (
          <aside className="side-panel" aria-label="称呼计算器">
            <div className="panel-head">
              <h2 style={{ fontSize: 16 }}>称呼计算器</h2>
              <span className="spacer" />
              <button className="icon-btn" aria-label="关闭" onClick={() => { setCalcOpen(false); setHighlight([]); setPickMode(false); }}>
                <X size={18} />
              </button>
            </div>
            <div className="panel-body">
              <KinshipCalculator
                a={calcA}
                b={calcB}
                onChange={(a, b) => {
                  setCalcA(a);
                  setCalcB(b);
                }}
                pickMode={pickMode}
                onPickMode={setPickMode}
                onPath={setHighlight}
              />
            </div>
          </aside>
        )}
        {!calcOpen && selected && (
          <PersonPanel
            personId={selected}
            centerId={root}
            view="tree"
            onClose={() => setSelected(null)}
            onCenter={(id) => setParam("root", String(id))}
            onSelect={(id) => setSelected(id)}
          />
        )}
      </div>
    </div>
  );
}

/** 左侧世代导航：随画布平移缩放对齐每一行 */
function GenRail({ layout, data, view }: { layout: TreeLayout; data: TreeData; view: View }) {
  const rootGen = data.persons[data.root]?.generation;
  const nameByLevel = new Map<number, string>();
  for (const c of layout.cards) {
    const p = data.persons[c.pid];
    if (p?.generation_name && !nameByLevel.has(c.level)) nameByLevel.set(c.level, p.generation_name);
  }
  return (
    <div className="gen-rail hide-mobile" aria-hidden="true">
      {layout.levels.map((lv) => {
        const y = lv * ROW_H * view.k + view.y;
        const g = rootGen !== null && rootGen !== undefined ? rootGen + lv + 1 : null;
        return (
          <div key={lv} style={{ top: y }}>
            {g ? `第${g}世` : lv === 0 ? "本代" : lv > 0 ? `下${lv}代` : `上${-lv}代`}
            {nameByLevel.get(lv) ? ` · ${nameByLevel.get(lv)}` : ""}
          </div>
        );
      })}
    </div>
  );
}

/** 人物列表：按世代、姓氏浏览，含简单统计 */
function PersonList({ onPick, onRoot }: { onPick: (id: number) => void; onRoot: (id: number) => void }) {
  const [items, setItems] = useState<(PersonBrief & { branch: string | null })[] | null>(null);
  const [q, setQ] = useState("");
  const [genFilter, setGenFilter] = useState("all");
  const dq = useDebounced(q);
  useEffect(() => {
    get<{ items: (PersonBrief & { branch: string | null })[] }>("/api/persons?size=5000").then((r) => setItems(r.items));
  }, []);
  if (!items) return <div className="page"><ListSkeleton /></div>;
  const gens = [...new Set(items.map((p) => p.generation ?? -1))].sort((a, b) => a - b);
  const rows = items
    .filter((p) => (genFilter === "all" ? true : String(p.generation ?? -1) === genFilter))
    .filter((p) => !dq || p.name.includes(dq) || (p.branch || "").includes(dq))
    .sort((a, b) => (a.generation ?? 99) - (b.generation ?? 99) || (a.birth_year || "").localeCompare(b.birth_year || ""));
  const male = items.filter((p) => p.gender === "male").length;
  const female = items.filter((p) => p.gender === "female").length;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto" }}>
      <div className="page stack">
        <div className="stat-grid">
          <div className="card stat"><div className="muted small">人物总数</div><div className="num">{items.length}</div></div>
          <div className="card stat"><div className="muted small">男 / 女</div><div className="num">{male} / {female}</div></div>
          <div className="card stat"><div className="muted small">在世</div><div className="num">{items.filter((p) => p.is_living).length}</div></div>
          <div className="card stat"><div className="muted small">世代数</div><div className="num">{gens.filter((g) => g >= 0).length}</div></div>
        </div>
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 260 }} placeholder="按姓名或分支筛选" value={q} onChange={(e) => setQ(e.target.value)} aria-label="筛选人物" />
          <select className="select" style={{ maxWidth: 160 }} value={genFilter} onChange={(e) => setGenFilter(e.target.value)} aria-label="按世代筛选">
            <option value="all">全部世代</option>
            {gens.map((g) => (
              <option key={g} value={g}>{g < 0 ? "未知" : `第 ${g + 1} 世`}（{items.filter((p) => (p.generation ?? -1) === g).length}）</option>
            ))}
          </select>
          <span className="muted small">{rows.length} 人</span>
        </div>
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr><th>姓名</th><th>性别</th><th>世代</th><th>出生</th><th>分支</th><th /></tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => onPick(p.id)}>
                      <Avatar person={p} size={26} /> {p.name}{!p.is_living && <span className="muted small">（已故）</span>}
                    </button>
                  </td>
                  <td>{GENDER_LABEL[p.gender]}</td>
                  <td>{generationText(p) || "—"}</td>
                  <td>{p.birth_year || "—"}</td>
                  <td>{p.branch || "—"}</td>
                  <td><button className="btn btn-sm" onClick={() => onRoot(p.id)}>查看族谱</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && <div className="muted small" style={{ padding: 12 }}>仅显示前 500 人，请使用筛选缩小范围</div>}
          {rows.length === 0 && <Empty title="没有符合条件的人物" />}
        </div>
      </div>
    </div>
  );
}

/** 导出 PNG：内联计算后的样式与头像，保证导出效果与屏幕一致 */
async function exportTreePng(svg: SVGSVGElement, layout: TreeLayout) {
  const { x1, y1, x2, y2 } = layout.bounds;
  const pad = 24;
  const w = x2 - x1 + pad * 2;
  const h = y2 - y1 + pad * 2;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const srcEls = svg.querySelectorAll("*");
  const dstEls = clone.querySelectorAll("*");
  srcEls.forEach((src, i) => {
    const cs = getComputedStyle(src);
    const dst = dstEls[i] as SVGElement;
    for (const prop of ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family"]) {
      dst.style.setProperty(prop, cs.getPropertyValue(prop));
    }
  });
  const g = clone.querySelector("g")!;
  g.setAttribute("transform", `translate(${pad - x1},${pad - y1})`);
  g.removeAttribute("style");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // 头像转为 data URL，避免画布被跨源图片“污染”
  await Promise.all(
    [...clone.querySelectorAll("image")].map(async (img) => {
      const href = img.getAttribute("href") || "";
      if (href.startsWith("data:")) return;
      try {
        const blob = await (await fetch(href, { credentials: "same-origin" })).blob();
        const dataUrl = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.readAsDataURL(blob);
        });
        img.setAttribute("href", dataUrl);
      } catch {
        img.remove();
      }
    }),
  );
  const bg = cssVar("--paper") || "#f2ebdc";
  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const image = new Image();
  await new Promise<void>((res, rej) => {
    image.onload = () => res();
    image.onerror = rej;
    image.src = url;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0);
  const a = document.createElement("a");
  a.download = `族谱-${new Date().toISOString().slice(0, 10)}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}
