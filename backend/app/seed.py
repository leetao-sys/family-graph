"""数据库初始化：迁移、内置关系类型、默认称谓规则、初始管理员。"""
import logging
import os

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .kinship.rules import DEFAULT_RULES
from .models import KinshipRule, RelationType, User
from .security import hash_password

log = logging.getLogger("family-graph")

BUILTIN_TYPES = [
    # code, name, category, symmetric, forward, reverse, kinship_role, sort, color
    ("parent", "亲子", "kin", False, "父/母", "子女", "parent", 1, "#2563eb"),
    ("adoptive", "收养", "kin", False, "养父/母", "养子女", "adoptive", 2, "#0ea5e9"),
    ("step", "继亲", "kin", False, "继父/母", "继子女", "step", 3, "#64748b"),
    ("spouse", "配偶", "kin", True, "配偶", "配偶", "spouse", 4, "#db2777"),
    ("sibling", "兄弟姐妹", "kin", True, "兄弟姐妹", "兄弟姐妹", "sibling", 5, "#7c3aed"),
    ("friend", "朋友", "social", True, "朋友", "朋友", None, 10, "#16a34a"),
    ("colleague", "同事", "social", True, "同事", "同事", None, 11, "#ea580c"),
    ("classmate", "同学", "social", True, "同学", "同学", None, 12, "#9333ea"),
    ("neighbor", "邻居", "social", True, "邻居", "邻居", None, 13, "#0891b2"),
    ("teacher", "师生", "social", False, "老师", "学生", None, 14, "#ca8a04"),
    ("comrade", "战友", "social", True, "战友", "战友", None, 15, "#4d7c0f"),
    ("partner", "合伙人", "social", True, "合伙人", "合伙人", None, 16, "#be185d"),
]


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")


def seed_builtin(db: Session) -> None:
    existing = {t.code for t in db.scalars(select(RelationType))}
    for code, name, cat, sym, fwd, rev, role, sort, color in BUILTIN_TYPES:
        if code not in existing:
            db.add(RelationType(code=code, name=name, category=cat, symmetric=sym, forward_name=fwd,
                                reverse_name=rev, kinship_role=role, sort=sort, color=color, builtin=True))
    if not db.scalar(select(func.count(KinshipRule.id))):
        db.add_all(KinshipRule(chain=c, term=t) for c, t in DEFAULT_RULES.items())
    if not db.scalar(select(func.count(User.id))):
        db.add(User(username=settings.admin_username, password_hash=hash_password(settings.admin_password),
                    role="admin", must_change_password=True))
        log.warning("已创建初始管理员 %s，首次登录需修改密码", settings.admin_username)
    db.commit()


def init_db(migrate: bool = True) -> None:
    if migrate:
        run_migrations()
    with SessionLocal() as db:
        seed_builtin(db)
