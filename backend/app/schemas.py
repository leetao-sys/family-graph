import re
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

from .lunar import EARTHLY_BRANCHES
from .models import GENDERS, PRIVACY_SCOPES, PRIVATE_FIELDS

DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


def _check_date(v: str | None) -> str | None:
    if v in (None, ""):
        return None
    if not DATE_RE.match(v):
        raise ValueError("日期格式应为 YYYY、YYYY-MM 或 YYYY-MM-DD")
    return v


def _check_solar(v: str | None, label: str = "日期") -> None:
    """公历日期必须真实存在（如不允许 8 月 32 日、平年 2 月 29 日）。"""
    if not v:
        return
    parts = [int(x) for x in v.split("-")]
    try:
        date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
    except ValueError:
        raise ValueError(f"{label}不存在：{v}")
    if parts[0] < 1 or (len(parts) > 1 and not 1 <= parts[1] <= 12):
        raise ValueError(f"{label}不存在：{v}")


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str = Field(max_length=128)


class PersonIn(BaseModel):
    surname: str = Field(default="", max_length=32)
    given_name: str = Field(default="", max_length=64)
    former_name: str | None = Field(default=None, max_length=64)
    courtesy_name: str | None = Field(default=None, max_length=64)
    honorific: str | None = Field(default=None, max_length=128)  # 封赠 / 功名
    nickname: str | None = Field(default=None, max_length=64)
    gender: str = "unknown"
    birth_date: str | None = None
    birth_lunar: bool = False
    birth_lunar_leap: bool = False
    birth_hour: str | None = None  # 时辰地支：子 丑 … 亥
    death_date: str | None = None
    death_lunar: bool = False
    death_lunar_leap: bool = False
    death_hour: str | None = None
    is_living: bool = True
    generation_name: str | None = Field(default=None, max_length=16)
    birth_order: int | None = Field(default=None, ge=1, le=99)
    branch: str | None = Field(default=None, max_length=64)
    hall_name: str | None = Field(default=None, max_length=64)
    native_place: str | None = Field(default=None, max_length=128)
    ethnicity: str | None = Field(default=None, max_length=32)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=128)
    residence: str | None = Field(default=None, max_length=128)
    employer: str | None = Field(default=None, max_length=128)
    occupation: str | None = Field(default=None, max_length=64)
    birth_place: str | None = Field(default=None, max_length=128)
    birth_place_modern: str | None = Field(default=None, max_length=128)
    burial_place: str | None = Field(default=None, max_length=128)
    marriage_place: str | None = Field(default=None, max_length=128)
    bio: str | None = Field(default=None, max_length=50000)
    bio_format: str = Field(default="markdown", pattern=r"^(markdown|html)$")
    notes: str | None = Field(default=None, max_length=5000)
    privacy: dict[str, str] | None = None

    @field_validator("birth_date", "death_date")
    @classmethod
    def _date(cls, v):
        return _check_date(v)

    @field_validator("birth_hour", "death_hour")
    @classmethod
    def _hour(cls, v):
        if v in (None, ""):
            return None
        if v not in EARTHLY_BRANCHES:
            raise ValueError("时辰取值无效")
        return v

    @model_validator(mode="after")
    def _lunar(self):
        for kind in ("birth", "death"):
            value, lunar = getattr(self, f"{kind}_date"), getattr(self, f"{kind}_lunar")
            if not lunar:
                _check_solar(value, "出生日期" if kind == "birth" else "去世日期")
            if lunar and value and len(value) >= 7:
                parts = [int(x) for x in value.split("-")]
                if not 1 <= parts[1] <= 12 or (len(parts) == 3 and not 1 <= parts[2] <= 30):
                    raise ValueError("农历日期无效：月为 1–12，日为 1–30")
            if not lunar:
                setattr(self, f"{kind}_lunar_leap", False)
        return self

    @field_validator("gender")
    @classmethod
    def _gender(cls, v):
        if v not in GENDERS:
            raise ValueError("性别取值无效")
        return v

    @field_validator("privacy")
    @classmethod
    def _privacy(cls, v):
        if v is None:
            return v
        for k, s in v.items():
            if k not in PRIVATE_FIELDS or s not in PRIVACY_SCOPES:
                raise ValueError(f"隐私设置无效：{k}={s}")
        return v

    @field_validator("surname", "given_name")
    @classmethod
    def _strip(cls, v):
        return v.strip()


class PersonCreateIn(PersonIn):
    """新增人物时可直接指定父母，等同于同时添加两条亲子关系。"""

    father_id: int | None = None
    mother_id: int | None = None
    confirm: bool = False  # 父母关系有告警（如年龄矛盾）时需确认后才保存


class RelationshipIn(BaseModel):
    person_a_id: int
    person_b_id: int
    type_id: int
    start_date: str | None = None
    end_date: str | None = None
    status: str = "active"
    note: str | None = Field(default=None, max_length=1000)
    is_public: bool = False  # 社会关系是否让其他人可见；族谱关系忽略此项（始终公开）
    confirm: bool = False  # 存在告警时需确认后才保存

    @field_validator("start_date", "end_date")
    @classmethod
    def _date(cls, v):
        v = _check_date(v)
        _check_solar(v)
        return v

    @model_validator(mode="after")
    def _range(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("结束时间早于开始时间")
        return self

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("active", "historical", "pending"):
            raise ValueError("状态取值无效")
        return v


class RelationTypeIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,31}$")
    name: str = Field(min_length=1, max_length=32)
    category: str = Field(pattern=r"^(kin|social)$")
    symmetric: bool = True
    forward_name: str = Field(min_length=1, max_length=32)
    reverse_name: str = Field(min_length=1, max_length=32)
    kinship_role: str | None = Field(default=None, pattern=r"^(parent|adoptive|step|spouse|sibling)$")
    sort: int = 100
    color: str = Field(default="#64748b", pattern=r"^#[0-9a-fA-F]{6}$")


class UserCreateIn(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_.@\-]+$")
    password: str | None = None
    role: str = Field(default="member", pattern=r"^(admin|member)$")
    person_id: int | None = None


class UserUpdateIn(BaseModel):
    role: str | None = Field(default=None, pattern=r"^(admin|member)$")
    person_id: int | None = None
    is_active: bool | None = None
    can_use_social: bool | None = None
    unbind: bool = False


class KinshipRuleIn(BaseModel):
    chain: str = Field(min_length=1, max_length=128, pattern=r"^[a-z&,]+$")
    term: str = Field(min_length=1, max_length=64)


class SettingsIn(BaseModel):
    site_name: str | None = Field(default=None, max_length=64)
    relation_confirm_required: bool | None = None
    amap_key: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9]*$")
    amap_security_code: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9]*$")


class PlaceIn(BaseModel):
    address: str = Field(min_length=1, max_length=256)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    formatted: str | None = Field(default=None, max_length=256)


class ArticleIn(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    summary: str | None = Field(default=None, max_length=256)
    content: str = Field(default="", max_length=200000)
    format: str = Field(default="markdown", pattern=r"^(markdown|html)$")

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("请填写标题")
        return v


class ArticleImportIn(BaseModel):
    articles: list[ArticleIn] = Field(min_length=1, max_length=500)
