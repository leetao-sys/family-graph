"""图数据装载、缓存，以及权限/隐私/校验等业务规则。"""
import threading
from collections import defaultdict, deque

from fastapi import HTTPException
from sqlalchemy import func, or_, select, true
from sqlalchemy.orm import Session

from .kinship import KinGraph, PInfo
from .kinship.rules import DEFAULT_RULES
from .models import DEFAULT_PRIVACY, PRIVATE_FIELDS, KinshipRule, Person, RelationType, Relationship, User

PARENT_ROLES = ("parent", "adoptive", "step")
_lock = threading.Lock()
_cache: dict = {}


# —— 缓存 ——
def _data_version(db: Session) -> tuple:
    r = db.execute(select(func.count(Relationship.id), func.max(Relationship.updated_at))).one()
    p = db.execute(select(func.count(Person.id), func.max(Person.updated_at))).one()
    t = db.execute(select(func.count(RelationType.id), func.max(RelationType.id))).one()
    return tuple(r) + tuple(p) + tuple(t)


def invalidate(*keys: str) -> None:
    with _lock:
        for k in keys or list(_cache):
            _cache.pop(k, None)


def relation_types(db: Session) -> dict[int, RelationType]:
    with _lock:
        if "types" not in _cache:
            _cache["types"] = {t.id: t for t in db.scalars(select(RelationType))}
            for t in _cache["types"].values():
                db.expunge(t)
        return _cache["types"]


def kinship_rules(db: Session) -> dict[str, str]:
    with _lock:
        if "rules" not in _cache:
            rows = db.scalars(select(KinshipRule).where(KinshipRule.dialect == "mandarin")).all()
            _cache["rules"] = {r.chain: r.term for r in rows} or dict(DEFAULT_RULES)
        return _cache["rules"]


class GraphData:
    """全量图数据的内存快照（家族规模：数千人、数万关系）。"""

    def __init__(self, db: Session):
        types = relation_types(db)
        persons = db.execute(
            select(Person.id, Person.surname, Person.given_name, Person.gender, Person.birth_date, Person.birth_order,
                   Person.is_living, Person.death_date)
        ).all()
        self.deceased = {p.id for p in persons if not p.is_living or p.death_date}
        self.info = {
            p.id: PInfo(p.id, f"{p.surname}{p.given_name}", p.gender, p.birth_date, p.birth_order) for p in persons
        }
        self.kin = KinGraph(self.info)
        self.adj: dict[int, list[tuple[int, int, int]]] = defaultdict(list)  # 全部关系：p -> [(q, rel_id, type_id)]
        rels = db.execute(
            select(
                Relationship.id, Relationship.person_a_id, Relationship.person_b_id,
                Relationship.type_id, Relationship.status, Relationship.start_date,
                Relationship.is_public, Relationship.created_by,
            )
        ).all()
        self.spouse_meta: dict[tuple[int, int], dict] = {}
        # 社会关系：rel_id -> 创建者 user id（只有创建者本人与管理员可见）
        self.social_rels: dict[int, int | None] = {}
        for r in rels:
            t0 = types.get(r.type_id)
            if t0 and t0.category == "social":
                self.social_rels[r.id] = r.created_by
            self.adj[r.person_a_id].append((r.person_b_id, r.id, r.type_id))
            self.adj[r.person_b_id].append((r.person_a_id, r.id, r.type_id))
            t = types.get(r.type_id)
            if not t or not t.kinship_role or r.status == "pending":
                continue
            if t.kinship_role in PARENT_ROLES:
                self.kin.add_parent(r.person_a_id, r.person_b_id, t.kinship_role)
            elif t.kinship_role == "spouse":
                active = r.status == "active"
                self.kin.add_spouse(r.person_a_id, r.person_b_id, active)
                meta = {"rel_id": r.id, "active": active, "start": r.start_date}
                self.spouse_meta[(r.person_a_id, r.person_b_id)] = meta
                self.spouse_meta[(r.person_b_id, r.person_a_id)] = meta
            elif t.kinship_role == "sibling":
                self.kin.add_sibling(r.person_a_id, r.person_b_id)
        k = self.kin
        in_family = set(k.parents) | set(k.children) | set(k.spouses) | set(k.explicit_sib)
        # 只有出现在族谱关系中的人物才有世代
        self.generations = {p: g for p, g in k.generations().items() if p in in_family}

    def marriage_ended_by_death(self, a: int, b: int) -> bool:
        """婚姻关系仍为“有效”，但一方已故、另一方已再婚（丧偶再婚）→ 视为已结束的婚姻。
        判断再婚：在世方另有有效婚姻，且新配偶在世，或新婚姻开始时间晚于这段婚姻。"""
        meta = self.spouse_meta.get((a, b))
        if not meta or not meta["active"]:
            return False
        start = meta.get("start") or ""
        for x, late in ((a, b), (b, a)):
            if late not in self.deceased:
                continue
            for y, active in self.kin.spouses.get(x, ()):
                if y == late or not active:
                    continue
                other_start = (self.spouse_meta.get((x, y)) or {}).get("start") or ""
                if y not in self.deceased or (start and other_start and other_start > start):
                    return True
        return False

    def rel_visible(self, rel_id, viewer: User) -> bool:
        if rel_id is None or viewer.role == "admin" or rel_id not in self.social_rels:
            return True
        return social_allowed(viewer) and self.social_rels[rel_id] == viewer.id

    def shortest_social_path(self, a: int, b: int, max_depth: int = 8, viewer: User | None = None):
        """全部关系上的最短路径（BFS），返回 (人物 id 列表, 关系 id 列表)。"""
        prev = {a: None}
        q = deque([(a, 0)])
        while q:
            u, d = q.popleft()
            if u == b:
                break
            if d >= max_depth:
                continue
            for v, rid, _ in self.adj.get(u, ()):
                if viewer is not None and not self.rel_visible(rid, viewer):
                    continue
                if v not in prev:
                    prev[v] = (u, rid)
                    q.append((v, d + 1))
        if b not in prev:
            return None
        nodes, rels, cur = [b], [], b
        while prev[cur]:
            u, rid = prev[cur]
            nodes.append(u)
            rels.append(rid)
            cur = u
        return nodes[::-1], rels[::-1]


def graph_data(db: Session) -> GraphData:
    version = _data_version(db)
    with _lock:
        cached = _cache.get("graph")
        if cached and cached[0] == version:
            return cached[1]
    data = GraphData(db)
    with _lock:
        _cache["graph"] = (version, data)
    return data


# —— 隐私 ——
def is_close_kin(db: Session, viewer: User, person_id: int, max_steps: int = 2) -> bool:
    if not viewer.person_id:
        return False
    if viewer.person_id == person_id:
        return True
    path = graph_data(db).kin.shortest_path(viewer.person_id, person_id, max_depth=max_steps)
    return path is not None


def can_see_field(db: Session, viewer: User, person: Person, field: str) -> bool:
    if viewer.role == "admin" or viewer.person_id == person.id:
        return True
    scope = (person.privacy or {}).get(field) or DEFAULT_PRIVACY.get(field, "all")
    if scope == "all":
        return True
    if scope == "kin":
        return is_close_kin(db, viewer, person.id)
    return False


def birth_year(birth: str | None) -> str | None:
    return birth[:4] if birth else None


def avatar_url(person: Person, size: int = 128) -> str | None:
    if not person.avatar:
        return None
    return f"/api/media/avatars/{person.avatar}_{size}.webp"


def person_brief(p: Person, gd: GraphData | None = None) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "gender": p.gender,
        "is_living": p.is_living,
        "birth_year": birth_year(p.birth_date),
        "avatar": avatar_url(p),
        "generation": gd.generations.get(p.id) if gd else None,
        "generation_name": p.generation_name,
    }


PERSON_FIELDS = (
    "surname", "given_name", "former_name", "courtesy_name", "honorific", "nickname", "gender", "birth_date",
    "birth_lunar", "death_date", "is_living", "generation_name", "birth_order", "branch", "hall_name",
    "native_place", "ethnicity", "birth_lunar_leap", "birth_hour", "death_lunar", "death_lunar_leap", "death_hour", "bio_format", "phone", "email", "residence", "employer", "occupation",
    "birth_place", "birth_place_modern", "burial_place", "marriage_place", "marriage_inferred", "bio", "notes",
)


def person_full(db: Session, p: Person, viewer: User) -> dict:
    gd = graph_data(db)
    out = person_brief(p, gd)
    for f in PERSON_FIELDS:
        v = getattr(p, f)
        if f in PRIVATE_FIELDS and not can_see_field(db, viewer, p, f):
            v = None if f != "birth_date" else (birth_year(v) if v else None)
            out.setdefault("hidden_fields", []).append(f)
        out[f] = v
    if "birth_date" in out.get("hidden_fields", []):
        out["birth_hour"] = None
        out["birth_lunar_leap"] = False
    if viewer.role == "admin" or viewer.person_id == p.id:
        out["privacy"] = {**DEFAULT_PRIVACY, **(p.privacy or {})}
    else:
        out.pop("notes", None)
    out["avatar_large"] = avatar_url(p, 512)
    out["has_account"] = db.scalar(select(func.count(User.id)).where(User.person_id == p.id)) > 0
    out["can_edit"] = viewer.role == "admin" or viewer.person_id == p.id
    return out


# —— 关系 ——
def social_allowed(user: User) -> bool:
    """社会关系功能是否对该账号开放：管理员始终可用，普通成员需管理员开通。"""
    return user.role == "admin" or bool(user.can_use_social)


def rel_visible_clause(db: Session, viewer: User):
    """SQL 条件：viewer 能看到的关系。族谱关系所有人可见；社会关系只有创建者本人（且已开通该功能）与管理员可见。"""
    if viewer.role == "admin":
        return true()
    kin_ids = [t.id for t in relation_types(db).values() if t.category != "social"]
    if not social_allowed(viewer):
        return Relationship.type_id.in_(kin_ids)
    return or_(Relationship.type_id.in_(kin_ids), Relationship.created_by == viewer.id)


def rel_is_visible(db: Session, r: Relationship, viewer: User) -> bool:
    t = relation_types(db).get(r.type_id)
    if viewer.role == "admin" or not t or t.category != "social":
        return True
    return social_allowed(viewer) and r.created_by == viewer.id


def relation_label(t: RelationType, a: PInfo | None, status: str) -> str:
    g = a.gender if a else "unknown"
    if t.kinship_role in PARENT_ROLES:
        base = {"male": "父", "female": "母"}.get(g)
        if t.kinship_role == "parent":
            return {"male": "父亲", "female": "母亲"}.get(g, "父母")
        return ("养" if t.kinship_role == "adoptive" else "继") + (base or "亲")
    if t.kinship_role == "spouse":
        return "前配偶" if status == "historical" else "配偶"
    return t.name if t.symmetric else t.forward_name


def can_edit_relationship(user: User, t: RelationType, a: int, b: int) -> bool:
    if user.role == "admin":
        return True
    return t.category == "social" and social_allowed(user) and user.person_id is not None and user.person_id in (a, b)


def _check_existing_spouse(db: Session, t: RelationType, pa: Person, pb: Person, exclude_id, errors, warnings) -> None:
    """一人同时只能有一段有效婚姻：原配偶在世且婚姻未设为“历史（离异）”时不能再登记有效婚姻。
    原配偶已故（丧偶再婚）不受限；本人已故的旧时多妻情况只提示确认。"""
    spouse_ids = [x.id for x in relation_types(db).values() if x.kinship_role == "spouse"]
    for me, partner in ((pa, pb), (pb, pa)):
        rows = db.scalars(select(Relationship).where(
            Relationship.type_id.in_(spouse_ids),
            Relationship.status != "historical",
            Relationship.id != (exclude_id or 0),
            or_(Relationship.person_a_id == me.id, Relationship.person_b_id == me.id),
        )).all()
        for r in rows:
            other = db.get(Person, r.person_b_id if r.person_a_id == me.id else r.person_a_id)
            if not other or other.id == partner.id or not other.is_living:
                continue
            if me.is_living:
                errors.append(
                    f"{me.name} 已有配偶 {other.name}（婚姻状态为有效）。如已离异，请先把原配偶关系的状态改为"
                    f"“历史（如离异、已结束）”；如原配偶已故，请在其资料中取消“在世”"
                )
            else:
                warnings.append(f"{me.name} 已有配偶 {other.name}（旧时多配偶情况），请确认")


def validate_relationship(
    db: Session, a: int, b: int, t: RelationType, exclude_id: int | None = None, viewer: User | None = None,
    status: str = "active",
) -> tuple[list[str], list[str]]:
    """返回 (错误, 告警)。错误阻止保存；告警需用户确认后保存。"""
    errors, warnings = [], []
    if a == b:
        errors.append("不能与自己建立关系")
        return errors, warnings
    pa, pb = db.get(Person, a), db.get(Person, b)
    if not pa or not pb:
        errors.append("人物不存在")
        return errors, warnings
    gd = graph_data(db)
    if t.kinship_role in PARENT_ROLES:
        # a 成为 b 的父母：若 b 已是 a 的祖先则成环
        seen, q = {a}, deque([a])
        while q:
            x = q.popleft()
            for p, _ in gd.kin.parents.get(x, ()):
                if p == b:
                    errors.append("亲子关系不能成环（对方已是本人的祖先）")
                    q.clear()
                    break
                if p not in seen:
                    seen.add(p)
                    q.append(p)
        if t.kinship_role == "parent":
            bio = [p for p, k in gd.kin.parents.get(b, ()) if k == "parent" and p != a]
            if len(bio) >= 2:
                errors.append(f"{pb.name} 已有两位生父母")
            elif any(gd.info[p].gender == pa.gender != "unknown" for p in bio):
                warnings.append(f"{pb.name} 已有一位同性别的生父/母")
        if pa.birth_date and pb.birth_date and pa.birth_date[:4] >= pb.birth_date[:4]:
            warnings.append(f"年龄矛盾：{pa.name}（{pa.birth_date}）不早于子女 {pb.name}（{pb.birth_date}）出生")
    if t.kinship_role == "spouse" and a in gd.kin.siblings(b):
        warnings.append("双方为兄弟姐妹，请确认配偶关系")
    if t.kinship_role == "spouse" and status != "historical":
        _check_existing_spouse(db, t, pa, pb, exclude_id, errors, warnings)
    pair = [(a, b), (b, a)] if t.symmetric else [(a, b)]
    dup = db.scalar(
        select(func.count(Relationship.id)).where(
            Relationship.type_id == t.id,
            Relationship.status != "historical",
            Relationship.id != (exclude_id or 0),
            or_(*[(Relationship.person_a_id == x) & (Relationship.person_b_id == y) for x, y in pair]),
            rel_visible_clause(db, viewer) if viewer else true(),
        )
    )
    if dup:
        warnings.append(f"已存在相同的“{t.name}”关系")
    return errors, warnings


def require_person(db: Session, pid: int) -> Person:
    p = db.get(Person, pid)
    if not p:
        raise HTTPException(404, "人物不存在")
    return p


# —— 关系联动：新增一条族谱关系后，提示应同步补上的相关关系 ——
def _parent_word(gender: str, kind: str) -> str:
    base = {"male": "父亲", "female": "母亲"}.get(gender, "父母")
    if kind == "adoptive":
        return {"male": "养父", "female": "养母"}.get(gender, "养父母")
    return base


def relationship_suggestions(db: Session, r: Relationship, t: RelationType) -> list[dict]:
    """返回建议同步添加的关系（由前端让用户勾选确认）：
    - 新增父/母：该父/母的配偶也可能是孩子的父/母（单一现任配偶时默认勾选）；
    - 新增配偶：一方的子女目前只登记了这一位父/母时，另一方可能也是其父/母（可能是继子女，默认不勾选）；
    - 新增兄弟姐妹：一方登记了父母、另一方没有时，把这对父母也补到另一方（默认勾选）。
    兄弟姐妹由共同父母自动推导，补齐父母后兄弟姐妹关系随之成立，无需逐一添加。"""
    gd = graph_data(db)
    kin, info = gd.kin, gd.info
    by_role = {x.kinship_role: x for x in relation_types(db).values() if x.kinship_role}
    out: list[dict] = []
    seen: set[tuple[int, int, int]] = set()

    def parents_of(x: int, kinds=("parent", "adoptive")) -> list[int]:
        return [p for p, k in kin.parents.get(x, ()) if k in kinds]

    def add(parent: int, child: int, kind: str, reason: str, checked: bool):
        pt = by_role.get(kind)
        if not pt or parent == child or parent not in info or child not in info:
            return
        if parent in [p for p, _ in kin.parents.get(child, ())]:
            return
        if kind == "parent" and len(parents_of(child, ("parent",))) >= 2:
            return
        key = (parent, child, pt.id)
        if key in seen:
            return
        seen.add(key)
        out.append({
            "person_a_id": parent, "person_b_id": child, "type_id": pt.id,
            "label": f"{info[parent].name} 是 {info[child].name} 的{_parent_word(info[parent].gender, kind)}",
            "reason": reason, "checked": checked,
        })

    a, b = r.person_a_id, r.person_b_id
    role = t.kinship_role
    if role in ("parent", "adoptive"):
        spouses = kin.spouses.get(a, ())
        active = [q for q, act in spouses if act]
        for q, act in spouses:
            add(q, b, role, f"{info[q].name} 是 {info[a].name} 的{'配偶' if act else '前配偶'}",
                checked=act and len(active) == 1)
    elif role == "spouse":
        for x, y in ((a, b), (b, a)):
            for c in [c for c, k in kin.children.get(x, ()) if k == "parent"]:
                if len(parents_of(c)) == 1:
                    add(y, c, "parent", f"{info[c].name} 目前只登记了{info[x].name}一位父/母（若是继子女请不要勾选）",
                        checked=False)
    elif role == "sibling":
        for x, y in ((a, b), (b, a)):
            if not parents_of(x) and parents_of(y):
                for p, k in kin.parents.get(y, ()):
                    if k in ("parent", "adoptive"):
                        add(p, x, k, f"{info[x].name} 与 {info[y].name} 是兄弟姐妹，但还没有登记父母", checked=True)
    return out[:20]


def derived_siblings(gd: GraphData, pid: int) -> list[dict]:
    """由共同父母推导出的兄弟姐妹（未单独登记“兄弟姐妹”关系的）：[(sid, 称呼, 说明)]。"""
    from .kinship.engine import compare_age

    me = gd.info.get(pid)
    mine = {p: k for p, k in gd.kin.parents.get(pid, ()) if k != "step"}
    out = []
    for s in sorted(gd.kin.siblings(pid) - gd.kin.explicit_sib.get(pid, set())):
        other = gd.info.get(s)
        if not other or not me:
            continue
        theirs = {p: k for p, k in gd.kin.parents.get(s, ()) if k != "step"}
        shared = set(mine) & set(theirs)
        if not shared:
            continue
        age = compare_age(other, me)
        word = {("male", "o"): "哥哥", ("male", "y"): "弟弟", ("female", "o"): "姐姐", ("female", "y"): "妹妹"}.get(
            (other.gender, age), {"male": "兄弟", "female": "姐妹"}.get(other.gender, "兄弟姐妹"))
        prefix = ""
        if len(mine) >= 2 and len(theirs) >= 2 and len(shared) == 1:
            sp = gd.info.get(next(iter(shared)))
            prefix = "同父异母的" if sp and sp.gender == "male" else "同母异父的" if sp and sp.gender == "female" else "同父或同母的"
        names = "、".join(gd.info[p].name for p in shared if p in gd.info)
        out.append({"id": s, "role": prefix + word, "note": f"由共同父母（{names}）推导"})
    return out
