"""地图与年谱：人物地址分布、家族事件时间线。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import DEFAULT_PRIVACY, Person, Place, Relationship, User
from ..schemas import PlaceIn
from ..services import graph_data, person_brief, relation_types

router = APIRouter(prefix="/api", tags=["地图与年谱"])

# 地图地址优先级：已故安葬地 > 现居地 > 女性出嫁地 > 出生地（今/旧） > 籍贯
ADDRESS_FIELDS = (
    ("burial_place", "安葬地"),
    ("residence", "现居地"),
    ("marriage_place", "出嫁地"),
    ("birth_place_modern", "出生地（今）"),
    ("birth_place", "出生地"),
    ("native_place", "籍贯"),
)


def _visibility(db: Session, viewer: User):
    """返回一个判断函数 visible(person, field)，近亲集合只计算一次。"""
    close: set[int] = set()
    if viewer.person_id:
        prev = graph_data(db).kin.bfs_tree(viewer.person_id, max_depth=2)
        close = set(prev)

    def visible(p: Person, field: str) -> bool:
        if viewer.role == "admin" or viewer.person_id == p.id:
            return True
        scope = (p.privacy or {}).get(field) or DEFAULT_PRIVACY.get(field, "all")
        return scope == "all" or (scope == "kin" and p.id in close)

    return visible


@router.get("/map/persons")
def map_persons(user: User = Depends(current_user), db: Session = Depends(get_db)):
    gd = graph_data(db)
    visible = _visibility(db, user)
    items, missing = [], []
    for p in db.scalars(select(Person)):
        chosen = None
        for field, label in ADDRESS_FIELDS:
            if field == "burial_place" and p.is_living:
                continue
            if field == "marriage_place" and p.gender != "female":
                continue
            value = (getattr(p, field) or "").strip()
            if value and visible(p, field):
                if field == "marriage_place" and p.marriage_inferred:
                    label = "出嫁地（推断）"
                chosen = (field, label, value)
                break
        brief = person_brief(p, gd)
        if chosen:
            item = {"person": brief, "source": chosen[0], "source_label": chosen[1], "address": chosen[2]}
            if chosen[0] == "birth_place_modern" and p.birth_place and p.birth_place != chosen[2]:
                item["original_address"] = p.birth_place
            items.append(item)
        else:
            missing.append(brief)
    addresses = {i["address"] for i in items}
    places = {
        pl.address: {"lat": pl.lat, "lng": pl.lng, "formatted": pl.formatted}
        for pl in db.scalars(select(Place).where(Place.address.in_(addresses)))
    } if addresses else {}
    return {"items": items, "places": places, "missing": missing}


@router.put("/places")
def save_place(body: PlaceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """缓存浏览器端高德地理编码的结果。已有坐标只有管理员可以覆盖。"""
    address = body.address.strip()
    pl = db.scalar(select(Place).where(Place.address == address))
    if pl and pl.lat is not None and user.role != "admin":
        return {"address": pl.address, "lat": pl.lat, "lng": pl.lng, "formatted": pl.formatted}
    if (body.lat is None) != (body.lng is None):
        raise HTTPException(422, "坐标不完整")
    if not pl:
        pl = Place(address=address)
        db.add(pl)
    pl.lat, pl.lng, pl.formatted, pl.updated_by = body.lat, body.lng, body.formatted, user.id
    db.commit()
    return {"address": pl.address, "lat": pl.lat, "lng": pl.lng, "formatted": pl.formatted}


EVENT_LABEL = {"birth": "出生", "death": "去世", "marriage": "结婚", "divorce": "离异"}


@router.get("/timeline")
def timeline(
    types: str | None = Query(None, description="逗号分隔：birth,death,marriage,divorce"),
    person_id: int | None = Query(None, description="只看此人及其两步以内亲属的事件"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    gd = graph_data(db)
    visible = _visibility(db, user)
    wanted = set(types.split(",")) if types else set(EVENT_LABEL)
    scope = set(gd.kin.bfs_tree(person_id, max_depth=2)) if person_id else None
    persons = {p.id: p for p in db.scalars(select(Person))}
    briefs = {pid: person_brief(p, gd) for pid, p in persons.items()}
    events = []

    def add(kind: str, date: str | None, pids: list[int], place: str | None = None):
        if not date or kind not in wanted:
            return
        if scope is not None and not any(pid in scope for pid in pids):
            return
        names = " 和 ".join(briefs[pid]["name"] for pid in pids)
        events.append({
            "id": f"{kind}-{'-'.join(map(str, pids))}-{date}",
            "type": kind,
            "label": EVENT_LABEL[kind],
            "date": date,
            "title": f"{EVENT_LABEL[kind]} - {names}",
            "persons": [briefs[pid] for pid in pids],
            "place": place,
        })

    for p in persons.values():
        birth = p.birth_date if visible(p, "birth_date") else (p.birth_date[:4] if p.birth_date else None)
        add("birth", birth, [p.id], p.birth_place)
        add("death", p.death_date, [p.id])
    spouse_types = [t.id for t in relation_types(db).values() if t.kinship_role == "spouse"]
    if spouse_types:
        for r in db.scalars(select(Relationship).where(Relationship.type_id.in_(spouse_types))):
            if r.person_a_id in persons and r.person_b_id in persons:
                add("marriage", r.start_date, [r.person_a_id, r.person_b_id])
                if r.status == "historical":
                    add("divorce", r.end_date, [r.person_a_id, r.person_b_id])
    events.sort(key=lambda e: e["date"])
    return {"events": events}
