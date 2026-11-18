/**
 * 族谱树布局：世代按行对齐，夫妻并排，子女挂在夫妻连线下方，连线走直角折线。
 * - 后代树：每个人与其配偶组成“家庭单元”，子女按与哪位配偶所生分组；
 *   多次婚姻时首任配偶在左、其后的配偶依次在右，各段婚姻的子女分别挂在对应连线下。
 * - 祖先树：父亲在左、母亲在右，逐代向上。
 * - 沙漏：两者以根人物对齐合并。
 * - 血亲：直系血亲 + 三代以内旁系血亲。父母一行左侧为父系伯叔姑、右侧为母系舅姨，
 *   祖父母 / 外祖父母分别挂在各自子女上方，更早的祖先继续向上；堂表兄弟姐妹、侄甥挂在各自父母下。
 */
import type { TreeData, TreePerson } from "../types";

export const CARD_W = 196;
export const CARD_H = 70;
export const H_GAP = 14;
export const ROW_H = 136;
const GROUP_GAP = 30;

export interface CardPos {
  key: string; // 同一人物可能在树中出现多次（近亲婚姻等），key 唯一
  pid: number;
  x: number; // 卡片中心
  y: number;
  level: number; // 相对根的行：负数为祖先，正数为后代
  hasHiddenChildren?: number;
  canCollapse?: boolean;
}

export interface Link {
  key: string;
  d: string;
  kind: "child" | "adoptive" | "marriage" | "marriage-ended";
  ids: [number, number];
}

export interface TreeLayout {
  cards: CardPos[];
  links: Link[];
  bounds: { x1: number; y1: number; x2: number; y2: number };
  levels: number[];
}

interface Graph {
  persons: Record<string, TreePerson>;
  parentsOf: Map<number, { parent: number; kind: string }[]>;
  childrenOf: Map<number, { child: number; kind: string }[]>;
  spousesOf: Map<number, { q: number; active: boolean; start: string | null }[]>;
}

function buildGraph(data: TreeData): Graph {
  const parentsOf = new Map<number, { parent: number; kind: string }[]>();
  const childrenOf = new Map<number, { child: number; kind: string }[]>();
  const spousesOf = new Map<number, { q: number; active: boolean; start: string | null }[]>();
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  };
  data.parents.forEach((l) => {
    push(parentsOf, l.child, { parent: l.parent, kind: l.kind });
    push(childrenOf, l.parent, { child: l.child, kind: l.kind });
  });
  data.spouses.forEach((s) => {
    push(spousesOf, s.a, { q: s.b, active: s.active, start: s.start });
    push(spousesOf, s.b, { q: s.a, active: s.active, start: s.start });
  });
  return { persons: data.persons, parentsOf, childrenOf, spousesOf };
}

const byBirth = (g: Graph) => (a: number, b: number) => {
  const pa = g.persons[a];
  const pb = g.persons[b];
  return (
    (pa?.birth_date || "9999").localeCompare(pb?.birth_date || "9999") ||
    (pa?.birth_order ?? 99) - (pb?.birth_order ?? 99) ||
    a - b
  );
};

// ---------------- 后代树 ----------------
interface DescNode {
  pid: number;
  spouses: { q: number; active: boolean }[];
  left: number[]; // 显示在左侧的配偶
  right: number[];
  groups: { spouse: number | null; kids: DescNode[] }[];
  width: number;
  hidden: number;
}

interface DescOpts {
  /** 不再向下展开时不显示“+”（旁系只显示到规定代数，不提供展开） */
  quiet?: boolean;
  /** 单独指定某个子女的展开深度（血亲视图：本人按 gen 展开，兄弟姐妹只到其子女） */
  child?: (c: number, depth: number) => { depth: number; quiet?: boolean };
}

function buildDesc(
  g: Graph,
  pid: number,
  depth: number,
  collapsed: Set<number>,
  seen: Set<number>,
  opts: DescOpts = {},
): DescNode {
  seen.add(pid);
  const spouses = [...(g.spousesOf.get(pid) || [])]
    .filter((s) => g.persons[s.q])
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.start || "").localeCompare(b.start || ""));
  // 时间顺序：历史婚姻在前（左），现任在后（右）；单一配偶时男左女右
  const ordered = [...spouses].sort((a, b) => Number(a.active) - Number(b.active) || (a.start || "").localeCompare(b.start || ""));
  let left: number[] = [];
  let right: number[] = [];
  if (ordered.length === 1) {
    const male = g.persons[pid]?.gender === "male" || g.persons[ordered[0].q]?.gender === "female";
    (male ? right : left).push(ordered[0].q);
  } else if (ordered.length > 1) {
    const ended = ordered.filter((s) => !s.active).map((s) => s.q);
    const current = ordered.filter((s) => s.active).map((s) => s.q);
    if (ended.length && current.length) {
      // 已结束的婚姻（离异、丧偶后再婚）在左侧，现任配偶紧挨本人在右侧，避免连线跨过其他配偶
      left = ended;
      right = current;
    } else {
      left = [ordered[0].q];
      right = ordered.slice(1).map((s) => s.q);
    }
  }
  const kids = (g.childrenOf.get(pid) || []).map((c) => c.child).filter((c) => g.persons[c] && !seen.has(c));
  const limited = depth <= 0;
  const showKids = !collapsed.has(pid) && !limited;
  const hidden = collapsed.has(pid) || (limited && !opts.quiet) ? kids.length : 0;
  const groupMap = new Map<number | null, number[]>();
  if (showKids) {
    for (const c of kids.sort(byBirth(g))) {
      const others = (g.parentsOf.get(c) || []).map((p) => p.parent).filter((p) => p !== pid);
      const sp = others.find((o) => spouses.some((s) => s.q === o)) ?? null;
      if (!groupMap.has(sp)) groupMap.set(sp, []);
      groupMap.get(sp)!.push(c);
    }
  }
  const order: (number | null)[] = [...left, null, ...right];
  const groups = order
    .filter((k) => groupMap.has(k))
    .map((k) => ({
      spouse: k,
      kids: groupMap.get(k)!.map((c) => {
        const o = opts.child?.(c, depth - 1) ?? { depth: depth - 1, quiet: opts.quiet };
        return buildDesc(g, c, o.depth, collapsed, seen, { quiet: o.quiet });
      }),
    }));
  const rowW = (1 + left.length + right.length) * CARD_W + (left.length + right.length) * H_GAP;
  const kidsW =
    groups.reduce((s, gr) => s + gr.kids.reduce((t, k) => t + k.width, 0) + (gr.kids.length - 1) * H_GAP, 0) +
    Math.max(0, groups.length - 1) * GROUP_GAP;
  return { pid, spouses, left, right, groups, width: Math.max(rowW, kidsW), hidden };
}

function placeDesc(
  n: DescNode,
  cx: number,
  level: number,
  out: { cards: CardPos[]; links: Link[] },
  g: Graph,
  rootCard?: (c: CardPos) => void,
) {
  const y = level * ROW_H;
  const step = CARD_W + H_GAP;
  const cards: CardPos[] = [];
  const pCard: CardPos = {
    key: `d${n.pid}@${level}:${Math.round(cx)}`,
    pid: n.pid,
    x: cx + ((n.left.length - n.right.length) * step) / 2,
    y,
    level,
    hasHiddenChildren: n.hidden || undefined,
    canCollapse: n.groups.length > 0 || n.hidden > 0,
  };
  // 本人居中、配偶分列左右，整行以 cx 为中心
  cards.push(pCard);
  n.left.forEach((q, i) => cards.push({ key: `s${q}@${pCard.key}`, pid: q, x: pCard.x - (n.left.length - i) * step, y, level }));
  n.right.forEach((q, i) => cards.push({ key: `s${q}@${pCard.key}`, pid: q, x: pCard.x + (i + 1) * step, y, level }));
  out.cards.push(...cards);
  rootCard?.(pCard);

  // 婚姻连线
  const unionX = new Map<number | null, number>();
  unionX.set(null, pCard.x);
  for (const c of cards.slice(1)) {
    const s = n.spouses.find((sp) => sp.q === c.pid);
    const x1 = Math.min(c.x, pCard.x) + CARD_W / 2;
    const x2 = Math.max(c.x, pCard.x) - CARD_W / 2;
    const between = Math.abs(c.x - pCard.x) > step + 1; // 中间隔着其他配偶时走上方弧线
    const d = between
      ? `M${Math.min(c.x, pCard.x)},${y - CARD_H / 2} C${Math.min(c.x, pCard.x)},${y - CARD_H / 2 - 26} ${Math.max(c.x, pCard.x)},${y - CARD_H / 2 - 26} ${Math.max(c.x, pCard.x)},${y - CARD_H / 2}`
      : `M${x1},${y} L${x2},${y}`;
    out.links.push({ key: `m${pCard.key}-${c.pid}`, d, kind: s?.active === false ? "marriage-ended" : "marriage", ids: [n.pid, c.pid] });
    unionX.set(c.pid, between ? c.x : (c.x + pCard.x) / 2);
  }

  // 子女
  const total =
    n.groups.reduce((s, gr) => s + gr.kids.reduce((t, k) => t + k.width, 0) + (gr.kids.length - 1) * H_GAP, 0) +
    Math.max(0, n.groups.length - 1) * GROUP_GAP;
  let x = cx - total / 2;
  n.groups.forEach((gr, gi) => {
    const ux = unionX.get(gr.spouse) ?? pCard.x;
    const uy = gr.spouse === null ? y + CARD_H / 2 : y;
    const barY = y + ROW_H / 2 + 4 + gi * 7;
    const centers: number[] = [];
    gr.kids.forEach((k) => {
      const kx = x + k.width / 2;
      centers.push(kx);
      placeDesc(k, kx, level + 1, out, g);
      x += k.width + H_GAP;
    });
    x += GROUP_GAP - H_GAP;
    const minX = Math.min(ux, ...centers);
    const maxX = Math.max(ux, ...centers);
    out.links.push({ key: `b${pCard.key}-${gi}`, d: `M${ux},${uy} L${ux},${barY} M${minX},${barY} L${maxX},${barY}`, kind: "child", ids: [n.pid, n.pid] });
    gr.kids.forEach((k, i) => {
      const adoptive = (g.parentsOf.get(k.pid) || []).some((p) => p.parent === n.pid && p.kind === "adoptive");
      out.links.push({
        key: `c${pCard.key}-${k.pid}`,
        d: `M${centers[i]},${barY} L${centers[i]},${(level + 1) * ROW_H - CARD_H / 2}`,
        kind: adoptive ? "adoptive" : "child",
        ids: [n.pid, k.pid],
      });
    });
  });
}

// ---------------- 祖先树 ----------------
interface AncNode {
  pid: number;
  father?: AncNode;
  mother?: AncNode;
  width: number;
  kinds: Record<number, string>;
}

function buildAnc(g: Graph, pid: number, depth: number, seen: Set<number>): AncNode {
  const parents = (g.parentsOf.get(pid) || []).filter((p) => g.persons[p.parent] && !seen.has(p.parent));
  const kinds: Record<number, string> = {};
  parents.forEach((p) => (kinds[p.parent] = p.kind));
  let father: AncNode | undefined;
  let mother: AncNode | undefined;
  if (depth > 0) {
    const sorted = [...parents].sort((a, b) => {
      const ga = g.persons[a.parent].gender === "male" ? 0 : 1;
      const gb = g.persons[b.parent].gender === "male" ? 0 : 1;
      return ga - gb || Number(a.kind !== "parent") - Number(b.kind !== "parent");
    });
    const next = new Set(seen).add(pid);
    if (sorted[0]) father = buildAnc(g, sorted[0].parent, depth - 1, next);
    if (sorted[1]) mother = buildAnc(g, sorted[1].parent, depth - 1, next);
  }
  const pw = (father?.width ?? 0) + (mother?.width ?? 0) + (father && mother ? H_GAP : 0);
  return { pid, father, mother, width: Math.max(CARD_W, pw), kinds };
}

function placeAnc(n: AncNode, cx: number, level: number, out: { cards: CardPos[]; links: Link[] }, skipSelf: boolean) {
  const y = level * ROW_H;
  if (!skipSelf) out.cards.push({ key: `a${n.pid}@${level}:${Math.round(cx)}`, pid: n.pid, x: cx, y, level });
  const ps = [n.father, n.mother].filter(Boolean) as AncNode[];
  if (!ps.length) return;
  const total = ps.reduce((s, p) => s + p.width, 0) + (ps.length - 1) * H_GAP;
  let x = cx - total / 2;
  const centers: number[] = [];
  ps.forEach((p) => {
    const pcx = x + p.width / 2;
    centers.push(pcx);
    placeAnc(p, pcx, level - 1, out, false);
    x += p.width + H_GAP;
  });
  const py = (level - 1) * ROW_H;
  if (centers.length === 2) {
    out.links.push({
      key: `am${n.pid}@${level}:${Math.round(cx)}`,
      d: `M${centers[0] + CARD_W / 2},${py} L${centers[1] - CARD_W / 2},${py}`,
      kind: "marriage",
      ids: [ps[0].pid, ps[1].pid],
    });
  }
  const ux = centers.length === 2 ? (centers[0] + centers[1]) / 2 : centers[0];
  const uy = centers.length === 2 ? py : py + CARD_H / 2;
  const adoptive = ps.some((p) => n.kinds[p.pid] === "adoptive");
  out.links.push({
    key: `ac${n.pid}@${level}:${Math.round(cx)}`,
    d: `M${ux},${uy} L${ux},${py + ROW_H / 2} L${cx},${py + ROW_H / 2} L${cx},${y - CARD_H / 2}`,
    kind: adoptive ? "adoptive" : "child",
    ids: [ps[0].pid, n.pid],
  });
}

// ---------------- 血亲（直系 + 三代以内旁系） ----------------
const blood = (k: string) => k !== "step";

function sortParents(g: Graph, list: { parent: number; kind: string }[]) {
  return [...list].sort((a, b) => {
    const ga = g.persons[a.parent].gender === "male" ? 0 : 1;
    const gb = g.persons[b.parent].gender === "male" ? 0 : 1;
    return ga - gb || Number(a.kind !== "parent") - Number(b.kind !== "parent");
  });
}

/** 返回 null 表示本人没有登记父母，退回沙漏布局 */
function layoutBlood(data: TreeData, g: Graph, collapsed: Set<number>, out: { cards: CardPos[]; links: Link[] }): boolean {
  const root = data.root;
  const parents = sortParents(
    g,
    (g.parentsOf.get(root) || []).filter((p) => g.persons[p.parent] && blood(p.kind)),
  );
  if (!parents.length) return false;
  const central = parents[0].parent;
  const other = parents[1]?.parent;
  // 父母未登记为配偶时也并排显示，子女才能挂在两人之间
  if (other && !(g.spousesOf.get(central) || []).some((s) => s.q === other)) {
    const push = (a: number, b: number) => {
      if (!g.spousesOf.has(a)) g.spousesOf.set(a, []);
      g.spousesOf.get(a)!.push({ q: b, active: true, start: null });
    };
    push(central, other);
    push(other, central);
  }
  const explicit = new Map<number, Set<number>>();
  (data.siblings || []).forEach(({ a, b }) => {
    if (!explicit.has(a)) explicit.set(a, new Set());
    if (!explicit.has(b)) explicit.set(b, new Set());
    explicit.get(a)!.add(b);
    explicit.get(b)!.add(a);
  });
  // 某人的兄弟姐妹（同父或同母，或单独登记的兄弟姐妹关系）与其父母
  const sideOf = (p: number) => {
    const gps = sortParents(g, (g.parentsOf.get(p) || []).filter((x) => g.persons[x.parent] && blood(x.kind))).map((x) => x.parent);
    const sibs = new Set<number>();
    gps.forEach((gp) => (g.childrenOf.get(gp) || []).forEach((c) => blood(c.kind) && c.child !== p && g.persons[c.child] && sibs.add(c.child)));
    explicit.get(p)?.forEach((s) => s !== p && g.persons[s] && sibs.add(s));
    sibs.delete(central);
    if (other) sibs.delete(other);
    return { gps, sibs: [...sibs].sort(byBirth(g)) };
  };

  const seen = new Set<number>();
  // 父母这一家：本人按 gen 展开后代；兄弟姐妹只展开到其子女（侄、甥）
  const centralNode = buildDesc(g, central, 2, collapsed, seen, {
    quiet: true,
    child: (c, d) => (c === root ? { depth: data.gen, quiet: false } : { depth: d, quiet: true }),
  });
  const paternal = sideOf(central);
  const maternal = other ? sideOf(other) : { gps: [] as number[], sibs: [] as number[] };
  // 伯叔姑 / 舅姨：只展开到其子女（堂、表兄弟姐妹）
  const leftNodes = paternal.sibs.filter((u) => !seen.has(u)).map((u) => buildDesc(g, u, 1, collapsed, seen, { quiet: true }));
  const rightNodes = maternal.sibs.filter((u) => !seen.has(u)).map((u) => buildDesc(g, u, 1, collapsed, seen, { quiet: true }));

  // 父母一行：父系兄弟姐妹在左，父母居中，母系兄弟姐妹在右
  const pCards = new Map<number, CardPos>();
  const leftW = leftNodes.reduce((s, n) => s + n.width + GROUP_GAP, 0);
  let x = -leftW - centralNode.width / 2;
  for (const n of [...leftNodes, centralNode, ...rightNodes]) {
    placeDesc(n, x + n.width / 2, -1, out, g, (c) => pCards.set(n.pid, c));
    x += n.width + GROUP_GAP;
  }
  const otherCard = other !== undefined ? out.cards.find((c) => c.pid === other && c.level === -1) : undefined;

  // 祖父母 / 外祖父母及更早的直系祖先
  type Side = { gps: number[]; anc: AncNode[]; kids: { pid: number; x: number }[]; cx: number; xs: number[]; l: number; r: number };
  const sides: Side[] = [];
  const mkSide = (parentPid: number, parentX: number | undefined, info: { gps: number[]; sibs: number[] }) => {
    if (!info.gps.length || parentX === undefined) return;
    const isKid = (c: number) => (g.parentsOf.get(c) || []).some((p) => info.gps.includes(p.parent) && blood(p.kind));
    const kids = [
      ...info.sibs.filter((s) => pCards.has(s) && isKid(s)).map((s) => ({ pid: s, x: pCards.get(s)!.x })),
      { pid: parentPid, x: parentX },
    ];
    const anc = info.gps.slice(0, 2).map((gp) => buildAnc(g, gp, data.gen - 2, new Set([parentPid])));
    const cx = (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2;
    sides.push({ gps: anc.map((a) => a.pid), anc, kids, cx, xs: [], l: 0, r: 0 });
  };
  const centralCard = pCards.get(central);
  mkSide(central, centralCard?.x, paternal);
  if (other !== undefined) mkSide(other, otherCard?.x, maternal);
  const arrange = (s: Side, cx: number) => {
    s.cx = cx;
    if (s.anc.length === 2) {
      s.xs = [cx - H_GAP / 2 - s.anc[0].width / 2, cx + H_GAP / 2 + s.anc[1].width / 2];
      s.l = s.xs[0] - s.anc[0].width / 2;
      s.r = s.xs[1] + s.anc[1].width / 2;
    } else {
      s.xs = [cx];
      s.l = cx - s.anc[0].width / 2;
      s.r = cx + s.anc[0].width / 2;
    }
  };
  sides.forEach((s) => arrange(s, s.cx));
  if (sides.length === 2 && sides[0].r + GROUP_GAP > sides[1].l) {
    // 两边祖先树太宽会重叠：各向外让开一半
    const shift = (sides[0].r + GROUP_GAP - sides[1].l) / 2;
    arrange(sides[0], sides[0].cx - shift);
    arrange(sides[1], sides[1].cx + shift);
  }
  const y = -2 * ROW_H;
  for (const s of sides) {
    s.anc.forEach((a, i) => {
      out.cards.push({ key: `g${a.pid}@-2:${Math.round(s.xs[i])}`, pid: a.pid, x: s.xs[i], y, level: -2 });
      placeAnc(a, s.xs[i], -2, out, true);
    });
    if (s.xs.length === 2) {
      const ended = (g.spousesOf.get(s.gps[0]) || []).find((q) => q.q === s.gps[1])?.active === false;
      out.links.push({
        key: `gm${s.gps[0]}-${s.gps[1]}`,
        d: `M${s.xs[0] + CARD_W / 2},${y} L${s.xs[1] - CARD_W / 2},${y}`,
        kind: ended ? "marriage-ended" : "marriage",
        ids: [s.gps[0], s.gps[1]],
      });
    }
    const ux = s.xs.length === 2 ? (s.xs[0] + s.xs[1]) / 2 : s.xs[0];
    const uy = s.xs.length === 2 ? y : y + CARD_H / 2;
    const barY = y + ROW_H / 2 + 4;
    const minX = Math.min(ux, ...s.kids.map((k) => k.x));
    const maxX = Math.max(ux, ...s.kids.map((k) => k.x));
    out.links.push({ key: `gb${s.gps.join("-")}`, d: `M${ux},${uy} L${ux},${barY} M${minX},${barY} L${maxX},${barY}`, kind: "child", ids: [s.gps[0], s.gps[0]] });
    s.kids.forEach((k) => {
      const adoptive = (g.parentsOf.get(k.pid) || []).some((p) => s.gps.includes(p.parent) && p.kind === "adoptive");
      out.links.push({
        key: `gc${s.gps.join("-")}-${k.pid}`,
        d: `M${k.x},${barY} L${k.x},${-ROW_H - CARD_H / 2}`,
        kind: adoptive ? "adoptive" : "child",
        ids: [s.gps[0], k.pid],
      });
    });
  }
  return true;
}

// ---------------- 入口 ----------------
export function layoutTree(data: TreeData, collapsed: Set<number>): TreeLayout {
  const g = buildGraph(data);
  const out = { cards: [] as CardPos[], links: [] as Link[] };
  const root = data.root;
  let rootX = 0;
  const bloodDone = data.mode === "blood" && layoutBlood(data, g, collapsed, out);
  // 血亲视图下本人没有登记父母时，按沙漏方式显示
  const mode = data.mode === "blood" ? "hourglass" : data.mode;
  if (bloodDone) {
    // 已完成
  } else if (mode !== "ancestors") {
    const desc = buildDesc(g, root, data.gen, collapsed, new Set());
    placeDesc(desc, 0, 0, out, g, (c) => (rootX = c.x));
  }
  if (!bloodDone && mode !== "descendants") {
    const anc = buildAnc(g, root, data.gen, new Set());
    placeAnc(anc, rootX, 0, out, mode === "hourglass");
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const c of out.cards) {
    x1 = Math.min(x1, c.x - CARD_W / 2);
    x2 = Math.max(x2, c.x + CARD_W / 2);
    y1 = Math.min(y1, c.y - CARD_H / 2 - 30);
    y2 = Math.max(y2, c.y + CARD_H / 2 + 16);
  }
  const levels = [...new Set(out.cards.map((c) => c.level))].sort((a, b) => a - b);
  return { ...out, bounds: { x1, y1, x2, y2 }, levels };
}
