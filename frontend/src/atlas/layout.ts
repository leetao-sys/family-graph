import type { NetEdge, NetNode } from "../types";

export type RelKind = "parent" | "child" | "spouse" | "sibling" | "social" | "other";

export interface AtlasNode extends NetNode {
  x: number;
  y: number;
  /** 相对谱心的世代：-1 上一代，0 同辈，1 下一代 */
  gen: number;
  hops: number;
  expanded: boolean;
  loading: boolean;
  /** 从哪个节点方向生长出来（用于入场动画） */
  fromX?: number;
  fromY?: number;
  /** 与全局中心人物的称谓（仅初始一度关系有） */
  kinToCenter?: string | null;
  /** 入场动画延迟（毫秒） */
  entranceDelay?: number;
  addedAt: number;
}

export interface AtlasEdge extends NetEdge {
  key: string;
  addedAt: number;
}

export interface AtlasGraph {
  center: number;
  centerGen: number | null;
  nodes: Map<number, AtlasNode>;
  edges: Map<string, AtlasEdge>;
}

/** 一行代表一代人；横向间距留足姓名与称谓的空间 */
export const ROW_H = 208;
export const X_GAP = 154;
export const SAME_ROW_GAP = 156;
export const BASE_RADIUS = 252;

export function edgeKey(e: NetEdge): string {
  return String(e.id);
}

export function relationKind(e: NetEdge, center: number): RelKind {
  if (e.type_code === "spouse") return "spouse";
  if (e.type_code === "parent" || e.type_code === "adoptive" || e.type_code === "step") {
    return e.target === center ? "parent" : "child";
  }
  if (e.type_code === "sibling") return "sibling";
  if (e.category === "social") return "social";
  return "other";
}

const KIND_ORDER: RelKind[] = ["parent", "child", "spouse", "sibling", "social", "other"];

export function neighborKind(edges: NetEdge[], center: number, other: number): RelKind {
  const kinds = new Set<RelKind>();
  for (const e of edges) {
    if ((e.source === center && e.target === other) || (e.source === other && e.target === center)) {
      kinds.add(relationKind(e, center));
    }
  }
  for (const k of KIND_ORDER) if (kinds.has(k)) return k;
  return "other";
}

export function kindDelta(kind: RelKind): number {
  return kind === "parent" ? -1 : kind === "child" ? 1 : 0;
}

export function generationOffset(n: NetNode, centerGen: number | null, kind: RelKind): number {
  if (n.generation !== null && n.generation !== undefined && centerGen !== null) {
    return n.generation - centerGen;
  }
  return kindDelta(kind);
}

const birthKey = (n: NetNode) => n.birth_year || "9999";

function sortFor(kind: RelKind) {
  return (a: NetNode, b: NetNode) => {
    if (kind === "child" || kind === "sibling" || kind === "spouse") {
      return birthKey(a).localeCompare(birthKey(b)) || a.id - b.id;
    }
    return a.name.localeCompare(b.name, "zh-CN") || a.id - b.id;
  };
}

interface Point {
  x: number;
  y: number;
}

interface RowItem {
  node: AtlasNode;
  kind: RelKind;
  gen: number;
  desiredX: number;
}

/** 在同一行里找一个不与已有节点重叠的横坐标 */
function findFreeX(rowY: number, desiredX: number, existing: Point[], minSep = X_GAP): number {
  const sameRow = existing.filter((p) => Math.abs(p.y - rowY) < ROW_H * 0.42);
  for (let step = 0; step < 60; step++) {
    const sign = step === 0 ? 1 : step % 2 === 1 ? 1 : -1;
    const distance = step === 0 ? 0 : Math.ceil(step / 2) * minSep;
    const x = desiredX + sign * distance;
    if (sameRow.every((p) => Math.abs(p.x - x) >= minSep)) return x;
  }
  return desiredX + minSep * 60;
}

/** 以谱心为原点，按世代分行安排初始一度关系 */
export function layoutInitial(center: NetNode, nodes: NetNode[], edges: NetEdge[]): Map<number, Point> {
  const centerGen = center.generation ?? null;
  const placed = new Map<number, Point>([[center.id, { x: 0, y: 0 }]]);
  const rows = new Map<number, RowItem[]>();

  for (const n of nodes) {
    if (n.id === center.id) continue;
    const kind = neighborKind(edges, center.id, n.id);
    const gen = generationOffset(n, centerGen, kind);
    const item: RowItem = { node: n as AtlasNode, kind, gen, desiredX: 0 };
    if (!rows.has(gen)) rows.set(gen, []);
    rows.get(gen)!.push(item);
  }

  const spouseSide = center.gender === "female" ? -1 : 1;
  for (const [gen, items] of rows) {
    const rowY = gen * ROW_H;
    if (gen === 0) {
      const spouses = items.filter((i) => i.kind === "spouse").sort((a, b) => sortFor("spouse")(a.node, b.node));
      const siblings = items.filter((i) => i.kind === "sibling").sort((a, b) => sortFor("sibling")(a.node, b.node));
      const rest = items.filter((i) => i.kind !== "spouse" && i.kind !== "sibling");
      spouses.forEach((it, i) => {
        it.desiredX = spouseSide * (SAME_ROW_GAP * 1.02 + i * SAME_ROW_GAP);
      });
      siblings.forEach((it, i) => {
        it.desiredX = -spouseSide * (SAME_ROW_GAP * 1.02 + i * SAME_ROW_GAP);
      });
      rest.forEach((it, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        it.desiredX = side * (SAME_ROW_GAP * 1.2 + Math.floor(i / 2) * X_GAP);
      });
    } else {
      // 同一代里，父母按男左女右；子女按出生顺序；其余按姓名
      const ordered = [...items].sort((a, b) => {
        if (a.kind !== b.kind) return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
        if (gen < 0) {
          const ga = a.node.gender === "male" ? 0 : 1;
          const gb = b.node.gender === "male" ? 0 : 1;
          if (ga !== gb) return ga - gb;
        }
        return sortFor(a.kind)(a.node, b.node);
      });
      ordered.forEach((it, i) => {
        it.desiredX = (i - (ordered.length - 1) / 2) * X_GAP;
      });
    }

    for (const it of items) {
      const existing = [...placed.values()];
      const x = findFreeX(rowY, it.desiredX, existing);
      placed.set(it.node.id, { x, y: rowY });
    }
  }
  return placed;
}

/** 为某个节点新展开的邻居按世代落位 */
export function layoutAround(
  parent: AtlasNode,
  neighbors: NetNode[],
  allNodes: Map<number, AtlasNode>,
  edges: NetEdge[],
  centerGen: number | null,
  minSep = X_GAP,
): Map<number, Point> {
  const placed = new Map<number, Point>();
  const existing: Point[] = [...allNodes.values()].map((n) => ({ x: n.x, y: n.y }));
  const groups = new Map<RelKind, AtlasNode[]>();
  for (const n of neighbors) {
    if (allNodes.has(n.id)) continue;
    const kind = neighborKind(edges, parent.id, n.id);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind)!.push(n as AtlasNode);
  }
  const spouseSide = parent.gender === "female" ? -1 : 1;

  for (const kind of KIND_ORDER) {
    const group = groups.get(kind);
    if (!group) continue;
    group.sort(sortFor(kind));
    group.forEach((n, i) => {
      const gen = generationOffset(n, centerGen, kind);
      const rowY = gen * ROW_H;
      let desiredX: number;
      if (kind === "child") {
        // 子女成排挂在父母下方
        desiredX = parent.x + (i - (group.length - 1) / 2) * minSep;
      } else if (kind === "parent") {
        // 父母并排挂在本人上方
        desiredX = parent.x + (i - (group.length - 1) / 2) * minSep;
      } else if (kind === "spouse") {
        desiredX = parent.x + spouseSide * (SAME_ROW_GAP * 1.02 + i * SAME_ROW_GAP);
      } else if (kind === "sibling") {
        desiredX = parent.x - spouseSide * (SAME_ROW_GAP * 1.02 + i * SAME_ROW_GAP);
      } else {
        const side = i % 2 === 0 ? 1 : -1;
        desiredX = parent.x + side * (SAME_ROW_GAP * 1.2 + Math.floor(i / 2) * minSep);
      }
      const x = findFreeX(rowY, desiredX, [...existing, ...placed.values()], minSep);
      placed.set(n.id, { x, y: rowY });
    });
  }
  return placed;
}

export interface EdgeGeometry {
  d: string;
  lx: number;
  ly: number;
  mx: number;
  my: number;
  knot: Point | null;
  length: number;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 谱系线：世代间走竖向曲线（父母下方出、子女上方入），
 * 同辈之间走横向曲线；配偶为朱线并在中点打一个结。
 */
export function edgeGeometry(
  edge: AtlasEdge,
  a: AtlasNode,
  b: AtlasNode,
  radiusA = 38,
  radiusB = 38,
): EdgeGeometry {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const vertical = a.gen !== b.gen || Math.abs(dy) > ROW_H * 0.55;
  let d: string;
  let lx: number;
  let ly: number;
  let mx: number;
  let my: number;

  if (!vertical && Math.abs(dx) <= 208) {
    // 相邻的同辈：直接横向相连，避免多余的弧线
    const sign = dx >= 0 ? 1 : -1;
    const sx = a.x + sign * radiusA;
    const ex = b.x - sign * radiusB;
    d = `M${sx.toFixed(1)},${a.y.toFixed(1)} L${ex.toFixed(1)},${b.y.toFixed(1)}`;
    mx = (a.x + b.x) / 2;
    my = (a.y + b.y) / 2;
    lx = mx;
    ly = my - 10;
  } else if (vertical) {
    const sign = dy >= 0 ? 1 : -1;
    const sy = a.y + sign * radiusA;
    const ey = b.y - sign * radiusB;
    my = (sy + ey) / 2;
    d = `M${a.x.toFixed(1)},${sy.toFixed(1)} C${a.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${ey.toFixed(1)}`;
    mx = (a.x + b.x) / 2;
    lx = mx + 10;
    ly = my;
  } else {
    const sign = dx >= 0 ? 1 : -1;
    const sx = a.x + sign * radiusA;
    const ex = b.x - sign * radiusB;
    // 同辈之间从上方拱起，避免穿过中间的人物
    const arc = edge.type_code === "spouse" ? 46 + (hash(edge.key) % 3) * 20 : 58 + (hash(edge.key) % 4) * 12;
    const c1x = sx + (ex - sx) * 0.24;
    const c2x = sx + (ex - sx) * 0.76;
    d = `M${sx.toFixed(1)},${a.y.toFixed(1)} C${c1x.toFixed(1)},${(a.y - arc).toFixed(1)} ${c2x.toFixed(1)},${(b.y - arc).toFixed(1)} ${ex.toFixed(1)},${b.y.toFixed(1)}`;
    mx = (a.x + b.x) / 2;
    my = (a.y + b.y) / 2 - arc * 0.75;
    lx = mx;
    ly = my - 8;
  }

  const knot = edge.type_code === "spouse" ? { x: mx, y: my } : null;
  return { d, lx, ly, mx, my, knot, length: len };
}

/** BFS 计算每个人到中心的跳数，用于控制自动展开深度 */
export function computeHops(center: number, nodes: Map<number, AtlasNode>, edges: Map<string, AtlasEdge>): Map<number, number> {
  const adj = new Map<number, number[]>();
  for (const e of edges.values()) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  const hops = new Map<number, number>([[center, 0]]);
  const queue = [center];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    const d = hops.get(u)!;
    for (const v of adj.get(u) || []) {
      if (hops.has(v)) continue;
      hops.set(v, d + 1);
      queue.push(v);
    }
  }
  for (const id of nodes.keys()) if (!hops.has(id)) hops.set(id, 99);
  return hops;
}
