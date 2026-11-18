"""消息通知：近期生日提醒（区分农历/公历，农历换算为对应的公历日期）。"""
from collections import deque
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..lunar import format_lunar, next_lunar_birthday, next_solar_birthday
from ..models import Person, User
from ..services import graph_data, person_brief
from .history import _visibility

router = APIRouter(prefix="/api", tags=["消息通知"])


def blood_kin_ids(gd, root: int | None) -> set[int]:
    """本人 + 血亲/旁亲：只走父母、子女、兄弟姐妹，不走配偶和社会关系。"""
    if root is None or root not in gd.kin.persons:
        return set()
    seen = {root}
    q = deque([root])
    while q:
        x = q.popleft()
        for p, kind in gd.kin.parents.get(x, ()):
            if kind == "step":
                continue
            if p not in seen:
                seen.add(p)
                q.append(p)
        for c, kind in gd.kin.children.get(x, ()):
            if kind == "step":
                continue
            if c not in seen:
                seen.add(c)
                q.append(c)
        for s in gd.kin.siblings(x):
            if s not in seen:
                seen.add(s)
                q.append(s)
    return seen


def upcoming_birthdays(db: Session, user: User, days: int, today: date,
                       allowed: set[int] | None = None) -> list[dict]:
    gd = graph_data(db)
    visible = _visibility(db, user)
    end = today + timedelta(days=days)
    items = []
    # 已故的人不提醒：既看“在世”标记，也排除填了去世日期的人，防止导入数据不一致
    rows = db.scalars(select(Person).where(
        Person.is_living.is_(True), Person.death_date.is_(None), Person.birth_date.like("____-__-__")
    ))
    for p in rows:
        if allowed is not None and p.id not in allowed:
            continue
        if not visible(p, "birth_date"):  # 生日受隐私保护，看不到完整日期的人不提醒
            continue
        y, m, d = (int(x) for x in p.birth_date.split("-"))
        if p.birth_lunar:
            nxt = next_lunar_birthday(m, d, p.birth_lunar_leap, today)
            if not nxt:
                continue
            when, birth_year_of = nxt
            age = birth_year_of - y
            birth_text = format_lunar(p.birth_date, p.birth_lunar_leap, p.birth_hour)
        else:
            when = next_solar_birthday(m, d, today)
            age = when.year - y
            birth_text = p.birth_date
        if when > end:
            continue
        items.append({
            "id": f"birthday-{p.id}-{when.isoformat()}",
            "person": person_brief(p, gd),
            "calendar": "lunar" if p.birth_lunar else "solar",
            "birth_date": p.birth_date,
            "birth_text": birth_text,
            "date": when.isoformat(),  # 今年（或明年）对应的公历日期
            "days_until": (when - today).days,
            "age": age if age > 0 else None,
            "is_self": p.id == user.person_id,
        })
    items.sort(key=lambda x: (x["days_until"], x["person"]["name"]))
    return items


@router.get("/notifications/birthdays")
def birthdays(
    days: int = Query(30, ge=0, le=366),
    today: date | None = Query(None, description="测试用：指定“今天”"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    t = today or date.today()
    gd = graph_data(db)
    bound = bool(user.person_id and user.person_id in gd.kin.persons)
    allowed = blood_kin_ids(gd, user.person_id)
    return {
        "today": t.isoformat(),
        "days": days,
        "bound": bound,
        "scope": "blood",
        "reason": None if bound else "账号尚未绑定人物",
        "items": upcoming_birthdays(db, user, days, t, allowed),
    }
