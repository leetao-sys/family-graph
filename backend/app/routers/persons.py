import io
import os
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..deps import admin_user, current_user
from ..models import Person, Relationship, User
from ..schemas import PersonCreateIn, PersonIn
from ..services import (
    can_edit_relationship,
    derived_siblings,
    graph_data,
    person_brief,
    person_full,
    rel_visible_clause,
    relation_label,
    relation_types,
    require_person,
    validate_relationship,
)

router = APIRouter(prefix="/api", tags=["人物"])

AVATAR_SIZES = (64, 128, 512)
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _avatar_dir() -> str:
    path = os.path.join(settings.media_dir, "avatars")
    os.makedirs(path, exist_ok=True)
    return path


@router.get("/persons")
def list_persons(
    q: str | None = None,
    gender: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=5000),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Person)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                (Person.surname + Person.given_name).like(like),
                Person.nickname.like(like),
                Person.former_name.like(like),
                Person.courtesy_name.like(like),
            )
        )
    if gender:
        stmt = stmt.where(Person.gender == gender)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Person.surname, Person.given_name, Person.id).offset((page - 1) * size).limit(size))
    gd = graph_data(db)
    items = []
    for p in rows:
        b = person_brief(p, gd)
        b.update(branch=p.branch, birth_order=p.birth_order, death_date=p.death_date, hint=_identity_hint(gd, p))
        items.append(b)
    return {"total": total, "items": items}


def _identity_hint(gd, p: Person) -> str | None:
    """区分同名人物的简短说明：父母 > 配偶 > 分支/籍贯。"""
    parts = []
    for pid, kind in gd.kin.parents.get(p.id, ()):
        info = gd.info.get(pid)
        if info and kind == "parent":
            role = {"male": "父", "female": "母"}.get(info.gender, "亲")
            parts.append(f"{role} {info.name}")
    if not parts:
        sp = sorted(gd.kin.spouses.get(p.id, ()), key=lambda t: not t[1])
        if sp and sp[0][0] in gd.info:
            parts.append(f"{'配偶' if sp[0][1] else '前配偶'} {gd.info[sp[0][0]].name}")
    if not parts:
        parts = [x for x in (p.branch, p.native_place) if x]
    return " · ".join(parts[:2]) or None


@router.get("/persons/{pid}")
def get_person(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return person_full(db, require_person(db, pid), user)


@router.get("/persons/{pid}/relationships")
def person_relationships(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_person(db, pid)
    types = relation_types(db)
    gd = graph_data(db)
    rows = db.scalars(
        select(Relationship).where(
            or_(Relationship.person_a_id == pid, Relationship.person_b_id == pid), rel_visible_clause(db, user)
        )
    ).all()
    others = {r.person_b_id if r.person_a_id == pid else r.person_a_id for r in rows}
    persons = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(others)))} if others else {}
    out = []
    for r in rows:
        t = types[r.type_id]
        other = r.person_b_id if r.person_a_id == pid else r.person_a_id
        a_info = gd.info.get(r.person_a_id)
        label = relation_label(t, a_info, r.status)
        # 站在 pid 的角度描述对方：“对方是我的 …”
        if t.kinship_role == "spouse" and gd.marriage_ended_by_death(r.person_a_id, r.person_b_id):
            role_of_other = label = "已故配偶" if other in gd.deceased else "配偶"
        elif r.person_a_id == other:
            role_of_other = label
        elif t.kinship_role in ("parent", "adoptive", "step"):
            g = persons[other].gender
            role_of_other = {"male": "儿子", "female": "女儿"}.get(g, "子女")
            if t.kinship_role != "parent":
                role_of_other = ("养" if t.kinship_role == "adoptive" else "继") + role_of_other
        else:
            role_of_other = label if t.symmetric else t.reverse_name
        out.append(
            {
                "id": r.id,
                "type_id": t.id,
                "type_name": t.name,
                "category": t.category,
                "color": t.color,
                "label": label,
                "role_of_other": role_of_other,
                "status": r.status,
                "start_date": r.start_date,
                "end_date": r.end_date,
                "note": r.note,
                "is_public": t.category != "social",
                "created_by": r.created_by,
                "person_a_id": r.person_a_id,
                "person_b_id": r.person_b_id,
                "other": person_brief(persons[other], gd),
                "can_edit": can_edit_relationship(user, t, r.person_a_id, r.person_b_id),
            }
        )
    # 由共同父母推导的兄弟姐妹（未单独登记“兄弟姐妹”关系），只读显示
    sib_type = next((t for t in types.values() if t.kinship_role == "sibling"), None)
    derived = derived_siblings(gd, pid) if sib_type else []
    if derived:
        sp = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_([d["id"] for d in derived])))}
        for d in derived:
            if d["id"] not in sp:
                continue
            out.append({
                "id": f"d{min(pid, d['id'])}-{max(pid, d['id'])}", "type_id": sib_type.id, "type_name": sib_type.name,
                "category": "kin", "color": sib_type.color, "label": d["role"], "role_of_other": d["role"],
                "status": "derived", "start_date": None, "end_date": None, "note": d["note"], "is_public": True,
                "created_by": None, "person_a_id": pid, "person_b_id": d["id"],
                "other": person_brief(sp[d["id"]], gd), "can_edit": False,
            })
    out.sort(key=lambda x: (x["category"] != "kin", types[x["type_id"]].sort, x["other"]["name"]))
    return out


@router.post("/persons", status_code=201)
def create_person(body: PersonCreateIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if not (body.surname or body.given_name):
        raise HTTPException(422, "请填写姓名")
    if body.father_id and body.father_id == body.mother_id:
        raise HTTPException(422, "父亲和母亲不能是同一人")
    p = Person(**body.model_dump(exclude={"privacy", "father_id", "mother_id", "confirm"}),
               privacy=body.privacy or {}, created_by=user.id)
    if p.death_date:  # 与修改时一致：填了去世日期即为已故
        p.is_living = False
    db.add(p)
    db.flush()
    audit.record(db, user, "create", "person", p.id, f"新增人物 {p.name}", after=audit.snapshot(p))
    # 同时登记父母：与单独添加“亲子”关系走同样的校验，任何错误都整体回滚
    parent_type = next((t for t in relation_types(db).values() if t.kinship_role == "parent"), None)
    errors, warnings = [], []
    for parent_id, role, wrong in ((body.father_id, "父亲", "female"), (body.mother_id, "母亲", "male")):
        if not parent_id or not parent_type:
            continue
        parent = db.get(Person, parent_id)
        if not parent:
            errors.append(f"所选{role}不存在")
            continue
        if parent.gender == wrong:
            errors.append(f"{parent.name} 的性别与“{role}”不符")
            continue
        errs, warns = validate_relationship(db, parent.id, p.id, parent_type, viewer=user)
        errors += errs
        warnings += warns
        if errs:
            continue
        r = Relationship(person_a_id=parent.id, person_b_id=p.id, type_id=parent_type.id, is_public=True,
                         created_by=user.id)
        db.add(r)
        db.flush()
        audit.record(db, user, "create", "relationship", r.id, f"新增亲子关系 {parent.name} - {p.name}",
                     after=audit.snapshot(r))
    if errors:
        db.rollback()
        raise HTTPException(422, "；".join(errors))
    if warnings and not body.confirm:
        db.rollback()
        raise HTTPException(409, {"warnings": warnings})
    db.commit()
    return person_full(db, p, user)


@router.put("/persons/{pid}")
def update_person(pid: int, body: PersonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = require_person(db, pid)
    if user.role != "admin" and user.person_id != pid:
        raise HTTPException(403, "只能修改自己的资料")
    if not (body.surname or body.given_name):
        raise HTTPException(422, "请填写姓名")
    before = audit.snapshot(p)
    data = body.model_dump(exclude_unset=True)
    if "privacy" in data:
        p.privacy = {**(p.privacy or {}), **(data.pop("privacy") or {})}
    for k, v in data.items():
        setattr(p, k, v)
    if p.death_date:
        p.is_living = False
    audit.record(db, user, "update", "person", p.id, f"修改人物 {p.name}", before, audit.snapshot(p))
    db.commit()
    return person_full(db, p, user)


@router.delete("/persons/{pid}")
def delete_person(pid: int, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    p = require_person(db, pid)
    bound = db.scalar(select(User).where(User.person_id == pid))
    if bound:
        raise HTTPException(409, f"该人物已绑定账号 {bound.username}，请先解绑")
    snap = audit.snapshot(p)
    rel_count = db.scalar(
        select(func.count(Relationship.id)).where(
            or_(Relationship.person_a_id == pid, Relationship.person_b_id == pid)
        )
    )
    db.query(Relationship).filter(
        or_(Relationship.person_a_id == pid, Relationship.person_b_id == pid)
    ).delete(synchronize_session=False)
    db.delete(p)
    audit.record(db, user, "delete", "person", pid, f"删除人物 {p.name}（及 {rel_count} 条关系）", before=snap)
    db.commit()
    return {"ok": True}


@router.post("/persons/{pid}/avatar")
async def upload_avatar(
    pid: int, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    p = require_person(db, pid)
    if user.role != "admin" and user.person_id != pid:
        raise HTTPException(403, "只能修改自己的头像")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(415, "仅支持 JPG、PNG、WebP、GIF 图片")
    raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"图片不能超过 {settings.max_upload_mb}MB")
    try:
        img = Image.open(io.BytesIO(raw))
        img.verify()
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "无法识别的图片文件")
    side = min(img.size)  # 居中裁成正方形
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    name = f"{pid}_{secrets.token_hex(6)}"
    directory = _avatar_dir()
    for size in AVATAR_SIZES:
        img.resize((size, size), Image.LANCZOS).save(os.path.join(directory, f"{name}_{size}.webp"), "WEBP", quality=85)
    old = p.avatar
    p.avatar = name
    audit.record(db, user, "update", "person", pid, f"更换头像 {p.name}", {"avatar": old}, {"avatar": name})
    db.commit()
    if old:
        _remove_avatar_files(old)
    return person_full(db, p, user)


@router.delete("/persons/{pid}/avatar")
def delete_avatar(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = require_person(db, pid)
    if user.role != "admin" and user.person_id != pid:
        raise HTTPException(403, "只能修改自己的头像")
    if p.avatar:
        _remove_avatar_files(p.avatar)
        audit.record(db, user, "update", "person", pid, f"删除头像 {p.name}", {"avatar": p.avatar}, {"avatar": None})
        p.avatar = None
        db.commit()
    return person_full(db, p, user)


def _remove_avatar_files(name: str) -> None:
    for size in AVATAR_SIZES:
        try:
            os.remove(os.path.join(_avatar_dir(), f"{name}_{size}.webp"))
        except FileNotFoundError:
            pass


@router.get("/media/avatars/{filename}")
def get_avatar(filename: str, user: User = Depends(current_user)):
    if not filename.endswith(".webp") or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(404)
    path = os.path.join(_avatar_dir(), filename)
    if not os.path.isfile(path):
        raise HTTPException(404)
    # 文件名含随机串，更换头像即换名，可长期缓存
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=2592000, immutable"})
