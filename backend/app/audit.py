from datetime import date, datetime

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from .models import AuditLog, User


def snapshot(obj) -> dict:
    """把 ORM 对象转成可 JSON 序列化的字典，用于审计前后对比。"""
    out = {}
    for attr in inspect(obj).mapper.column_attrs:
        if attr.key == "password_hash":
            continue
        v = getattr(obj, attr.key)
        out[attr.key] = v.isoformat() if isinstance(v, (date, datetime)) else v
    return out


def record(
    db: Session,
    user: User | None,
    action: str,
    object_type: str,
    object_id: int | None,
    summary: str = "",
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    if before and after:  # 只保留有变化的字段，便于回溯
        changed = {k for k in after if before.get(k) != after.get(k)} - {"updated_at"}
        before = {k: before.get(k) for k in changed}
        after = {k: after.get(k) for k in changed}
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            username=user.username if user else None,
            action=action,
            object_type=object_type,
            object_id=object_id,
            summary=summary[:256],
            before=before,
            after=after,
        )
    )
