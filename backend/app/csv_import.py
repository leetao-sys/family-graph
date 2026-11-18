"""CSV 批量导入：人物与关系。

- 整个文件先逐行校验，任何一行有错则全部不导入（返回带行号的错误清单），避免导入一半；
- 日期写法宽松：1960、1960-5、1960/5/1、1960.5.1、1960年5月1日；农历可写成“1798年闰二月初二寅时”；
- 关系按“人物A 是 人物B 的 [关系]”填写，人物用姓名指代，同名时写成“姓名#出生年”或“#人物编号”；
- 重复导入同一文件不会产生重复关系。
"""
import csv
import io
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .lunar import EARTHLY_BRANCHES, LUNAR_MONTHS, lunar_day_name
from .models import Person, RelationType, Relationship, User
from .schemas import PersonIn, RelationshipIn
from .services import relation_types, validate_relationship

MAX_ROWS = 5000

# 表头 → 字段（同义表头都可识别）
PERSON_HEADERS = {
    "姓": "surname", "名": "given_name", "性别": "gender",
    "出生日期": "birth_date", "农历": "birth_lunar", "农历生日": "birth_lunar", "闰月": "birth_lunar_leap",
    "出生时辰": "birth_hour", "时辰": "birth_hour",
    "在世": "is_living", "去世日期": "death_date", "去世农历": "death_lunar", "农历忌日": "death_lunar",
    "去世闰月": "death_lunar_leap", "去世时辰": "death_hour",
    "曾用名": "former_name", "字号": "courtesy_name", "字/号": "courtesy_name", "字 / 号": "courtesy_name",
    "封赠功名": "honorific", "封赠/功名": "honorific", "封赠 / 功名": "honorific", "封赠": "honorific",
    "功名": "honorific", "雅号": "honorific", "名号": "honorific",
    "昵称": "nickname", "字辈": "generation_name", "排行": "birth_order", "分支": "branch", "所属分支": "branch",
    "堂号": "hall_name", "籍贯": "native_place", "出生地": "birth_place", "出生地（今）": "birth_place_modern", "安葬地": "burial_place", "出嫁地": "marriage_place", "民族": "ethnicity",
    "现居地": "residence", "手机": "phone", "邮箱": "email", "工作单位": "employer", "职业": "occupation",
    "简介": "bio",
}
PERSON_TEMPLATE_COLUMNS = [
    "姓", "名", "性别", "出生日期", "农历", "闰月", "出生时辰", "在世", "去世日期", "去世农历", "去世闰月", "去世时辰",
    "曾用名", "字号", "昵称", "字辈", "排行", "分支", "堂号", "籍贯", "出生地", "出生地（今）", "安葬地", "出嫁地", "民族", "现居地", "手机", "邮箱",
    "工作单位", "职业", "简介", "封赠功名",
]
REL_HEADERS = {"人物A": "a", "人物a": "a", "关系": "type", "人物B": "b", "人物b": "b", "开始时间": "start_date",
               "结束时间": "end_date", "状态": "status", "备注": "note"}
REL_TEMPLATE_COLUMNS = ["人物A", "关系", "人物B", "开始时间", "结束时间", "状态", "备注"]

GENDER_WORDS = {"男": "male", "女": "female", "male": "male", "female": "female", "M": "male", "F": "female",
                "": "unknown", "未知": "unknown"}
TRUE_WORDS = {"是", "y", "yes", "true", "1", "√", "✓", "农历", "闰", "在世"}
FALSE_WORDS = {"否", "n", "no", "false", "0", "×", "公历", "", "已故", "去世"}

# 关系写法 → (关系类型编码, 是否把 A、B 对调)。“A 是 B 的 X”
REL_WORDS = {
    **{w: ("parent", False) for w in ("父亲", "母亲", "父母", "父", "母", "爸爸", "妈妈", "亲子")},
    **{w: ("parent", True) for w in ("儿子", "女儿", "子女", "子", "女")},
    **{w: ("adoptive", False) for w in ("养父", "养母", "养父母", "收养")},
    **{w: ("adoptive", True) for w in ("养子", "养女", "养子女")},
    **{w: ("step", False) for w in ("继父", "继母", "继父母", "继亲")},
    **{w: ("step", True) for w in ("继子", "继女", "继子女")},
    **{w: ("spouse", False) for w in ("配偶", "丈夫", "妻子", "夫妻", "夫", "妻", "老公", "老婆")},
    **{w: ("sibling", False) for w in ("兄弟姐妹", "哥哥", "弟弟", "姐姐", "妹妹", "兄弟", "姐妹", "兄", "弟", "姐", "妹")},
}
GENDER_HINT = {w: "male" for w in ("父亲", "父", "爸爸", "儿子", "子", "丈夫", "夫", "老公", "哥哥", "弟弟", "兄", "弟",
                                    "养父", "继父", "养子", "继子", "兄弟")}
GENDER_HINT |= {w: "female" for w in ("母亲", "母", "妈妈", "女儿", "女", "妻子", "妻", "老婆", "姐姐", "妹妹", "姐", "妹",
                                      "养母", "继母", "养女", "继女", "姐妹")}
STATUS_WORDS = {"": "active", "有效": "active", "在婚": "active", "历史": "historical", "离异": "historical",
                "离婚": "historical", "已结束": "historical", "结束": "historical"}

_MONTH_NAMES = {name: i + 1 for i, name in enumerate(LUNAR_MONTHS)} | {
    "一月": 1, "十一月": 11, "十二月": 12, "冬月": 11, "腊月": 12, "正月": 1}
_DAY_NAMES = {lunar_day_name(d): d for d in range(1, 31)}
_LUNAR_RE = re.compile(
    r"^(?:农历)?\s*(\d{4})年(?:(闰)?(" + "|".join(sorted(_MONTH_NAMES, key=len, reverse=True)) + r"))?"
    r"(" + "|".join(sorted(_DAY_NAMES, key=len, reverse=True)) + r")?"
    r"(?:([" + "".join(EARTHLY_BRANCHES) + r"])时)?$"
)
_SOLAR_RE = re.compile(r"^(\d{4})(?:\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})\s*日?)?\s*月?)?\s*年?$")


def decode(raw: bytes) -> list[tuple[int, dict]]:
    for enc in ("utf-8-sig", "gbk"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise HTTPException(422, "无法识别文件编码，请使用 UTF-8 或 GBK（Excel 另存为“CSV UTF-8”即可）")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for i, row in enumerate(reader, start=2):
        values = {(k or "").strip(): (v or "").strip() for k, v in row.items() if k}
        first = next(iter(values.values()), "")
        if not any(values.values()) or first.startswith("#"):  # 空行、说明行
            continue
        rows.append((i, values))
    if len(rows) > MAX_ROWS:
        raise HTTPException(413, f"单次最多导入 {MAX_ROWS} 行")
    return rows


def _bool(v: str, field: str) -> bool:
    s = v.strip().lower()
    if s in TRUE_WORDS:
        return True
    if s in FALSE_WORDS:
        return False
    raise ValueError(f"{field}应填“是”或“否”，而不是“{v}”")


def parse_date(v: str, field: str) -> tuple[str | None, dict]:
    """返回 (YYYY[-MM[-DD]], 额外字段)。农历文字会顺带给出 lunar / leap / hour。"""
    s = v.strip().replace("　", "")
    if not s:
        return None, {}
    m = _LUNAR_RE.match(s)
    if m and (m.group(3) or s.startswith("农历")):
        y, leap, mon, day, hour = m.groups()
        date = y
        if mon:
            date += f"-{_MONTH_NAMES[mon]:02d}"
            if day:
                date += f"-{_DAY_NAMES[day]:02d}"
        extra = {"lunar": True, "leap": bool(leap)}
        if hour:
            extra["hour"] = hour
        return date, extra
    m = _SOLAR_RE.match(s)
    if not m:
        raise ValueError(f"{field}“{v}”无法识别，可写成 1960、1960-05、1960-05-01 或 1798年二月初二")
    y, mo, d = m.groups()
    out = y
    if mo:
        out += f"-{int(mo):02d}"
        if d:
            out += f"-{int(d):02d}"
    return out, {}


_FIELD_LABELS = {}
for _h, _f in PERSON_HEADERS.items():
    _FIELD_LABELS.setdefault(_f, _h)
_FIELD_LABELS.update({"start_date": "开始时间", "end_date": "结束时间", "status": "状态", "note": "备注"})


def _first_error(e: ValidationError) -> str:
    """把校验错误转成带中文列名的提示。"""
    msgs = []
    for err in e.errors():
        msg = str(err.get("msg", "")).replace("Value error, ", "")
        if err.get("type") == "string_too_long":
            msg = f"内容过长（最多 {err.get('ctx', {}).get('max_length')} 个字）"
        loc = [x for x in (err.get("loc") or ()) if isinstance(x, str)]
        label = _FIELD_LABELS.get(loc[-1]) if loc else None
        msgs.append(f"{label}：{msg}" if label and label not in msg else msg)
    return "；".join(msgs)


def _person_row(values: dict) -> dict:
    data: dict = {}
    for header, value in values.items():
        field = PERSON_HEADERS.get(header)
        if field and value != "":
            data[field] = value
    data["gender"] = GENDER_WORDS.get(data.get("gender", ""), None)
    if data["gender"] is None:
        raise ValueError(f"性别应填“男”或“女”，而不是“{values.get('性别')}”")
    for kind, word in (("birth", "出生日期"), ("death", "去世日期")):
        raw = data.pop(f"{kind}_date", "")
        date, extra = parse_date(raw, word)
        data[f"{kind}_date"] = date
        if f"{kind}_lunar" in data:
            data[f"{kind}_lunar"] = _bool(data[f"{kind}_lunar"], "农历" if kind == "birth" else "去世农历")
        elif extra.get("lunar"):
            data[f"{kind}_lunar"] = True
        if f"{kind}_lunar_leap" in data:
            data[f"{kind}_lunar_leap"] = _bool(data[f"{kind}_lunar_leap"], "闰月")
        elif extra.get("leap"):
            data[f"{kind}_lunar_leap"] = True
        hour = data.get(f"{kind}_hour") or extra.get("hour")
        data[f"{kind}_hour"] = hour.rstrip("时") if hour else None
    if "is_living" in data:
        data["is_living"] = _bool(data["is_living"], "在世")
    if data.get("death_date"):
        data["is_living"] = False
    if "birth_order" in data:
        if not str(data["birth_order"]).isdigit():
            raise ValueError(f"排行应填数字，而不是“{data['birth_order']}”")
        data["birth_order"] = int(data["birth_order"])
    data["surname"] = data.get("surname", "")
    data["given_name"] = data.get("given_name", "")
    if not (data["surname"] or data["given_name"]):
        raise ValueError("缺少姓名")
    return data


def import_persons(db: Session, admin: User, raw: bytes) -> dict:
    rows = decode(raw)
    if not rows:
        raise HTTPException(422, "文件中没有数据行")
    errors, warnings, bodies = [], [], []
    existing = {f"{p.surname}{p.given_name}" for p in db.scalars(select(Person))}
    seen_in_file: dict[tuple, int] = {}
    for i, values in rows:
        try:
            body = PersonIn(**_person_row(values))
        except ValidationError as e:
            errors.append(f"第 {i} 行：{_first_error(e)}")
            continue
        except ValueError as e:
            errors.append(f"第 {i} 行：{e}")
            continue
        name = f"{body.surname}{body.given_name}"
        key = (name, body.birth_date or "")
        if key in seen_in_file:
            warnings.append(f"第 {i} 行：与第 {seen_in_file[key]} 行同名且出生日期相同（{name}），请确认不是重复")
        seen_in_file.setdefault(key, i)
        if name in existing:
            warnings.append(f"第 {i} 行：系统中已有同名人物“{name}”，将新增一位（若是同一人请删去此行）")
        bodies.append(body)
    if errors:
        return {"created": 0, "errors": errors[:200], "warnings": warnings[:200]}
    for body in bodies:
        db.add(Person(**body.model_dump(exclude={"privacy"}), privacy={}, created_by=admin.id))
    return {"created": len(bodies), "errors": [], "warnings": warnings[:200]}


# —— 关系 ——
def _resolve(db: Session, ref: str, cache: dict) -> Person:
    ref = ref.strip()
    if not ref:
        raise ValueError("人物不能为空")
    if ref in cache:
        return cache[ref]
    m = re.fullmatch(r"#(\d+)", ref)
    if m:
        p = db.get(Person, int(m.group(1)))
        if not p:
            raise ValueError(f"人物编号 {ref} 不存在")
        cache[ref] = p
        return p
    name, _, qual = ref.partition("#")
    name, qual = name.strip(), qual.strip()
    cands = [p for p in db.scalars(select(Person)) if f"{p.surname}{p.given_name}" == name]
    if qual:
        cands = [p for p in cands if (p.birth_date or "").startswith(qual)]
    if not cands:
        raise ValueError(f"找不到人物“{ref}”，请先导入人物")
    if len(cands) > 1:
        years = "、".join(sorted({(p.birth_date or "?")[:4] for p in cands}))
        raise ValueError(f"“{name}”有 {len(cands)} 位同名（出生年 {years}），请写成“{name}#出生年”或“#人物编号”")
    cache[ref] = cands[0]
    return cands[0]


def _rel_type(db: Session, word: str) -> tuple[RelationType, bool]:
    w = word.strip()
    types = relation_types(db)
    if w in REL_WORDS:
        code, swap = REL_WORDS[w]
        t = next((x for x in types.values() if x.code == code), None)
        if t:
            return t, swap
    for x in types.values():
        if w in (x.name, x.code, x.forward_name):
            return x, False
        if not x.symmetric and w == x.reverse_name:
            return x, True
    names = "、".join(x.name for x in sorted(types.values(), key=lambda x: x.sort))
    raise ValueError(f"无法识别关系“{word}”，可用：父亲、母亲、儿子、女儿、配偶、哥哥、姐姐…，或关系类型名称（{names}）")


def import_relationships(db: Session, admin: User, raw: bytes) -> dict:
    rows = decode(raw)
    if not rows:
        raise HTTPException(422, "文件中没有数据行")
    errors, warnings = [], []
    created = skipped = 0
    cache: dict[str, Person] = {}
    for i, values in rows:
        data = {REL_HEADERS[k]: v for k, v in values.items() if k in REL_HEADERS}
        try:
            a, b = _resolve(db, data.get("a", ""), cache), _resolve(db, data.get("b", ""), cache)
            word = data.get("type", "").strip()
            t, swap = _rel_type(db, word)
            expect = GENDER_HINT.get(word)
            if expect and a.gender in ("male", "female") and a.gender != expect:
                warnings.append(f"第 {i} 行：{a.name} 的性别与“{word}”不符，请核对")
            if swap:
                a, b = b, a
            status = STATUS_WORDS.get(data.get("status", "").strip())
            if status is None:
                raise ValueError(f"状态应为“有效”或“离异/历史”，而不是“{data.get('status')}”")
            start, _ = parse_date(data.get("start_date", ""), "开始时间")
            end, _ = parse_date(data.get("end_date", ""), "结束时间")
            body = RelationshipIn(person_a_id=a.id, person_b_id=b.id, type_id=t.id, start_date=start, end_date=end,
                                  status=status, note=data.get("note") or None)
        except ValidationError as e:
            errors.append(f"第 {i} 行：{_first_error(e)}")
            continue
        except ValueError as e:
            errors.append(f"第 {i} 行：{e}")
            continue
        pairs = [(a.id, b.id), (b.id, a.id)] if t.symmetric else [(a.id, b.id)]
        dup = db.scalar(select(Relationship.id).where(
            Relationship.type_id == t.id,
            or_(*[(Relationship.person_a_id == x) & (Relationship.person_b_id == y) for x, y in pairs]),
        ))
        if dup:
            skipped += 1
            continue
        errs, warns = validate_relationship(db, a.id, b.id, t, viewer=admin, status=status)
        if errs:
            errors.append(f"第 {i} 行（{a.name} - {b.name}）：{'；'.join(errs)}")
            continue
        warnings += [f"第 {i} 行（{a.name} - {b.name}）：{w}" for w in warns]
        db.add(Relationship(**body.model_dump(exclude={"confirm", "is_public"}), is_public=t.category != "social",
                            created_by=admin.id))
        db.flush()  # 后续行的校验（如一人只能有两位生父母、不能同时有两位配偶）要看到前面的行
        created += 1
    if errors:
        db.rollback()
        return {"created": 0, "skipped": 0, "errors": errors[:200], "warnings": warnings[:200]}
    return {"created": created, "skipped": skipped, "errors": [], "warnings": warnings[:200]}


def persons_template() -> str:
    lines = [
        ",".join(PERSON_TEMPLATE_COLUMNS),
        "# 说明：以 # 开头的行会被忽略。性别填 男/女；“农历”“闰月”“在世”填 是/否；时辰填 子 丑 寅 … 亥。"
        "日期可写 1960、1960-05、1960-05-01；农历也可直接写“1798年闰二月初二寅时”。",
        "李,守德,男,1905-02-02,是,,寅,否,1990-10-15,是,,午,,,,守,1,长房,陇西堂,广东梅州,,汉,,,,,,耕读传家,例赠登仕郎",
        "王,秀英,女,1907年六月廿一子时,,,,否,1995-01-20,,,,,,,,,,,,,,,,,,,,例赠孺人",
        "李,振华,男,1930-02-18,否,,,否,2015-06-30,否,,,,,,振,1,长房,陇西堂,广东梅州,梅县,汉,,,,梅县中学,教师,,",
        "陈,淑芬,女,1932-10-05,,,,是,,,,,,,,,,,,,,,广东梅州,,,,,,",
    ]
    return "﻿" + "\n".join(lines) + "\n"


def relationships_template() -> str:
    lines = [
        ",".join(REL_TEMPLATE_COLUMNS),
        "# 说明：每行表示“人物A 是 人物B 的 [关系]”。关系可写 父亲 母亲 儿子 女儿 配偶 丈夫 妻子 哥哥 弟弟 姐姐 妹妹 养父 继母 等，"
        "也可写关系类型名称（亲子、配偶、兄弟姐妹、朋友…）。同名人物写成“姓名#出生年”（如 李浩然#2006）或“#人物编号”。"
        "状态填 有效 或 离异（历史）；时间写法同人物表。兄弟姐妹由共同父母自动推导，一般不用单独填写。",
        "李守德,丈夫,王秀英,1926,,,",
        "李守德,父亲,李振华,,,,",
        "王秀英,母亲,李振华,,,,",
        "李振华,配偶,陈淑芬,1953-10,,,",
    ]
    return "﻿" + "\n".join(lines) + "\n"
