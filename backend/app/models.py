"""核心数据模型：人物为节点、关系为边的有向多重图（设计文档第 4、6 章）。"""
from datetime import datetime, timezone

from sqlalchemy import false as sa_false, true as sa_true
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


GENDERS = ("male", "female", "unknown")

# 隐私可见范围：all 全体 / kin 近亲 / self 仅本人（管理员始终可见）
PRIVACY_SCOPES = ("all", "kin", "self")
PRIVATE_FIELDS = ("phone", "email", "residence", "employer", "occupation", "birth_date")
DEFAULT_PRIVACY = {"phone": "self", "email": "self", "residence": "kin", "employer": "kin"}


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(primary_key=True)
    surname: Mapped[str] = mapped_column(String(32), default="")
    given_name: Mapped[str] = mapped_column(String(64), default="")
    former_name: Mapped[str | None] = mapped_column(String(64))
    courtesy_name: Mapped[str | None] = mapped_column(String(64))  # 字/号
    honorific: Mapped[str | None] = mapped_column(String(128))  # 封赠 / 功名，如 例赠登仕郎、太学生、敕授文林郎
    nickname: Mapped[str | None] = mapped_column(String(64))
    gender: Mapped[str] = mapped_column(String(8), default="unknown")
    # 支持不完整日期：YYYY / YYYY-MM / YYYY-MM-DD
    birth_date: Mapped[str | None] = mapped_column(String(10))
    birth_lunar: Mapped[bool] = mapped_column(Boolean, default=False)
    # 农历生日时 birth_date 存农历年-月-日；birth_lunar_leap 表示闰月
    birth_lunar_leap: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    birth_hour: Mapped[str | None] = mapped_column(String(2))  # 时辰：子 丑 … 亥，可空
    death_date: Mapped[str | None] = mapped_column(String(10))
    # 去世日期可独立选择农历/公历，规则同出生日期
    death_lunar: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    death_lunar_leap: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    death_hour: Mapped[str | None] = mapped_column(String(2))
    is_living: Mapped[bool] = mapped_column(Boolean, default=True)
    generation_name: Mapped[str | None] = mapped_column(String(16))  # 字辈
    birth_order: Mapped[int | None] = mapped_column(Integer)  # 排行
    branch: Mapped[str | None] = mapped_column(String(64))
    hall_name: Mapped[str | None] = mapped_column(String(64))  # 堂号
    native_place: Mapped[str | None] = mapped_column(String(128))  # 籍贯
    ethnicity: Mapped[str | None] = mapped_column(String(32))
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(128))
    residence: Mapped[str | None] = mapped_column(String(128))
    employer: Mapped[str | None] = mapped_column(String(128))
    occupation: Mapped[str | None] = mapped_column(String(64))
    birth_place: Mapped[str | None] = mapped_column(String(128))
    birth_place_modern: Mapped[str | None] = mapped_column(String(128))  # 今地名，地图定位用
    burial_place: Mapped[str | None] = mapped_column(String(128))  # 安葬地（今地名）
    marriage_place: Mapped[str | None] = mapped_column(String(128))  # 出嫁地（今地名）
    marriage_inferred: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    bio: Mapped[str | None] = mapped_column(Text)
    bio_format: Mapped[str] = mapped_column(String(8), default="markdown", server_default="markdown")  # markdown / html
    notes: Mapped[str | None] = mapped_column(Text)
    avatar: Mapped[str | None] = mapped_column(String(128))
    privacy: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_person_name", "surname", "given_name"),)

    @property
    def name(self) -> str:
        return f"{self.surname}{self.given_name}" or f"#{self.id}"


class RelationType(Base):
    """关系类型字典。kinship_role 非空的类型参与族谱与称谓计算。"""

    __tablename__ = "relation_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(32))
    category: Mapped[str] = mapped_column(String(8))  # kin 族谱 / social 社会
    symmetric: Mapped[bool] = mapped_column(Boolean, default=True)
    forward_name: Mapped[str] = mapped_column(String(32))  # A 是 B 的 …
    reverse_name: Mapped[str] = mapped_column(String(32))  # B 是 A 的 …
    # parent / adoptive / step / spouse / sibling；社会关系为 None
    kinship_role: Mapped[str | None] = mapped_column(String(16))
    sort: Mapped[int] = mapped_column(Integer, default=100)
    color: Mapped[str] = mapped_column(String(16), default="#64748b")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)


class Relationship(Base):
    __tablename__ = "relationships"

    id: Mapped[int] = mapped_column(primary_key=True)
    person_a_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    person_b_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    type_id: Mapped[int] = mapped_column(ForeignKey("relation_types.id", ondelete="RESTRICT"), index=True)
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(12), default="active")  # active / historical / pending
    note: Mapped[str | None] = mapped_column(Text)
    # 社会关系默认仅创建者与管理员可见；族谱关系始终公开。迁移时已有关系保持公开（server_default）
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_true())
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(8), default="member")  # admin / member
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("persons.id", ondelete="SET NULL"), unique=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    # 社会关系（同学、老师等）功能：默认关闭，由管理员为账号单独开通；管理员始终可用
    can_use_social: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # 改密/重置后使旧会话失效
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class KinshipRule(Base):
    """称谓规则：关系链 → 称谓。称谓可写成“年长者|年幼者”。"""

    __tablename__ = "kinship_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    chain: Mapped[str] = mapped_column(String(128), unique=True)
    term: Mapped[str] = mapped_column(String(64))
    dialect: Mapped[str] = mapped_column(String(16), default="mandarin")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    username: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(16))  # create / update / delete / login …
    object_type: Mapped[str] = mapped_column(String(32), index=True)
    object_id: Mapped[int | None] = mapped_column(Integer, index=True)
    summary: Mapped[str | None] = mapped_column(String(256))
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Place(Base):
    """地址 → 坐标缓存（高德坐标系 GCJ-02）。lat 为空表示地理编码未找到。"""

    __tablename__ = "places"

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str] = mapped_column(String(256), unique=True)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    formatted: Mapped[str | None] = mapped_column(String(256))
    updated_by: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Article(Base):
    """家族文章。content 按 format 存 Markdown 或富文本 HTML（前端渲染时净化）。"""

    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(128))
    summary: Mapped[str | None] = mapped_column(String(256))
    content: Mapped[str] = mapped_column(Text, default="")
    format: Mapped[str] = mapped_column(String(8), default="markdown")  # markdown / html
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
