"""族谱图与称谓计算。

族谱关系只存储“直接关系”（亲子、配偶，以及父母不详时的兄弟姐妹）。
兄弟姐妹由“共同父母”推导；称谓由 A→B 的最短亲属路径映射规则表得到。
"""
from collections import defaultdict, deque
from dataclasses import dataclass
from itertools import product

from .rules import TOKEN_NAMES

UP = {"f", "m", "p"}
DOWN = {"s", "d", "c"}
SPOUSE = {"h", "w", "sp"}
MAX_STEPS = 8  # 超过此步数视为“关系过远”
MAX_VARIANTS = 16


@dataclass
class PInfo:
    id: int
    name: str
    gender: str
    birth: str | None = None
    order: int | None = None


def compare_age(a: PInfo, b: PInfo) -> str | None:
    """a 相对 b：'o' 年长，'y' 年幼，None 无法判断。不完整日期按已知精度比较。"""
    if a.birth and b.birth:
        n = min(len(a.birth), len(b.birth))
        x, y = a.birth[:n], b.birth[:n]
        if x != y:
            return "o" if x < y else "y"
    if a.order is not None and b.order is not None and a.order != b.order:
        return "o" if a.order < b.order else "y"
    return None


class KinGraph:
    def __init__(self, persons: dict[int, PInfo]):
        self.persons = persons
        self.parents: dict[int, list[tuple[int, str]]] = defaultdict(list)  # child -> [(parent, kind)]
        self.children: dict[int, list[tuple[int, str]]] = defaultdict(list)
        self.spouses: dict[int, list[tuple[int, bool]]] = defaultdict(list)  # p -> [(q, active)]
        self.explicit_sib: dict[int, set[int]] = defaultdict(set)

    # —— 构建 ——
    def add_parent(self, parent: int, child: int, kind: str = "parent") -> None:
        if parent in self.persons and child in self.persons:
            self.parents[child].append((parent, kind))
            self.children[parent].append((child, kind))

    def add_spouse(self, a: int, b: int, active: bool = True) -> None:
        if a in self.persons and b in self.persons:
            self.spouses[a].append((b, active))
            self.spouses[b].append((a, active))

    def add_sibling(self, a: int, b: int) -> None:
        if a in self.persons and b in self.persons:
            self.explicit_sib[a].add(b)
            self.explicit_sib[b].add(a)

    # —— 邻接 ——
    def siblings(self, x: int) -> set[int]:
        out = set(self.explicit_sib.get(x, ()))
        for p, kind in self.parents.get(x, ()):
            if kind == "step":
                continue
            out.update(c for c, k in self.children.get(p, ()) if k != "step")
        out.discard(x)
        return out

    def _gender_token(self, pid: int, male: str, female: str, unknown: str) -> str:
        g = self.persons[pid].gender
        return male if g == "male" else female if g == "female" else unknown

    def sibling_token(self, sib: int, of: int) -> str:
        g = self.persons[sib].gender
        if g not in ("male", "female"):
            return "sib"
        age = compare_age(self.persons[sib], self.persons[of])
        base = "b" if g == "male" else "s"
        if age is None:
            return "b" if g == "male" else "z"
        return age + base  # ob / yb / os / ys

    def neighbors(self, x: int):
        """依次产出 (邻居, 记号)。顺序决定等长路径的取舍：血亲优先。"""
        seen = set()
        for p, _ in self.parents.get(x, ()):
            if p not in seen:
                seen.add(p)
                yield p, self._gender_token(p, "f", "m", "p")
        for s in sorted(self.siblings(x)):
            if s not in seen:
                seen.add(s)
                yield s, self.sibling_token(s, x)
        for c, _ in self.children.get(x, ()):
            if c not in seen:
                seen.add(c)
                yield c, self._gender_token(c, "s", "d", "c")
        for q, _ in sorted(self.spouses.get(x, ()), key=lambda t: not t[1]):
            if q not in seen:
                seen.add(q)
                yield q, self._gender_token(q, "h", "w", "sp")

    # —— 路径搜索 ——
    def bfs_tree(self, start: int, max_depth: int = MAX_STEPS, banned_nodes=(), banned_edges=()):
        prev: dict[int, tuple[int, str] | None] = {start: None}
        depth = {start: 0}
        q = deque([start])
        while q:
            u = q.popleft()
            if depth[u] >= max_depth:
                continue
            for v, tok in self.neighbors(u):
                if v in prev or v in banned_nodes or (u, v) in banned_edges:
                    continue
                prev[v] = (u, tok)
                depth[v] = depth[u] + 1
                q.append(v)
        return prev

    @staticmethod
    def path_from_tree(prev, target: int):
        if target not in prev:
            return None
        nodes, tokens = [target], []
        cur = target
        while prev[cur] is not None:
            u, tok = prev[cur]
            nodes.append(u)
            tokens.append(tok)
            cur = u
        return list(reversed(nodes)), list(reversed(tokens))

    def shortest_path(self, a: int, b: int, max_depth: int = MAX_STEPS, banned_nodes=(), banned_edges=()):
        return self.path_from_tree(self.bfs_tree(a, max_depth, banned_nodes, banned_edges), b)

    def k_shortest_paths(self, a: int, b: int, k: int = 3, slack: int = 2):
        """Yen 算法：返回最多 k 条无环路径，长度不超过最短路径 + slack。"""
        first = self.shortest_path(a, b)
        if not first:
            return []
        limit = len(first[1]) + slack
        found = [first]
        candidates: list = []
        while len(found) < k:
            last_nodes, last_tokens = found[-1]
            for i in range(len(last_nodes) - 1):
                spur, root_nodes, root_tokens = last_nodes[i], last_nodes[: i + 1], last_tokens[:i]
                banned_edges = {
                    (n[i], n[i + 1]) for n, _ in found if len(n) > i + 1 and n[: i + 1] == root_nodes
                }
                spur_path = self.shortest_path(
                    spur, b, limit - i, banned_nodes=set(root_nodes[:-1]), banned_edges=banned_edges
                )
                if spur_path:
                    cand = (root_nodes[:-1] + spur_path[0], root_tokens + spur_path[1])
                    if len(cand[1]) <= limit and cand not in found and cand not in candidates:
                        candidates.append(cand)
            if not candidates:
                break
            candidates.sort(key=lambda c: len(c[1]))
            found.append(candidates.pop(0))
        return found

    # —— 称谓 ——
    def chain_alternatives(self, nodes: list[int], tokens: list[str]) -> list[list[str]]:
        """把路径转成带长幼后缀的记号，每一步给出可能的取值（长幼不明时展开）。"""
        gen = 0
        lineal = {0: nodes[0]}
        up_phase = True
        out: list[list[str]] = []
        for i, tok in enumerate(tokens):
            node = nodes[i + 1]
            if tok in UP:
                gen += 1
                if up_phase:
                    lineal[gen] = node
            elif tok in SPOUSE and i == 0:
                lineal[0] = node  # 以配偶为基准比较其同辈亲属长幼
            else:
                up_phase = False
                if tok in DOWN:
                    gen -= 1
            alts = {"b": ["ob", "yb"], "z": ["os", "ys"]}.get(tok, [tok])
            if tok in DOWN and gen >= 0 and gen in lineal and lineal[gen] != node:
                age = compare_age(self.persons[node], self.persons[lineal[gen]])
                suffixes = ["&o"] if age == "o" else ["&y"] if age == "y" else ["&o", "&y"]
                alts = [a + s for a in alts for s in suffixes]
            out.append(alts)
        return out

    @staticmethod
    def describe(chain: list[str]) -> str:
        return "的".join(TOKEN_NAMES.get(t.split("&")[0], t) for t in chain)

    def resolve(self, nodes: list[int], tokens: list[str], rules: dict[str, str]) -> tuple[str, list[str]]:
        """返回 (称谓, 匹配到的关系链列表)。无规则时返回描述性称谓。"""
        alts = self.chain_alternatives(nodes, tokens)
        terms, chains = [], []
        for variant in list(product(*alts))[:MAX_VARIANTS]:
            key = ",".join(variant)
            term = rules.get(key) or self.describe(list(variant))
            chains.append(key)
            if term not in terms:
                terms.append(term)
        return "/".join(terms), chains

    def path_steps(self, nodes: list[int], tokens: list[str]) -> list[dict]:
        steps = [{"id": nodes[0], "name": self.persons[nodes[0]].name, "token": None, "label": "本人"}]
        for n, t in zip(nodes[1:], tokens):
            steps.append({"id": n, "name": self.persons[n].name, "token": t, "label": TOKEN_NAMES.get(t, t)})
        return steps

    def kinship(self, a: int, b: int, rules: dict[str, str], k: int = 3) -> dict:
        """计算 B 是 A 的什么（A 称呼 B 为 …），附推导路径与其他可能路径。"""
        if a == b:
            return {"term": "本人", "paths": [], "found": True}
        paths = self.k_shortest_paths(a, b, k=k)
        if not paths:
            return {"term": None, "paths": [], "found": False, "reason": "暂无亲属关系或关系过远"}
        results = []
        for nodes, tokens in paths:
            term, chains = self.resolve(nodes, tokens, rules)
            if any(r["term"] == term for r in results):
                continue  # 只列出称谓不同的其他路径（如既是表亲又是姻亲）
            results.append(
                {
                    "term": term,
                    "chain": chains[0],
                    "description": self.describe(tokens),
                    "steps": self.path_steps(nodes, tokens),
                    "matched": any(c in rules for c in chains),
                }
            )
        return {"term": results[0]["term"], "paths": results, "found": True}

    def terms_from(self, center: int, targets, rules: dict[str, str], max_depth: int = 6) -> dict[int, str]:
        """一次 BFS 计算中心人物对多个人物的称谓（用于关系图节点标签）。"""
        prev = self.bfs_tree(center, max_depth)
        out = {}
        for t in targets:
            if t == center or t not in prev:
                continue
            nodes, tokens = self.path_from_tree(prev, t)
            out[t] = self.resolve(nodes, tokens, rules)[0]
        return out

    # —— 世代 ——
    def generations(self) -> dict[int, int]:
        """世代编号（0 起）：有父母者为父母世代 + 1，嫁娶入族者与配偶同辈。"""
        base: dict[int, int] = {}  # 无父母记录者的起始世代

        def compute() -> dict[int, int]:
            gen: dict[int, int] = {}
            for root in self.persons:  # 迭代后序遍历，避免深递归
                if root in gen:
                    continue
                stack, onstack = [root], {root}
                while stack:
                    x = stack[-1]
                    ps = [p for p, k in self.parents.get(x, ()) if k != "step"]
                    pending = [p for p in ps if p not in gen and p not in onstack]
                    if pending:
                        stack.extend(pending)
                        onstack.update(pending)
                        continue
                    stack.pop()
                    onstack.discard(x)
                    gen[x] = max((gen[p] + 1 for p in ps if p in gen), default=base.get(x, 0))
            return gen

        gen = compute()
        for _ in range(4):  # 嫁娶入族、无父母记录者与配偶对齐
            changed = False
            for pid in self.persons:
                if not self.parents.get(pid):
                    sp = [gen[q] for q, _ in self.spouses.get(pid, ()) if self.parents.get(q)]
                    if sp and base.get(pid, 0) != max(sp):
                        base[pid] = max(sp)
                        changed = True
            if not changed:
                break
            gen = compute()
        return gen
