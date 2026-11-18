from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Person, Relationship, User
from ..services import (
    PARENT_ROLES,
    graph_data,
    kinship_rules,
    person_brief,
    relation_label,
    rel_visible_clause,
    relation_types,
    require_person,
)

router = APIRouter(prefix="/api", tags=["图谱"])

NODE_LIMIT = 200  # 单屏节点上限（设计文档 14.4）


def _account_ids(db: Session, ids) -> set[int]:
    return set(db.scalars(select(User.person_id).where(User.person_id.in_(ids), User.is_active.is_(True))))


@router.get("/graph/network")
def network(
    center: int,
    depth: int = Query(1, ge=1, le=3),
    types: str | None = Query(None, description="逗号分隔的关系类型 id"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """以 center 为中心按层展开的关系网（按需加载，只取指定层数的邻接数据）。"""
    require_person(db, center)
    gd = graph_data(db)
    type_map = relation_types(db)
    allowed = {int(x) for x in types.split(",") if x.strip().isdigit()} if types else None

    sib_type = next((t for t in type_map.values() if t.kinship_role == "sibling"), None)
    with_derived = sib_type is not None and (allowed is None or sib_type.id in allowed)

    def neighbors(u):
        for v, rid, tid in gd.adj.get(u, ()):
            if gd.rel_visible(rid, user):
                yield v, rid, tid
        if with_derived:  # 兄弟姐妹由共同父母推导，也作为一度关系展示
            for s in sorted(gd.kin.siblings(u)):
                yield s, None, sib_type.id

    level = {center: 0}
    frontier = [center]
    truncated = False
    for d in range(1, depth + 1):
        nxt = []
        for u in frontier:
            for v, _, tid in neighbors(u):
                if v in level or (allowed is not None and tid not in allowed):
                    continue
                if len(level) >= NODE_LIMIT:
                    truncated = True
                    break
                level[v] = d
                nxt.append(v)
        frontier = nxt

    ids = list(level)
    stmt = select(Relationship).where(
        Relationship.person_a_id.in_(ids), Relationship.person_b_id.in_(ids), rel_visible_clause(db, user)
    )
    if allowed is not None:
        stmt = stmt.where(Relationship.type_id.in_(allowed))
    rels = db.scalars(stmt).all()
    persons = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(ids)))}
    terms = gd.kin.terms_from(center, ids, kinship_rules(db))
    accounts = _account_ids(db, ids)

    nodes = []
    for pid in ids:
        b = person_brief(persons[pid], gd)
        b.update(depth=level[pid], kin_term=terms.get(pid), has_account=pid in accounts)
        nodes.append(b)
    edges = []
    for r in rels:
        t = type_map[r.type_id]
        label = relation_label(t, gd.info.get(r.person_a_id), r.status)
        if t.kinship_role == "spouse" and gd.marriage_ended_by_death(r.person_a_id, r.person_b_id):
            label = "已故配偶"
        edges.append(
            {
                "id": r.id,
                "source": r.person_a_id,
                "target": r.person_b_id,
                "type_id": t.id,
                "type_code": t.code,
                "type_name": t.name,
                "category": t.category,
                "label": label,
                "directed": not t.symmetric,
                "status": r.status,
                "is_public": t.category != "social",
                "color": t.color,
                "detail": f"{gd.info[r.person_a_id].name} 是 {gd.info[r.person_b_id].name} 的{label}"
                if not t.symmetric
                else f"{gd.info[r.person_a_id].name} 与 {gd.info[r.person_b_id].name}：{label}",
            }
        )
    if with_derived:
        explicit = {frozenset((e["source"], e["target"])) for e in edges if e["type_id"] == sib_type.id}
        id_set = set(ids)
        for a in ids:
            for b in gd.kin.siblings(a):
                if a < b and b in id_set and frozenset((a, b)) not in explicit:
                    edges.append({
                        "id": f"d{a}-{b}", "source": a, "target": b, "type_id": sib_type.id,
                        "type_code": sib_type.code, "type_name": sib_type.name, "category": "kin",
                        "label": sib_type.name, "directed": False, "status": "derived", "color": sib_type.color,
                        "detail": f"{gd.info[a].name} 与 {gd.info[b].name}：{sib_type.name}（由共同父母推导）",
                    })
    return {"center": center, "depth": depth, "nodes": nodes, "edges": edges, "truncated": truncated}


@router.get("/graph/tree")
def tree(
    root: int,
    mode: str = Query("hourglass", pattern="^(ancestors|descendants|hourglass|blood)$"),
    gen: int = Query(3, ge=1, le=10),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """族谱子图：祖先 / 后代 / 沙漏 / 血亲，按世代上下各 gen 代。布局在前端完成。
    血亲 = 直系血亲（上下各 gen 代）+ 三代以内旁系血亲：兄弟姐妹、伯叔姑舅姨、堂表兄弟姐妹、侄甥。"""
    require_person(db, root)
    gd = graph_data(db)
    kin = gd.kin
    include = {root}
    if mode in ("ancestors", "hourglass", "blood"):
        frontier = [root]
        # 血亲视图至少要到祖父母一代，才能挂出伯叔姑舅姨与堂表兄弟姐妹
        for _ in range(max(gen, 2) if mode == "blood" else gen):
            nxt = []
            for x in frontier:
                for p, kind in kin.parents.get(x, ()):
                    if kind != "step" and p not in include:
                        include.add(p)
                        nxt.append(p)
            frontier = nxt
    if mode in ("descendants", "hourglass", "blood"):
        frontier = [root]
        for level in range(gen + 1):
            nxt = []
            for x in frontier:
                for q, _ in kin.spouses.get(x, ()):
                    include.add(q)
                if level == gen:
                    continue
                for c, kind in kin.children.get(x, ()):
                    if kind != "step" and c not in include:
                        include.add(c)
                        nxt.append(c)
            frontier = nxt
    if mode == "blood":
        include |= _collateral_within_three(kin, root)
    persons = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(include)))}
    accounts = _account_ids(db, include)
    out_persons = {}
    for pid, p in persons.items():
        b = person_brief(p, gd)
        b.update(death_date=p.death_date, birth_date=p.birth_date if p.birth_date else None,
                 birth_lunar=p.birth_lunar, birth_lunar_leap=p.birth_lunar_leap, birth_hour=p.birth_hour,
                 death_lunar=p.death_lunar, death_lunar_leap=p.death_lunar_leap, death_hour=p.death_hour,
                 has_account=pid in accounts, birth_order=p.birth_order)
        out_persons[pid] = b
    parents = [
        {"child": c, "parent": p, "kind": kind}
        for c in include
        for p, kind in kin.parents.get(c, ())
        if p in include and kind != "step"
    ]
    spouses, seen = [], set()
    for a in include:
        for b, active in kin.spouses.get(a, ()):
            key = (min(a, b), max(a, b))
            if b in include and key not in seen:
                seen.add(key)
                meta = gd.spouse_meta.get((a, b), {})
                widowed = gd.marriage_ended_by_death(a, b)
                spouses.append({"a": key[0], "b": key[1], "active": active and not widowed,
                                "widowed": widowed, "start": meta.get("start")})
    # 只登记了“兄弟姐妹”关系、未录入共同父母的人，布局时也要能排到一起
    siblings = [
        {"a": a, "b": b} for a in include for b in kin.explicit_sib.get(a, ()) if a < b and b in include
    ]
    return {"root": root, "mode": mode, "gen": gen, "persons": out_persons, "parents": parents, "spouses": spouses,
            "siblings": siblings}


def _collateral_within_three(kin, root: int) -> set[int]:
    """三代以内旁系血亲（及其配偶，便于成对显示）：
    兄弟姐妹（共同父母）、伯叔姑舅姨与堂表兄弟姐妹（共同祖父母）、侄子女与外甥子女（兄弟姐妹的子女）。"""
    blood_kids = lambda x: [c for c, k in kin.children.get(x, ()) if k != "step"]  # noqa: E731
    parents = [p for p, k in kin.parents.get(root, ()) if k != "step"]
    sibs = kin.siblings(root)
    uncles = set().union(*(kin.siblings(p) for p in parents)) - set(parents) if parents else set()
    cousins = {c for u in uncles for c in blood_kids(u)}
    nephews = {c for s in sibs for c in blood_kids(s)}
    blood = sibs | uncles | cousins | nephews
    spouses = {q for x in blood for q, _ in kin.spouses.get(x, ())}
    return blood | spouses


@router.get("/graph/path")
def path(
    source: int = Query(..., alias="from"),
    target: int = Query(..., alias="to"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """两人之间的最短关系路径（全部关系类型）。"""
    require_person(db, source)
    require_person(db, target)
    gd = graph_data(db)
    found = gd.shortest_social_path(source, target, viewer=user)
    if not found:
        return {"found": False, "nodes": [], "edges": []}
    nodes, rel_ids = found
    type_map = relation_types(db)
    rels = {r.id: r for r in db.scalars(select(Relationship).where(Relationship.id.in_(rel_ids)))}
    persons = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(nodes)))}
    edges = []
    for rid in rel_ids:
        r = rels[rid]
        t = type_map[r.type_id]
        edges.append({"id": rid, "source": r.person_a_id, "target": r.person_b_id,
                      "label": relation_label(t, gd.info.get(r.person_a_id), r.status), "category": t.category})
    return {"found": True, "nodes": [person_brief(persons[n], gd) for n in nodes], "edges": edges}


@router.get("/kinship")
def kinship(a: int, b: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """称呼计算：a_to_b 为“A 称呼 B 为 …”，b_to_a 为“B 称呼 A 为 …”。"""
    pa, pb = require_person(db, a), require_person(db, b)
    gd = graph_data(db)
    rules = kinship_rules(db)
    if a == b:
        raise HTTPException(422, "请选择两个不同的人物")
    return {
        "a": person_brief(pa, gd),
        "b": person_brief(pb, gd),
        "a_to_b": gd.kin.kinship(a, b, rules),
        "b_to_a": gd.kin.kinship(b, a, rules),
    }


@router.get("/graph/stats")
def stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    gd = graph_data(db)
    genders = {"male": 0, "female": 0, "unknown": 0}
    for p in gd.info.values():
        genders[p.gender if p.gender in genders else "unknown"] += 1
    gens: dict[int, int] = {}
    for g in gd.generations.values():
        gens[g] = gens.get(g, 0) + 1
    kin_parent_edges = sum(len(v) for v in gd.kin.parents.values())
    return {
        "persons": len(gd.info),
        "relationships": sum(1 for v in gd.adj.values() for _, rid, _ in v if gd.rel_visible(rid, user)) // 2,
        "parent_links": kin_parent_edges,
        "genders": genders,
        "generations": dict(sorted(gens.items())),
        "parent_roles": list(PARENT_ROLES),
    }
