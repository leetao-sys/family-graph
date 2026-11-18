from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import admin_user, current_user
from ..models import Person, RelationType, Relationship, User
from ..schemas import RelationshipIn, RelationTypeIn
from ..services import (
    can_edit_relationship,
    graph_data,
    invalidate,
    person_brief,
    rel_is_visible,
    social_allowed,
    rel_visible_clause,
    relation_label,
    relationship_suggestions,
    relation_types,
    validate_relationship,
)

router = APIRouter(prefix="/api", tags=["关系"])


def type_out(t: RelationType) -> dict:
    return {
        k: getattr(t, k)
        for k in ("id", "code", "name", "category", "symmetric", "forward_name", "reverse_name",
                  "kinship_role", "sort", "color", "builtin")
    }


def rel_out(db: Session, r: Relationship) -> dict:
    t = relation_types(db)[r.type_id]
    gd = graph_data(db)
    a, b = db.get(Person, r.person_a_id), db.get(Person, r.person_b_id)
    return {
        "id": r.id,
        "person_a": person_brief(a, gd),
        "person_b": person_brief(b, gd),
        "type_id": r.type_id,
        "type_name": t.name,
        "category": t.category,
        "label": relation_label(t, gd.info.get(r.person_a_id), r.status),
        "start_date": r.start_date,
        "end_date": r.end_date,
        "status": r.status,
        "note": r.note,
        "is_public": t.category != "social",  # 社会关系一律仅创建者与管理员可见
        "created_by": r.created_by,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# —— 关系类型字典 ——
@router.get("/relation-types")
def list_types(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # 未开通社会关系功能的账号看不到社会关系类型（同学、老师等）
    show_social = social_allowed(user)
    return [type_out(t) for t in sorted(relation_types(db).values(), key=lambda t: (t.category != "kin", t.sort, t.id))
            if t.category != "social" or show_social]


@router.post("/relation-types", status_code=201)
def create_type(body: RelationTypeIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(RelationType).where(RelationType.code == body.code)):
        raise HTTPException(409, "类型编码已存在")
    if body.category == "social" and body.kinship_role:
        raise HTTPException(422, "社会关系不能参与称谓计算")
    t = RelationType(**body.model_dump())
    db.add(t)
    db.flush()
    audit.record(db, user, "create", "relation_type", t.id, f"新增关系类型 {t.name}", after=audit.snapshot(t))
    db.commit()
    invalidate("types", "graph")
    return type_out(t)


@router.put("/relation-types/{tid}")
def update_type(tid: int, body: RelationTypeIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    t = db.get(RelationType, tid)
    if not t:
        raise HTTPException(404, "关系类型不存在")
    before = audit.snapshot(t)
    data = body.model_dump()
    if t.builtin:  # 内置类型的结构字段不可改，仅可改显示属性
        data = {k: data[k] for k in ("name", "forward_name", "reverse_name", "sort", "color")}
    for k, v in data.items():
        setattr(t, k, v)
    audit.record(db, user, "update", "relation_type", t.id, f"修改关系类型 {t.name}", before, audit.snapshot(t))
    db.commit()
    invalidate("types", "graph")
    return type_out(t)


@router.delete("/relation-types/{tid}")
def delete_type(tid: int, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    t = db.get(RelationType, tid)
    if not t:
        raise HTTPException(404, "关系类型不存在")
    if t.builtin:
        raise HTTPException(409, "内置类型不可删除")
    if db.scalar(select(func.count(Relationship.id)).where(Relationship.type_id == tid)):
        raise HTTPException(409, "该类型仍有关系在使用，无法删除")
    audit.record(db, user, "delete", "relation_type", tid, f"删除关系类型 {t.name}", before=audit.snapshot(t))
    db.delete(t)
    db.commit()
    invalidate("types", "graph")
    return {"ok": True}


# —— 关系 ——
@router.get("/relationships")
def list_relationships(
    person_id: int | None = None,
    category: str | None = None,
    type_id: int | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Relationship).where(rel_visible_clause(db, user))
    if person_id:
        stmt = stmt.where(or_(Relationship.person_a_id == person_id, Relationship.person_b_id == person_id))
    if type_id:
        stmt = stmt.where(Relationship.type_id == type_id)
    if category:
        ids = [t.id for t in relation_types(db).values() if t.category == category]
        stmt = stmt.where(Relationship.type_id.in_(ids))
    if q:
        pids = select(Person.id).where((Person.surname + Person.given_name).like(f"%{q.strip()}%"))
        stmt = stmt.where(or_(Relationship.person_a_id.in_(pids), Relationship.person_b_id.in_(pids)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Relationship.id.desc()).offset((page - 1) * size).limit(size))
    return {"total": total, "items": [rel_out(db, r) for r in rows]}


def _check(db: Session, body: RelationshipIn, user: User, exclude_id: int | None = None) -> RelationType:
    t = relation_types(db).get(body.type_id)
    if not t or (t.category == "social" and not social_allowed(user)):
        raise HTTPException(422, "关系类型不存在")
    if not can_edit_relationship(user, t, body.person_a_id, body.person_b_id):
        raise HTTPException(403, "普通成员只能维护与自己相关的社会关系")
    errors, warnings = validate_relationship(db, body.person_a_id, body.person_b_id, t, exclude_id, viewer=user,
                                             status=body.status)
    if errors:
        raise HTTPException(422, "；".join(errors))
    if warnings and not body.confirm:
        raise HTTPException(409, {"warnings": warnings})
    return t


@router.post("/relationships", status_code=201)
def create_relationship(body: RelationshipIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _check(db, body, user)
    r = Relationship(**body.model_dump(exclude={"confirm"}), created_by=user.id)
    # 族谱关系公开；社会关系只有创建者与管理员可见，对方看不到，因此也不需要对方确认
    r.is_public = t.category != "social"
    db.add(r)
    db.flush()
    gd = graph_data(db)
    names = f"{gd.info[r.person_a_id].name} - {gd.info[r.person_b_id].name}"
    audit.record(db, user, "create", "relationship", r.id, f"新增{t.name}关系 {names}", after=audit.snapshot(r))
    db.commit()
    out = rel_out(db, r)
    # 族谱关系联动：建议同步补上的父母关系（前端让用户勾选后再逐条添加）
    out["suggestions"] = relationship_suggestions(db, r, t) if t.kinship_role and user.role == "admin" else []
    return out


def _load_editable(db: Session, rid: int, user: User) -> Relationship:
    r = db.get(Relationship, rid)
    if not r or not rel_is_visible(db, r, user):
        raise HTTPException(404, "关系不存在")
    t = relation_types(db)[r.type_id]
    if not can_edit_relationship(user, t, r.person_a_id, r.person_b_id):
        raise HTTPException(403, "普通成员只能维护与自己相关的社会关系")
    return r


@router.put("/relationships/{rid}")
def update_relationship(rid: int, body: RelationshipIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _load_editable(db, rid, user)
    t = _check(db, body, user, exclude_id=rid)
    before = audit.snapshot(r)
    for k, v in body.model_dump(exclude={"confirm", "is_public"}).items():
        setattr(r, k, v)
    r.is_public = t.category != "social"
    audit.record(db, user, "update", "relationship", r.id, f"修改{t.name}关系", before, audit.snapshot(r))
    db.commit()
    return rel_out(db, r)


@router.post("/relationships/{rid}/confirm")
def confirm_relationship(rid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(Relationship, rid)
    if not r or r.status != "pending" or not rel_is_visible(db, r, user):
        raise HTTPException(404, "没有待确认的关系")
    if user.role != "admin" and user.person_id not in (r.person_a_id, r.person_b_id):
        raise HTTPException(403, "无权确认该关系")
    if user.role != "admin" and r.created_by == user.id:
        raise HTTPException(403, "需由对方确认")
    r.status = "active"
    audit.record(db, user, "update", "relationship", r.id, "确认关系", {"status": "pending"}, {"status": "active"})
    db.commit()
    return rel_out(db, r)


@router.delete("/relationships/{rid}")
def delete_relationship(rid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _load_editable(db, rid, user)
    t = relation_types(db)[r.type_id]
    audit.record(db, user, "delete", "relationship", r.id, f"删除{t.name}关系", before=audit.snapshot(r))
    db.delete(r)
    db.commit()
    return {"ok": True}
