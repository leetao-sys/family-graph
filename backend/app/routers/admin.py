import json
import secrets
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from .. import audit, csv_import
from ..db import get_db
from ..deps import admin_user, current_user
from ..models import Article, AuditLog, KinshipRule, Person, Place, RelationType, Relationship, Setting, User, utcnow
from ..schemas import KinshipRuleIn, SettingsIn, UserCreateIn, UserUpdateIn
from ..security import hash_password, validate_password_strength
from ..config import settings
from ..services import PERSON_FIELDS, invalidate, relation_types
from .auth import user_out

router = APIRouter(prefix="/api", tags=["管理"])


def _temp_password() -> str:
    return "Fg" + secrets.token_hex(4) + str(secrets.randbelow(10))


# —— 账号 ——
@router.get("/admin/users")
def list_users(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    out = []
    for u in db.scalars(select(User).order_by(User.id)):
        d = user_out(db, u)
        d.update(is_active=u.is_active, social_enabled=bool(u.can_use_social), last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
                 locked=bool(u.locked_until and u.locked_until > utcnow()))
        out.append(d)
    return out


def _check_person_binding(db: Session, person_id: int | None, user_id: int | None = None) -> None:
    if person_id is None:
        return
    if not db.get(Person, person_id):
        raise HTTPException(422, "绑定的人物不存在")
    other = db.scalar(select(User).where(User.person_id == person_id, User.id != (user_id or 0)))
    if other:
        raise HTTPException(409, f"该人物已绑定账号 {other.username}")


@router.post("/admin/users", status_code=201)
def create_user(body: UserCreateIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, "用户名已存在")
    _check_person_binding(db, body.person_id)
    password = body.password or _temp_password()
    if err := validate_password_strength(password):
        raise HTTPException(422, err)
    u = User(username=body.username, password_hash=hash_password(password), role=body.role,
             person_id=body.person_id, must_change_password=True)
    db.add(u)
    db.flush()
    audit.record(db, admin, "create", "user", u.id, f"新增账号 {u.username}", after=audit.snapshot(u))
    db.commit()
    return {**user_out(db, u), "initial_password": password}


@router.put("/admin/users/{uid}")
def update_user(uid: int, body: UserUpdateIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "账号不存在")
    before = audit.snapshot(u)
    if u.id == admin.id and (body.role == "member" or body.is_active is False):
        raise HTTPException(409, "不能降级或停用自己的账号")
    if body.role:
        u.role = body.role
    if body.is_active is not None:
        u.is_active = body.is_active
        if not body.is_active:
            u.token_version += 1  # 立即踢下线
    if body.can_use_social is not None:
        u.can_use_social = body.can_use_social
    if body.unbind:
        u.person_id = None
    elif body.person_id is not None:
        _check_person_binding(db, body.person_id, u.id)
        u.person_id = body.person_id
    audit.record(db, admin, "update", "user", u.id, f"修改账号 {u.username}", before, audit.snapshot(u))
    db.commit()
    return user_out(db, u)


@router.post("/admin/users/{uid}/reset-password")
def reset_password(uid: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "账号不存在")
    password = _temp_password()
    u.password_hash = hash_password(password)
    u.must_change_password = True
    u.token_version += 1
    u.locked_until = None
    u.failed_logins = 0
    audit.record(db, admin, "update", "user", u.id, f"重置密码 {u.username}")
    db.commit()
    return {"initial_password": password}


@router.delete("/admin/users/{uid}")
def delete_user(uid: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "账号不存在")
    if u.id == admin.id:
        raise HTTPException(409, "不能删除自己的账号")
    audit.record(db, admin, "delete", "user", u.id, f"删除账号 {u.username}", before=audit.snapshot(u))
    db.delete(u)
    db.commit()
    return {"ok": True}


# —— 审计日志 ——
@router.get("/admin/audit-logs")
def audit_logs(
    object_type: str | None = None,
    object_id: int | None = None,
    username: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    admin: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    stmt = select(AuditLog)
    if object_type:
        stmt = stmt.where(AuditLog.object_type == object_type)
    if object_id:
        stmt = stmt.where(AuditLog.object_id == object_id)
    if username:
        stmt = stmt.where(AuditLog.username == username)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * size).limit(size))
    return {
        "total": total,
        "items": [
            {"id": r.id, "username": r.username, "action": r.action, "object_type": r.object_type,
             "object_id": r.object_id, "summary": r.summary, "before": r.before, "after": r.after,
             "created_at": r.created_at.isoformat()}
            for r in rows
        ],
    }


# —— 完整备份与恢复 ——
BACKUP_FORMAT = "family-graph-backup"
BACKUP_VERSION = 1


def _dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _backup_payload(db: Session) -> dict:
    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "exported_at": utcnow().isoformat(),
        "counts": {
            "persons": db.scalar(select(func.count(Person.id))) or 0,
            "relationships": db.scalar(select(func.count(Relationship.id))) or 0,
            "articles": db.scalar(select(func.count(Article.id))) or 0,
        },
        "relation_types": [audit.snapshot(t) for t in db.scalars(select(RelationType))],
        "persons": [audit.snapshot(p) for p in db.scalars(select(Person))],
        "relationships": [audit.snapshot(r) for r in db.scalars(select(Relationship))],
        "articles": [audit.snapshot(a) for a in db.scalars(select(Article))],
        "places": [audit.snapshot(p) for p in db.scalars(select(Place))],
        "kinship_rules": [audit.snapshot(r) for r in db.scalars(select(KinshipRule))],
        "settings": [{"key": s.key, "value": s.value} for s in db.scalars(select(Setting))],
    }


def _fields(model, row: dict, exclude=()) -> dict:
    names = {c.name for c in model.__table__.columns} - set(exclude)
    return {k: v for k, v in row.items() if k in names}


def _reset_pg_sequences(db: Session) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    for table in ("persons", "relationships", "relation_types", "articles", "places", "kinship_rules"):
        db.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
        ))


@router.get("/admin/backup")
def backup_all(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    """完整备份：人物、关系、文章、地点、称谓规则、系统设置。不含账号密码与头像文件。"""
    data = _backup_payload(db)
    body = json.dumps(data, ensure_ascii=False, indent=1)
    filename = f"family-graph-backup-{datetime.now():%Y%m%d-%H%M}.json"
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/admin/restore")
async def restore_all(file: UploadFile = File(...), admin: User = Depends(admin_user),
                      db: Session = Depends(get_db)):
    """用完整备份整体替换人物、关系、文章、地点、称谓规则和设置；账号保持不动。"""
    raw = await file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(413, "备份文件过大")
    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(422, "备份文件不是有效 JSON")
    if data.get("format") != BACKUP_FORMAT or data.get("version") != BACKUP_VERSION:
        raise HTTPException(422, "不是有效的家族数据完整备份")
    for key in ("persons", "relationships", "relation_types", "articles"):
        if not isinstance(data.get(key), list):
            raise HTTPException(422, f"备份缺少 {key}")

    # 恢复前先落一份当前数据快照，便于失败或误操作时人工回退
    try:
        safety_dir = Path(settings.media_dir) / "backups"
        safety_dir.mkdir(parents=True, exist_ok=True)
        (safety_dir / f"before-restore-{datetime.now():%Y%m%d-%H%M%S}.json").write_text(
            json.dumps(_backup_payload(db), ensure_ascii=False, indent=1), encoding="utf-8"
        )
    except OSError:
        pass

    user_bindings = {u.id: u.person_id for u in db.scalars(select(User))}
    try:
        # 账号保留；先解除人物绑定，避免删除人物时外键/唯一约束冲突
        for u in db.scalars(select(User)):
            u.person_id = None
        db.flush()
        db.execute(delete(Relationship))
        db.execute(delete(Article))
        db.execute(delete(Place))
        db.execute(delete(KinshipRule))
        db.execute(delete(Person))
        db.execute(delete(RelationType))
        db.execute(delete(Setting))
        db.flush()

        for t in data["relation_types"]:
            db.add(RelationType(**_fields(RelationType, t)))
        db.flush()
        for p in data["persons"]:
            db.add(Person(**_fields(Person, p, exclude=("created_at", "updated_at"))))
        db.flush()
        for r in data["relationships"]:
            db.add(Relationship(**_fields(Relationship, r, exclude=("created_at", "updated_at"))))
        db.flush()

        user_ids = set(user_bindings)
        for a in data["articles"]:
            fields = _fields(Article, a)
            fields["author_id"] = a.get("author_id") if a.get("author_id") in user_ids else admin.id
            fields["created_at"] = _dt(a.get("created_at")) or utcnow()
            fields["updated_at"] = _dt(a.get("updated_at")) or fields["created_at"]
            db.add(Article(**fields))
        for pl in data.get("places", []):
            fields = _fields(Place, pl, exclude=("updated_at",))
            fields["updated_at"] = _dt(pl.get("updated_at")) or utcnow()
            db.add(Place(**fields))
        for r in data.get("kinship_rules", []):
            db.add(KinshipRule(**_fields(KinshipRule, r)))
        for s in data.get("settings", []):
            if s.get("key"):
                db.add(Setting(key=s["key"], value=s.get("value") or ""))
        db.flush()
        _reset_pg_sequences(db)

        restored_person_ids = {p.id for p in db.scalars(select(Person))}
        used = set()
        for u in db.scalars(select(User)):
            pid = user_bindings.get(u.id)
            if pid in restored_person_ids and pid not in used:
                u.person_id = pid
                used.add(pid)

        audit.record(db, admin, "restore", "system", None,
                     f"恢复备份：{len(data['persons'])} 位人物、{len(data['relationships'])} 条关系、{len(data['articles'])} 篇文章")
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(422, f"恢复失败，未改动数据：{exc}") from exc
    invalidate()
    return {
        "ok": True,
        "persons": len(data["persons"]),
        "relationships": len(data["relationships"]),
        "articles": len(data["articles"]),
        "places": len(data.get("places", [])),
        "message": "恢复完成，账号与密码保持不变",
    }


# —— 导入导出 ——
@router.get("/admin/export")
def export_all(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    data = {
        "format": "family-graph",
        "version": 1,
        "exported_at": utcnow().isoformat(),
        "relation_types": [audit.snapshot(t) for t in db.scalars(select(RelationType))],
        "persons": [audit.snapshot(p) for p in db.scalars(select(Person))],
        "relationships": [audit.snapshot(r) for r in db.scalars(select(Relationship))],
    }
    audit.record(db, admin, "export", "system", None, "导出全部数据")
    db.commit()
    body = json.dumps(data, ensure_ascii=False, indent=1)
    filename = f"family-graph-{datetime.now():%Y%m%d-%H%M}.json"
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/admin/import")
async def import_all(file: UploadFile = File(...), admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    """追加导入 JSON 导出文件：人物与关系重新编号，关系类型按编码匹配（缺失则创建）。"""
    try:
        data = json.loads(await file.read())
        assert data.get("format") == "family-graph"
    except Exception:
        raise HTTPException(422, "不是有效的 family-graph 导出文件")
    type_by_code = {t.code: t for t in db.scalars(select(RelationType))}
    type_map = {}
    for t in data.get("relation_types", []):
        if t["code"] not in type_by_code:
            nt = RelationType(**{k: t[k] for k in ("code", "name", "category", "symmetric", "forward_name",
                                                  "reverse_name", "kinship_role", "sort", "color")})
            db.add(nt)
            db.flush()
            type_by_code[t["code"]] = nt
        type_map[t["id"]] = type_by_code[t["code"]].id
    person_map = {}
    for p in data.get("persons", []):
        fields = {k: p.get(k) for k in PERSON_FIELDS if k in p}
        np = Person(**fields, privacy=p.get("privacy") or {}, created_by=admin.id)
        db.add(np)
        db.flush()
        person_map[p["id"]] = np.id
    n_rel = 0
    for r in data.get("relationships", []):
        a, b, t = person_map.get(r["person_a_id"]), person_map.get(r["person_b_id"]), type_map.get(r["type_id"])
        if a and b and t:
            db.add(Relationship(person_a_id=a, person_b_id=b, type_id=t, start_date=r.get("start_date"),
                                end_date=r.get("end_date"), status=r.get("status") or "active",
                                note=r.get("note"), is_public=r.get("is_public", True), created_by=admin.id))
            n_rel += 1
    audit.record(db, admin, "import", "system", None, f"导入 {len(person_map)} 位人物、{n_rel} 条关系")
    db.commit()
    invalidate()
    return {"persons": len(person_map), "relationships": n_rel}


def _csv_response(body: str, filename: str) -> Response:
    return Response(body.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.get("/admin/import/persons-template")
def persons_template(admin: User = Depends(admin_user)):
    return _csv_response(csv_import.persons_template(), "人物导入模板.csv")


@router.get("/admin/import/relationships-template")
def relationships_template(admin: User = Depends(admin_user)):
    return _csv_response(csv_import.relationships_template(), "关系导入模板.csv")


@router.post("/admin/import/persons-csv")
async def import_persons_csv(file: UploadFile = File(...), admin: User = Depends(admin_user),
                             db: Session = Depends(get_db)):
    """批量新增人物。任何一行有错则全部不导入，返回带行号的错误清单。"""
    result = csv_import.import_persons(db, admin, await file.read())
    if result["errors"]:
        db.rollback()
        return result
    audit.record(db, admin, "import", "person", None, f"CSV 导入 {result['created']} 位人物")
    db.commit()
    invalidate("graph")
    return result


@router.post("/admin/import/relationships-csv")
async def import_relationships_csv(file: UploadFile = File(...), admin: User = Depends(admin_user),
                                   db: Session = Depends(get_db)):
    """批量新增关系（人物须已存在）。任何一行有错则全部不导入；已存在的相同关系自动跳过。"""
    result = csv_import.import_relationships(db, admin, await file.read())
    invalidate("graph")
    if result["errors"]:
        return result
    audit.record(db, admin, "import", "relationship", None,
                 f"CSV 导入 {result['created']} 条关系（跳过已存在 {result['skipped']} 条）")
    db.commit()
    invalidate("graph")
    return result


# —— 称谓规则 ——
@router.get("/admin/kinship-rules")
def list_rules(q: str | None = None, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(KinshipRule).order_by(KinshipRule.chain)
    if q:
        stmt = stmt.where((KinshipRule.term.like(f"%{q}%")) | (KinshipRule.chain.like(f"%{q}%")))
    return [{"id": r.id, "chain": r.chain, "term": r.term} for r in db.scalars(stmt)]


@router.put("/admin/kinship-rules")
def upsert_rule(body: KinshipRuleIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    r = db.scalar(select(KinshipRule).where(KinshipRule.chain == body.chain))
    before = audit.snapshot(r) if r else None
    if r:
        r.term = body.term
    else:
        r = KinshipRule(chain=body.chain, term=body.term)
        db.add(r)
    db.flush()
    audit.record(db, admin, "update" if before else "create", "kinship_rule", r.id,
                 f"称谓规则 {r.chain} → {r.term}", before, audit.snapshot(r))
    db.commit()
    invalidate("rules")
    return {"id": r.id, "chain": r.chain, "term": r.term}


@router.delete("/admin/kinship-rules/{rid}")
def delete_rule(rid: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    r = db.get(KinshipRule, rid)
    if not r:
        raise HTTPException(404)
    audit.record(db, admin, "delete", "kinship_rule", rid, f"删除称谓规则 {r.chain}", before=audit.snapshot(r))
    db.delete(r)
    db.commit()
    invalidate("rules")
    return {"ok": True}


# —— 系统设置 ——
DEFAULT_SETTINGS = {
    "site_name": "家族关系图谱",
    "relation_confirm_required": "false",
    "amap_key": "",
    "amap_security_code": "",
}


@router.get("/settings")
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    values = dict(DEFAULT_SETTINGS)
    values.update({s.key: s.value for s in db.scalars(select(Setting))})
    return {
        "site_name": values["site_name"],
        "relation_confirm_required": values["relation_confirm_required"] == "true",
        # 高德 JS API 的 Key 与安全密钥需下发到浏览器使用（高德的加载方式即如此），仅登录用户可见
        "amap_key": values["amap_key"],
        "amap_security_code": values["amap_security_code"],
    }


@router.get("/public/settings")
def public_settings(db: Session = Depends(get_db)):
    s = db.get(Setting, "site_name")
    return {"site_name": s.value if s else DEFAULT_SETTINGS["site_name"]}


@router.put("/settings")
def put_settings(body: SettingsIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    for key, value in body.model_dump(exclude_none=True).items():
        value = str(value).lower() if isinstance(value, bool) else value
        s = db.get(Setting, key)
        if s:
            s.value = value
        else:
            db.add(Setting(key=key, value=value))
    logged = body.model_dump(exclude_none=True)
    if logged.get("amap_security_code"):
        logged["amap_security_code"] = "******"
    audit.record(db, admin, "update", "settings", None, "修改系统设置", after=logged)
    db.commit()
    return get_settings(admin, db)


@router.get("/admin/summary")
def summary(admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    return {
        "persons": db.scalar(select(func.count(Person.id))),
        "relationships": db.scalar(select(func.count(Relationship.id))),
        "users": db.scalar(select(func.count(User.id))),
        "relation_types": len(relation_types(db)),
    }
