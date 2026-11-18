import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Crosshair,
  Home,
  Info,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Tag,
  Waypoints,
  X,
} from "lucide-react";
import { get, qs } from "../api";
import { useAuth } from "../auth";
import { avatarOf, GENDER_COLOR } from "../avatars";
import type { NetworkData, PersonBrief } from "../types";
import { useThemeVersion, cssVar, prefersReducedMotion } from "../theme";
import PersonPanel from "../components/PersonPanel";
import { PersonPicker, Seal } from "../ui";
import {
  computeHops,
  edgeGeometry,
  edgeKey,
  layoutAround,
  layoutInitial,
  generationOffset,
  neighborKind,
  type AtlasEdge,
  type AtlasGraph,
  type AtlasNode,
} from "../atlas/layout";

type Crumb = { id: number; name: string };
type View = { x: number; y: number; k: number };

const RECENT_KEY = "zp.centers";

function readRecent(): Crumb[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Crumb[];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "number").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function yearsOf(n: { birth_year: string | null; is_living: boolean; birth_date?: string | null; death_date?: string | null }) {
  const b = n.birth_year || (n.birth_date ? n.birth_date.slice(0, 4) : "");
  const d = n.death_date ? n.death_date.slice(0, 4) : "";
  if (!b && !d) return n.is_living ? "" : "生卒不详";
  if (n.is_living) return b;
  if (!d) return b ? `${b} 年生` : "生卒不详";
  return `${b || "?"}–${d}`;
}

function metaOf(n: AtlasNode) {
  const years = yearsOf(n);
  if (years) return years;
  if (n.generation !== null && n.generation !== undefined) return `第 ${n.generation + 1} 世`;
  return "谱中人物";
}

function makeGraph(data: NetworkData): AtlasGraph {
  const center = data.nodes.find((n) => n.id === data.center);
  if (!center) throw new Error("未找到中心人物");
  const positions = layoutInitial(center, data.nodes, data.edges);
  const centerGen = center.generation ?? null;
  const now = Date.now();
  const nodes = new Map<number, AtlasNode>();
  data.nodes.forEach((n, i) => {
    const pos = positions.get(n.id) || { x: 0, y: 0 };
    const kind = neighborKind(data.edges, data.center, n.id);
    nodes.set(n.id, {
      ...n,
      x: pos.x,
      y: pos.y,
      gen: generationOffset(n, centerGen, kind),
      hops: n.id === data.center ? 0 : 1,
      expanded: n.id === data.center,
      loading: false,
      kinToCenter: n.id === data.center ? null : n.kin_term,
      entranceDelay: n.id === data.center ? 0 : 90 + i * 55,
      addedAt: now,
    });
  });
  const edges = new Map<string, AtlasEdge>();
  for (const e of data.edges) {
    edges.set(edgeKey(e), { ...e, key: edgeKey(e), addedAt: now });
  }
  return { center: data.center, centerGen, nodes, edges };
}

function mergeNeighborhood(
  graph: AtlasGraph,
  data: NetworkData,
  parentId: number,
  minSep?: number,
): AtlasGraph {
  const nodes = new Map(graph.nodes);
  const edges = new Map(graph.edges);
  const parent = nodes.get(parentId);
  if (!parent) return graph;
  const existing = new Set(nodes.keys());
  const fresh = data.nodes.filter((n) => !existing.has(n.id));
  const positions = layoutAround(parent, fresh, nodes, data.edges, graph.centerGen, minSep);
  const now = Date.now();
  fresh.forEach((n, i) => {
    const pos = positions.get(n.id);
    if (!pos) return;
    const kind = neighborKind(data.edges, parentId, n.id);
    nodes.set(n.id, {
      ...n,
      x: pos.x,
      y: pos.y,
      gen: generationOffset(n, graph.centerGen, kind),
      hops: parent.hops + 1,
      expanded: false,
      loading: false,
      kinToCenter: null,
      entranceDelay: 40 + i * 70,
      fromX: parent.x - pos.x,
      fromY: parent.y - pos.y,
      addedAt: now,
    });
  });
  // 标记被展开的节点
  const p = nodes.get(parentId);
  if (p) nodes.set(parentId, { ...p, expanded: true, loading: false });
  for (const e of data.edges) {
    const key = edgeKey(e);
    if (edges.has(key)) continue;
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
    edges.set(key, { ...e, key, addedAt: now });
  }
  const hops = computeHops(graph.center, nodes, edges);
  for (const [id, h] of hops) {
    const n = nodes.get(id);
    if (n && n.hops !== h) nodes.set(id, { ...n, hops: h });
  }
  return { ...graph, nodes, edges };
}

export default function Network() {
  const { user, siteName } = useAuth();
  const me = user?.person_id ?? null;
  const [params, setParams] = useSearchParams();
  const themeVersion = useThemeVersion();

  const centerParam = Number(params.get("center")) || 0;
  const center = centerParam || me || 0;

  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [error, setError] = useState("");
  const [loadingCenter, setLoadingCenter] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [recent, setRecent] = useState<Crumb[]>(readRecent);
  const [centerName, setCenterName] = useState("");
  const [total, setTotal] = useState(0);
  const [loadingName, setLoadingName] = useState("");
  const [loadNotice, setLoadNotice] = useState<{ id: number; name: string; added: number; key: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [showLabels, setShowLabels] = useState(false);
  const [showOuter, setShowOuter] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 选择谱心页的候选
  const [elder, setElder] = useState<PersonBrief | null>(null);
  const [living, setLiving] = useState<PersonBrief | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const graphRef = useRef<AtlasGraph | null>(null);
  const genRef = useRef(0);
  const pendingRef = useRef<Set<number>>(new Set());
  const loadingRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const hudTickRef = useRef(0);
  const suppressClickRef = useRef(false);
  const miniMapRef = useRef<{ minX: number; minY: number; scale: number; ox: number; oy: number } | null>(null);
  const paletteRef = useRef({
    ink: "#857a68",
    ink2: "#574e40",
    cinnabar: "#a53a29",
    paper: "#f2ebdc",
    line: "#d7cab4",
    male: "#40587a",
    female: "#9a4f5f",
    deceased: "#4e6b70",
  });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ lastX: number; lastY: number; lastT: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const inertiaRef = useRef<number | null>(null);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaRef.current !== null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  }, []);

  /* ---------------- 小地图 ---------------- */
  const drawMinimap = useCallback(() => {
    const canvas = miniRef.current;
    const g = graphRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth || 182;
    const ch = canvas.clientHeight || 108;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!g || g.nodes.size === 0) {
      miniMapRef.current = null;
      return;
    }
    const nodes = [...g.nodes.values()];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const pad = 120;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min((cw - 10) / bw, (ch - 10) / bh);
    const ox = (cw - bw * scale) / 2;
    const oy = (ch - bh * scale) / 2;
    miniMapRef.current = { minX, minY, scale, ox, oy };
    const pal = paletteRef.current;
    // 连线：极淡的墨
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const e of g.edges.values()) {
      const a = g.nodes.get(e.source);
      const b = g.nodes.get(e.target);
      if (!a || !b) continue;
      ctx.moveTo(ox + (a.x - minX) * scale, oy + (a.y - minY) * scale);
      ctx.lineTo(ox + (b.x - minX) * scale, oy + (b.y - minY) * scale);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 人物点
    for (const n of nodes) {
      const x = ox + (n.x - minX) * scale;
      const y = oy + (n.y - minY) * scale;
      ctx.beginPath();
      ctx.arc(x, y, n.id === g.center ? 3 : n.loading ? 2.2 : 1.4, 0, Math.PI * 2);
      ctx.fillStyle =
        n.id === g.center
          ? pal.cinnabar
          : n.loading
            ? pal.cinnabar
            : !n.is_living
              ? pal.deceased
              : GENDER_COLOR[n.gender] || pal.ink;
      ctx.fill();
    }
    // 视口框
    const v = viewRef.current;
    const x1 = ox + ((0 - v.x) / v.k - minX) * scale;
    const y1 = oy + ((0 - v.y) / v.k - minY) * scale;
    const x2 = ox + ((cw - v.x) / v.k - minX) * scale;
    const y2 = oy + ((ch - v.y) / v.k - minY) * scale;
    ctx.strokeStyle = pal.cinnabar;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y1, Math.max(2, x2 - x1), Math.max(2, y2 - y1));
    ctx.globalAlpha = 1;
  }, []);

  const applyView = useCallback(() => {
    const v = viewRef.current;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) scale(${v.k.toFixed(4)})`;
    }
    const stage = stageRef.current;
    if (stage) stage.dataset.zoom = v.k < 0.55 ? "far" : v.k < 0.9 ? "mid" : "near";
    const now = performance.now();
    if (now - hudTickRef.current > 110) {
      hudTickRef.current = now;
      setZoomPct(Math.round(v.k * 100));
    }
    drawMinimap();
  }, [drawMinimap]);

  const animateTo = useCallback(
    (target: View, duration = 620) => {
      cancelAnim();
      if (prefersReducedMotion() || duration <= 0) {
        viewRef.current = target;
        applyView();
        return;
      }
      const start = { ...viewRef.current };
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        viewRef.current = {
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          k: start.k + (target.k - start.k) * e,
        };
        applyView();
        if (p < 1) animRef.current = requestAnimationFrame(step);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [applyView, cancelAnim],
  );

  /** 缩放到 stage 内某个点 */
  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = viewRef.current;
      const k = Math.min(2.4, Math.max(0.16, v.k * factor));
      const f = k / v.k;
      viewRef.current = { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      applyView();
    },
    [applyView],
  );

  const fitView = useCallback(
    (animate = true) => {
      const g = graphRef.current;
      if (!g || g.nodes.size === 0) return;
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      // 手机屏幕窄：不强行把整排族人塞进来，先聚焦谱心，附近的人由拖动逐步展开
      if (w < 720) {
        const c = g.nodes.get(g.center);
        if (c) {
          const k = 0.75;
          animateTo({ k, x: w / 2 - c.x * k, y: h * 0.47 - c.y * k }, animate ? 620 : 0);
          return;
        }
      }
      const nodes = [...g.nodes.values()];
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const n of nodes) {
        const r = n.id === g.center ? 98 : 72;
        x1 = Math.min(x1, n.x - r);
        y1 = Math.min(y1, n.y - r);
        x2 = Math.max(x2, n.x + r);
        y2 = Math.max(y2, n.y + r);
      }
      const padX = w < 720 ? 44 : 96;
      const padTop = w < 720 ? 76 : 86;
      const padBottom = w < 720 ? 112 : 110;
      const k = Math.min(
        1.16,
        Math.max(0.18, Math.min((w - padX * 2) / Math.max(1, x2 - x1), (h - padTop - padBottom) / Math.max(1, y2 - y1))),
      );
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      animateTo({ k, x: w / 2 - cx * k, y: (h + padTop - padBottom) / 2 - cy * k }, animate ? 700 : 0);
    },
    [animateTo],
  );

  const recenter = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const c = g.nodes.get(g.center);
    const { w, h } = sizeRef.current;
    if (!c || !w || !h) return;
    const k = Math.max(viewRef.current.k, 0.9);
    animateTo({ k, x: w / 2 - c.x * k, y: h / 2 - c.y * k }, 560);
  }, [animateTo]);

  const rememberCenter = useCallback((p: Crumb) => {
    setRecent((prev) => {
      const next = [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 5);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /* ---------------- 数据加载 ---------------- */
  const loadCenter = useCallback(
    (id: number) => {
      const gen = ++genRef.current;
      setLoadingCenter(true);
      setError("");
      setSelected(null);
      setHovered(null);
      setGuideOpen(false);
      pendingRef.current.clear();
      loadingRef.current = 0;
      setLoadingName("");
      setLoadNotice(null);
      graphRef.current = null;
      setGraph(null);
      get<NetworkData>(`/api/graph/network?${qs({ center: id, depth: 1 })}`)
        .then((data) => {
          if (gen !== genRef.current) return;
          const g = makeGraph(data);
          graphRef.current = g;
          setGraph(g);
          setCenterName(g.nodes.get(g.center)?.name || "");
          setTrail((t) => {
            const i = t.findIndex((x) => x.id === g.center);
            if (i >= 0) return t.slice(0, i + 1);
            return [...t, { id: g.center, name: g.nodes.get(g.center)?.name || "" }].slice(-10);
          });
          rememberCenter({ id: g.center, name: g.nodes.get(g.center)?.name || "" });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (gen !== genRef.current) return;
              fitView(false);
              setLoadingCenter(false);
            });
          });
        })
        .catch((e) => {
          if (gen !== genRef.current) return;
          setError((e as Error).message);
          setLoadingCenter(false);
        });
    },
    [fitView, rememberCenter],
  );

  const changeCenter = useCallback(
    (id: number, name?: string) => {
      if (name) setCenterName(name);
      const next = new URLSearchParams(params);
      next.set("center", String(id));
      setParams(next);
    },
    [params, setParams],
  );

  // URL 中的谱心变化 → 重新展卷
  useEffect(() => {
    if (!center) {
      genRef.current++;
      pendingRef.current.clear();
      loadingRef.current = 0;
      stopInertia();
      cancelAnim();
      graphRef.current = null;
      setGraph(null);
      setLoadingCenter(false);
      setCenterName("");
      setTrail([]);
      setSelected(null);
      setHovered(null);
      setLoadingName("");
      setLoadNotice(null);
      setZoomPct(100);
      return;
    }
    loadCenter(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, reloadKey]);

  // 卸载后忽略未返回的请求
  useEffect(() => {
    return () => {
      genRef.current++;
      if (inertiaRef.current !== null) cancelAnimationFrame(inertiaRef.current);
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, []);

  /* ---------------- 懒加载 ---------------- */
  const patchNode = useCallback((id: number, patch: Partial<AtlasNode>) => {
    const g = graphRef.current;
    if (!g) return;
    const n = g.nodes.get(id);
    if (!n) return;
    const nodes = new Map(g.nodes);
    nodes.set(id, { ...n, ...patch });
    const next = { ...g, nodes };
    graphRef.current = next;
    setGraph(next);
  }, []);

  const expandNode = useCallback(
    async (id: number): Promise<number> => {
      const g = graphRef.current;
      if (!g) return 0;
      const node = g.nodes.get(id);
      if (!node || node.expanded || pendingRef.current.has(id)) return 0;
      if (g.nodes.size > 640) return 0;
      pendingRef.current.add(id);
      loadingRef.current++;
      patchNode(id, { loading: true });
      setLoadingName(node.name);
      const gen = genRef.current;
      let added = 0;
      try {
        // 刻意放慢一点，让新的人物像墨迹一样一层层浮现
        await sleep(150 + Math.random() * 90);
        const data = await get<NetworkData>(`/api/graph/network?${qs({ center: id, depth: 1 })}`);
        if (gen !== genRef.current) return 0;
        const current = graphRef.current;
        if (!current) return 0;
        const before = current.nodes.size;
        const next = mergeNeighborhood(current, data, id);
        graphRef.current = next;
        setGraph(next);
        added = next.nodes.size - before;
        if (added > 0) {
          const key = Date.now();
          setLoadNotice({ id, name: node.name, added, key });
          window.setTimeout(() => setLoadNotice((n) => (n && n.key === key ? null : n)), 3000);
        }
      } catch {
        if (gen === genRef.current) patchNode(id, { loading: false });
      } finally {
        pendingRef.current.delete(id);
        loadingRef.current = Math.max(0, loadingRef.current - 1);
        if (loadingRef.current === 0) setLoadingName("");
        const latest = graphRef.current?.nodes.get(id);
        if (latest?.loading) patchNode(id, { loading: false });
      }
      return added;
    },
    [patchNode],
  );

  /* ---------------- 尺寸 / 主题 / 统计 ---------------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
      drawMinimap();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawMinimap, center]);

  useEffect(() => {
    paletteRef.current = {
      ink: cssVar("--ink-3") || "#857a68",
      ink2: cssVar("--ink-2") || "#574e40",
      cinnabar: cssVar("--cinnabar") || "#a53a29",
      paper: cssVar("--paper") || "#f2ebdc",
      line: cssVar("--line") || "#d7cab4",
      male: cssVar("--male") || "#40587a",
      female: cssVar("--female") || "#9a4f5f",
      deceased: cssVar("--deceased") || "#4e6b70",
    };
    drawMinimap();
  }, [themeVersion, drawMinimap]);

  useEffect(() => {
    drawMinimap();
  }, [graph, drawMinimap]);

  useEffect(() => {
    drawMinimap();
  }, [legendOpen, drawMinimap]);

  useEffect(() => {
    get<{ persons: number }>("/api/graph/stats")
      .then((s) => setTotal(s.persons))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (center) return;
    setSuggestLoading(true);
    get<{ items: (PersonBrief & { death_date?: string | null })[] }>("/api/persons?size=500")
      .then((r) => {
        const sorted = [...r.items].sort((a, b) => a.id - b.id);
        setElder(sorted[0] || null);
        const alive = r.items
          .filter((p) => p.is_living && p.birth_year)
          .sort((a, b) => (a.birth_year || "").localeCompare(b.birth_year || ""));
        setLiving(alive[0] || null);
      })
      .catch(() => {})
      .finally(() => setSuggestLoading(false));
  }, [center]);

  useEffect(() => {
    document.title = centerName ? `${centerName} · ${siteName || "纸谱"}` : siteName || "纸谱 · 家族关系图谱";
    return () => {
      document.title = siteName || "纸谱 · 家族关系图谱";
    };
  }, [centerName, siteName]);

  /* ---------------- 平移 / 缩放 ---------------- */
  const startInertia = useCallback(
    (drag: { vx: number; vy: number }) => {
      let vx = drag.vx;
      let vy = drag.vy;
      if (Math.hypot(vx, vy) < 0.06) return;
      let last = performance.now();
      const step = (t: number) => {
        const dt = Math.min(34, t - last);
        last = t;
        const v = viewRef.current;
        viewRef.current = { ...v, x: v.x + vx * dt, y: v.y + vy * dt };
        applyView();
        const decay = Math.pow(0.9, dt / 16);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) > 0.02) {
          inertiaRef.current = requestAnimationFrame(step);
        } else {
          inertiaRef.current = null;
        }
      };
      inertiaRef.current = requestAnimationFrame(step);
    },
    [applyView],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stopInertia();
    cancelAnim();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragRef.current = { lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), vx: 0, vy: 0, moved: false };
      pinchRef.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
      dragRef.current = null;
    }
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (pinchRef.current) {
        const rect = stageRef.current?.getBoundingClientRect();
        const dx = mx - pinchRef.current.mx;
        const dy = my - pinchRef.current.my;
        if (rect) zoomAt(mx - rect.left, my - rect.top, dist / Math.max(1, pinchRef.current.dist));
        viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
        applyView();
      }
      pinchRef.current = { dist, mx, my };
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      drag.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!drag.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.vx = drag.vx * 0.65 + (dx / dt) * 0.35;
    drag.vy = drag.vy * 0.65 + (dy / dt) * 0.35;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.lastT = now;
    const v = viewRef.current;
    viewRef.current = { ...v, x: v.x + dx, y: v.y + dy };
    applyView();
    setDragging(true);
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const wasMoved = !!drag?.moved;
    pointers.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
      if (drag && wasMoved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
        startInertia(drag);
      }
    } else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      dragRef.current = { lastX: p.x, lastY: p.y, lastT: performance.now(), vx: 0, vy: 0, moved: true };
    }
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !center) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      // 右侧人物笺、说明面板内部保留自己的滚动
      if (target?.closest(".atlas-drawer, .atlas-guide, .atlas-intro")) return;
      e.preventDefault();
      stopInertia();
      cancelAnim();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.00145);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, stopInertia, cancelAnim, center]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setSelected(null);
        setGuideOpen(false);
      } else if (e.key === "+" || e.key === "=") {
        const { w, h } = sizeRef.current;
        zoomAt(w / 2, h / 2, 1.2);
      } else if (e.key === "-" || e.key === "_") {
        const { w, h } = sizeRef.current;
        zoomAt(w / 2, h / 2, 0.83);
      } else if (e.key === "0") {
        fitView(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, fitView]);

  const onNodeClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelected(id);
    const n = graphRef.current?.nodes.get(id);
    if (n && !n.expanded && id !== graphRef.current?.center) void expandNode(id);
  };

  const onNodeDoubleClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (id !== graphRef.current?.center) changeCenter(id, graphRef.current?.nodes.get(id)?.name);
  };

  const onMiniClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mm = miniMapRef.current;
    const canvas = miniRef.current;
    if (!mm || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wx = mm.minX + (px - mm.ox) / mm.scale;
    const wy = mm.minY + (py - mm.oy) / mm.scale;
    const { w, h } = sizeRef.current;
    const k = viewRef.current.k;
    animateTo({ k, x: w / 2 - wx * k, y: h / 2 - wy * k }, 420);
  };

  const hoverSet = useMemo(() => {
    if (hovered === null || !graph) return null;
    const set = new Set<number>([hovered]);
    for (const e of graph.edges.values()) {
      if (e.source === hovered) set.add(e.target);
      if (e.target === hovered) set.add(e.source);
    }
    return set;
  }, [hovered, graph]);

  const loaded = graph?.nodes.size ?? 0;
  const progress = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;

  /* ---------------- 选择谱心页 ---------------- */
  if (!center) {
    return (
      <div className="atlas" key="atlas-intro">
        <div className="atlas-bg" />
        <div className="atlas-intro">
          <div className="atlas-intro-inner">
            <div className="intro-dots" />
            <div className="intro-mark">
              <Seal char="谱" size={44} />
              <div>
                <div className="intro-kicker">以人为中心 · 展开一族</div>
                <div className="muted small" style={{ letterSpacing: ".12em" }}>
                  纸谱 · 谱系桌面
                </div>
              </div>
            </div>
            <h1>
              以谁为<em>谱心</em>？
            </h1>
            <p className="intro-lead">
              选定一位人物，先看其一度亲缘。拖动画布向外，周围的人物会循着墨线一点点浮现；双击任一人物，即可换一位谱心。
            </p>
            <div className="intro-search">
              <PersonPicker
                autoFocus
                placeholder="搜索姓名 / 字 / 号 / 曾用名"
                ariaLabel="搜索人物作为谱心"
                onChange={(p) => p && changeCenter(p.id, p.name)}
              />
            </div>
            <div className="intro-suggest">
              <span className="label">可从</span>
              {user?.person && (
                <button onClick={() => changeCenter(user.person!.id, user.person!.name)}>
                  我 · {user.person.name}
                </button>
              )}
              {elder && (
                <button onClick={() => changeCenter(elder.id, elder.name)}>
                  始祖 · {elder.name}
                  {elder.birth_year ? `（${elder.birth_year}）` : ""}
                </button>
              )}
              {living && living.id !== elder?.id && (
                <button onClick={() => changeCenter(living.id, living.name)}>
                  在世最长者 · {living.name}
                </button>
              )}
              {recent.map((r) => (
                <button key={r.id} onClick={() => changeCenter(r.id, r.name)}>
                  最近 · {r.name}
                </button>
              ))}
              {suggestLoading && <span className="muted small">正在翻检谱册…</span>}
            </div>
            <div className="intro-foot">
              <span>谱中 {total ? `${total} 人` : "人物"}，一世一系</span>
              <span>拖动 · 缩放 · 点人展开</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !graph) {
    return (
      <div className="atlas" key="atlas-error">
        <div className="atlas-bg" />
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div className="paper-panel" style={{ padding: 34, minWidth: 320, textAlign: "center" }}>
            <Seal char="误" size={40} />
            <p style={{ margin: "14px 0 16px", color: "var(--ink-2)" }}>{error}</p>
            <button className="btn btn-primary" onClick={() => setReloadKey((k) => k + 1)}>
              重新展卷
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`atlas ${showLabels ? "show-all-labels" : ""} ${showOuter ? "show-outer" : ""}`} key="atlas-graph">
      <div className="atlas-bg" />
      <div
        ref={stageRef}
        className={`atlas-stage ${dragging ? "is-dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={(e) => {
          if (e.target === e.currentTarget && !suppressClickRef.current) setSelected(null);
        }}
        role="application"
        aria-label="人物关系图谱，可拖动画布、滚轮缩放"
      >
        <div className="atlas-world" ref={worldRef}>
          <svg className="atlas-edges" aria-hidden="true">
            <defs>
              <marker
                id="atlas-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
              </marker>
            </defs>

            {graph && graph.nodes.size > 1 && (
              <circle className="atlas-center-halo" cx={0} cy={0} r={122} aria-hidden="true" />
            )}

            {graph &&
              [...graph.edges.values()].map((e) => {
                const a = graph.nodes.get(e.source);
                const b = graph.nodes.get(e.target);
                if (!a || !b) return null;
                const geo = edgeGeometry(e, a, b, a.id === graph.center ? 48 : 38, b.id === graph.center ? 48 : 38);
                const touchesCenter = e.source === graph.center || e.target === graph.center;
                const hot = hovered !== null && (e.source === hovered || e.target === hovered);
                const dim = hoverSet !== null && !hot;
                const dashed = e.type_code === "sibling" || e.status === "derived" || e.category === "social";
                const cls = [
                  "atlas-edge",
                  e.type_code === "spouse" ? "is-spouse" : "",
                  e.type_code === "sibling" ? "is-sibling" : "",
                  e.status === "derived" ? "is-derived" : "",
                  e.category === "social" ? "is-social" : "",
                  touchesCenter ? "" : "is-outer",
                  !touchesCenter && Math.max(a.hops, b.hops) >= 2 ? "is-deep" : "",
                  hot ? "is-hot" : "",
                  dim ? "is-dim" : "",
                  dashed ? "is-fade" : "is-draw",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <g key={e.key}>
                    <path
                      className={cls}
                      d={geo.d}
                      pathLength={dashed ? undefined : 1}
                      markerEnd={e.type_code === "parent" || e.type_code === "adoptive" || e.type_code === "step" ? "url(#atlas-arrow)" : undefined}
                    />
                    {geo.knot && (
                      <g className="atlas-spouse-knot-group">
                        <circle className="atlas-spouse-knot" cx={geo.knot.x} cy={geo.knot.y} r={3.6} />
                        <circle className="atlas-spouse-knot-inner" cx={geo.knot.x} cy={geo.knot.y} r={1.3} />
                      </g>
                    )}
                    <text
                      className={`atlas-edge-label ${touchesCenter ? "is-center-label" : "is-outer-label"} ${hot ? "is-hot" : ""}`}
                      x={geo.lx}
                      y={geo.ly}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {e.status === "pending" ? `${e.label}·待确认` : e.label}
                    </text>
                  </g>
                );
              })}

            {graph &&
              [...graph.nodes.values()]
                .filter((n) => n.loading)
                .map((n) => (
                  <g key={`rip-${n.id}`} transform={`translate(${n.x},${n.y})`} aria-hidden="true">
                    <circle className="atlas-expand-ripple" r={84} />
                    <circle className="atlas-expand-ripple" r={84} />
                  </g>
                ))}
          </svg>

          {graph &&
            [...graph.nodes.values()].map((n) => {
              const isCenter = n.id === graph.center;
              const dim = hoverSet !== null && !hoverSet.has(n.id);
              return (
                <div
                  key={n.id}
                  className={[
                    "atlas-node",
                    isCenter ? "is-center" : "",
                    n.is_living ? "" : "is-deceased",
                    `is-${n.gender}`,
                    n.has_account ? "is-account" : "",
                    n.loading ? "is-expanding" : "",
                    n.expanded ? "is-expanded" : "",
                    selected === n.id ? "is-selected" : "",
                    hovered === n.id ? "is-hover" : "",
                    dim ? "is-dim" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: n.x,
                    top: n.y,
                    zIndex: selected === n.id ? 8 : isCenter ? 7 : 3,
                  }}
                  onPointerEnter={() => setHovered(n.id)}
                  onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
                  onClick={(e) => onNodeClick(e, n.id)}
                  onDoubleClick={(e) => onNodeDoubleClick(e, n.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.name}${n.kinToCenter ? `，${n.kinToCenter}` : ""}，${metaOf(n)}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelected(n.id);
                      if (!n.expanded && !isCenter) void expandNode(n.id);
                    }
                  }}
                >
                  <div
                    className="atlas-node-bloom"
                    style={{
                      animationDelay: `${n.entranceDelay ?? 0}ms`,
                      ["--from-x" as string]: `${n.fromX ?? 0}px`,
                      ["--from-y" as string]: `${n.fromY ?? 0}px`,
                    }}
                  >
                    <div className="atlas-node-body">
                      <div className="atlas-node-portrait">
                        <img src={avatarOf(n)} alt="" draggable={false} className={n.avatar ? "custom-avatar" : "default-avatar"} />
                        {!n.is_living && <span className="atlas-node-seal">故</span>}
                        {n.has_account && <span className="atlas-node-account" title="已注册账号" />}
                      </div>
                      {n.kinToCenter && <span className="atlas-node-kin">{n.kinToCenter}</span>}
                      <div className="atlas-node-name" title={n.name}>
                        {n.name}
                      </div>
                      <div className="atlas-node-meta">{metaOf(n)}</div>
                      {isCenter && <span className="atlas-center-seal">谱 心</span>}
                      {!n.expanded && !isCenter && <span className="atlas-node-more" title="点击人物加载一跳亲缘">+</span>}
                    </div>
                  </div>
                </div>
              );
            })}

          {loadNotice && graph && (() => {
            const n = graph.nodes.get(loadNotice.id);
            if (!n) return null;
            return (
              <div key={loadNotice.key} className="atlas-notice" style={{ left: n.x, top: n.y - 76 }} aria-live="polite">
                <b>+{loadNotice.added}</b>
                <span>{loadNotice.name}的亲缘</span>
              </div>
            );
          })()}
        </div>
      </div>

      {loadingCenter && (
        <div className="atlas-veil">
          <Seal char="谱" size={54} />
          <div className="veil-text">正在展卷</div>
          <div className="veil-sub">以 {centerName || "谱心"} 为中心，收拢一度亲缘</div>
        </div>
      )}

      <div className="atlas-hud">
        <div className="atlas-top">
          <div className="atlas-crumb">
            <span className="crumb-label">谱心</span>
            <div className="crumb-trail">
              {trail.slice(-4).map((c, i) => (
                <span key={c.id} className="row" style={{ gap: 0 }}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <button
                    aria-current={c.id === center ? "true" : undefined}
                    onClick={() => {
                      if (c.id !== center) changeCenter(c.id, c.name);
                    }}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
            <span className="crumb-count">
              {loaded}
              {total ? ` / ${total}` : ""}
            </span>
          </div>
          <div className="atlas-tools">
            {me && center !== me && (
              <button className="atlas-tool" onClick={() => changeCenter(me, user?.person?.name)} title="回到我">
                <Home />
                <span>我的谱心</span>
              </button>
            )}
            <button
              className="atlas-tool"
              aria-pressed={showLabels}
              onClick={() => setShowLabels((s) => !s)}
              title="显示全部关系称谓"
            >
              <Tag />
              <span>称谓</span>
            </button>
            <button
              className="atlas-tool"
              aria-pressed={showOuter}
              onClick={() => setShowOuter((s) => !s)}
              title="显示非谱心直接关系（旁支）"
            >
              <Waypoints />
              <span>旁支</span>
            </button>
            <button className="atlas-tool" onClick={() => fitView(true)} title="全览已展开的人物">
              <Maximize2 />
              <span>全览</span>
            </button>
            <button className={`atlas-tool ${guideOpen ? "active" : ""}`} aria-pressed={guideOpen} onClick={() => setGuideOpen((o) => !o)} title="使用说明">
              <Info />
              <span>说明</span>
            </button>
          </div>
        </div>

        {legendOpen ? (
          <div className="atlas-legend">
            <div className="atlas-legend-head">
              <strong>图 例</strong>
              <span className="spacer" />
              <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="收起图例" onClick={() => setLegendOpen(false)}>
                <Minus size={12} />
              </button>
            </div>
            <div className="atlas-legend-row">
              <span className="line-sample" style={{ color: "var(--kin)" }} /> 亲子 · 墨线
            </div>
            <div className="atlas-legend-row">
              <span className="line-sample" style={{ color: "var(--cinnabar)" }} /> 配偶 · 朱线
            </div>
            <div className="atlas-legend-row">
              <span className="line-sample dashed" style={{ color: "var(--indigo)" }} /> 兄弟姐妹 · 虚线
            </div>
            <div className="atlas-legend-row">
              <span className="line-sample dashed" style={{ color: "var(--social)" }} /> 社会关系 · 茶线
            </div>
            <div className="atlas-legend-row">
              <span className="dot" style={{ background: GENDER_COLOR.male }} /> 男
              <span className="dot" style={{ background: GENDER_COLOR.female, marginLeft: 8 }} /> 女
              <span className="dot" style={{ background: GENDER_COLOR.unknown, marginLeft: 8 }} /> 未知
              <span className="dot" style={{ background: "var(--deceased)", marginLeft: 8 }} /> 已故
            </div>
            <div className="atlas-legend-note">朱印为谱心，黛青为已故；展开后出现的旁支以淡线相连，可点「旁支」显示全部。</div>
          </div>
        ) : (
          <button className="atlas-tool" style={{ position: "absolute", left: 16, top: 66 }} onClick={() => setLegendOpen(true)}>
            <Tag /> 图例
          </button>
        )}

        {guideOpen && (
          <div className="atlas-guide paper-panel">
            <div className="row">
              <strong className="serif" style={{ letterSpacing: ".12em" }}>
                展卷说明
              </strong>
              <span className="spacer" />
              <button className="icon-btn" aria-label="关闭说明" onClick={() => setGuideOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <ul>
              <li>拖动画布平移，滚轮或双指缩放。</li>
              <li>单击某个人物，展开 TA 的一跳亲缘；双击可以把 TA 设为新的谱心。</li>
              <li>单击人物查看人物笺；双击即可把 TA 设为新的谱心。</li>
              <li>「称谓」可显示所有关系称谓；「全览」回到所有已展开人物。</li>
            </ul>
          </div>
        )}

        <div className="atlas-controls">
          <button className="atlas-ctrl" aria-label="放大" title="放大" onClick={() => {
            const { w, h } = sizeRef.current;
            zoomAt(w / 2, h / 2, 1.22);
          }}>
            <Plus />
          </button>
          <button className="atlas-ctrl" aria-label="缩小" title="缩小" onClick={() => {
            const { w, h } = sizeRef.current;
            zoomAt(w / 2, h / 2, 0.82);
          }}>
            <Minus />
          </button>
          <button className="atlas-ctrl" aria-label="全览" title="全览" onClick={() => fitView(true)}>
            <Maximize2 />
          </button>
          <button className="atlas-ctrl" aria-label="回到谱心" title="回到谱心" onClick={recenter}>
            <Crosshair />
          </button>
          <button className="atlas-ctrl" aria-label="重新展开" title="重新展开" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw />
          </button>
          <div className="atlas-zoom">{zoomPct}%</div>
        </div>

        {legendOpen && (
          <div className="atlas-minimap">
            <div className="atlas-minimap-head">
              <span>谱 域</span>
              <span>
                {loaded}
                {total ? ` / ${total}` : ""}
              </span>
            </div>
            <canvas ref={miniRef} onClick={onMiniClick} aria-label="谱域缩略图，点击跳转" />
          </div>
        )}

        <div className="atlas-status">
          {loadingName && (
            <div className="atlas-loading">
              <span className="ink-dot" />
              正在展开 {loadingName} 的亲缘
            </div>
          )}
          <div className="atlas-progress">
            <span>已展开</span>
            <b>{loaded}</b>
            <span>{total ? `/ ${total}` : "人"}</span>
            {total > 0 && (
              <span className="bar">
                <i style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
          <div className="atlas-hint">拖动画布 · 滚轮缩放 · 点人物展开一跳</div>
        </div>
      </div>

      {selected !== null && (
        <PersonPanel
          personId={selected}
          centerId={graph?.center}
          view="network"
          onClose={() => setSelected(null)}
          onCenter={(id) => {
            changeCenter(id, graph?.nodes.get(id)?.name);
          }}
          onSelect={(id) => setSelected(id)}
        />
      )}
    </div>
  );
}

