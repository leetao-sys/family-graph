"""演示数据与性能基准数据。

    python -m app.demo            # 演示家族（约 60 人，含社会关系与两个成员账号）
    python -m app.demo --large    # 追加基准数据：3000 人物、约 2 万条关系（设计文档第 8 章）
"""
import random
import sys

from sqlalchemy import select

from .db import SessionLocal
from .models import Person, RelationType, Relationship, User
from .security import hash_password
from .seed import init_db

# 角色: (姓名, 性别, 出生, 去世, 字辈)
FAMILY = {
    "曾祖父": ("李守德", "male", "1905-03-12", "1990-11-02", "守"),
    "曾祖母": ("王秀英", "female", "1907-08-01", "1995-01-20", None),
    "爷爷": ("李振华", "male", "1930-02-18", "2015-06-30", "振"),
    "奶奶": ("陈淑芬", "female", "1932-10-05", None, None),
    "叔祖父": ("李振国", "male", "1935-04-09", None, "振"),
    "叔祖母": ("赵桂兰", "female", "1936-12-25", None, None),
    "姑奶奶": ("李振英", "female", "1928-06-16", "2010-03-03", "振"),
    "外公": ("张德明", "male", "1933-07-07", "2018-09-09", None),
    "外婆": ("刘玉珍", "female", "1935-01-15", None, None),
    "伯父": ("李建国", "male", "1955-10-01", None, "建"),
    "伯母": ("孙丽华", "female", "1956-03-08", None, None),
    "父亲": ("李建军", "male", "1958-08-01", None, "建"),
    "母亲": ("张慧敏", "female", "1960-05-04", None, None),
    "叔叔": ("李建民", "male", "1961-09-10", None, "建"),
    "婶婶": ("周美玲", "female", "1962-02-14", None, None),
    "姑姑": ("李建芳", "female", "1963-11-11", None, "建"),
    "姑父": ("吴志强", "male", "1962-06-06", None, None),
    "舅舅": ("张立新", "male", "1956-12-12", None, None),
    "舅妈": ("何雪梅", "female", "1957-01-01", None, None),
    "姨妈": ("张慧芳", "female", "1957-09-09", None, None),
    "姨父": ("王海涛", "male", "1955-04-04", None, None),
    "小姨": ("张慧琳", "female", "1964-07-21", None, None),
    "小姨父": ("郑国平", "male", "1963-03-30", None, None),
    "堂伯": ("李建成", "male", "1956-05-05", None, "建"),
    "堂叔": ("李建业", "male", "1962-10-10", None, "建"),
    "我": ("李明远", "male", "1985-06-18", None, "明"),
    "妻子": ("林晓雯", "female", "1986-09-23", None, None),
    "姐姐": ("李明珠", "female", "1982-02-02", None, "明"),
    "姐夫": ("黄俊杰", "male", "1981-12-01", None, None),
    "外甥": ("黄子轩", "male", "2008-04-12", None, None),
    "弟弟": ("李明哲", "male", "1988-03-15", None, "明"),
    "弟媳": ("许静", "female", "1989-05-20", None, None),
    "侄女": ("李若曦", "female", "2014-10-08", None, "若"),
    "岳父": ("林国栋", "male", "1958-01-26", None, None),
    "岳母": ("方秀琴", "female", "1960-11-30", None, None),
    "大舅子": ("林晓峰", "male", "1983-08-08", None, None),
    "小姨子": ("林晓雨", "female", "1990-04-01", None, None),
    "连襟": ("马骏", "male", "1989-07-17", None, None),
    "堂哥": ("李明辉", "male", "1980-01-09", None, "明"),
    "堂嫂": ("谢婉清", "female", "1981-02-27", None, None),
    "堂侄": ("李浩然", "male", "2006-06-01", None, "浩"),
    "堂妹": ("李明月", "female", "1990-09-15", None, "明"),
    "表弟": ("吴昊", "male", "1987-12-24", None, None),
    "小明": ("王小明", "male", "1983-03-03", None, None),
    "表姐": ("张雨涵", "female", "1984-05-16", None, None),
    "儿子": ("李子墨", "male", "2012-08-19", None, "子"),
    "女儿": ("李子涵", "female", "2015-12-05", None, "子"),
}

PARENTS = [
    ("曾祖父", "爷爷"), ("曾祖母", "爷爷"), ("曾祖父", "叔祖父"), ("曾祖母", "叔祖父"),
    ("曾祖父", "姑奶奶"), ("曾祖母", "姑奶奶"),
    *[(p, c) for p in ("爷爷", "奶奶") for c in ("伯父", "父亲", "叔叔", "姑姑")],
    *[(p, c) for p in ("外公", "外婆") for c in ("舅舅", "姨妈", "母亲", "小姨")],
    ("叔祖父", "堂伯"), ("叔祖父", "堂叔"), ("叔祖母", "堂伯"), ("叔祖母", "堂叔"),
    *[(p, c) for p in ("父亲", "母亲") for c in ("姐姐", "我", "弟弟")],
    ("姐姐", "外甥"), ("姐夫", "外甥"), ("弟弟", "侄女"), ("弟媳", "侄女"),
    *[(p, c) for p in ("岳父", "岳母") for c in ("大舅子", "妻子", "小姨子")],
    ("伯父", "堂哥"), ("伯母", "堂哥"), ("堂哥", "堂侄"), ("堂嫂", "堂侄"),
    ("叔叔", "堂妹"), ("婶婶", "堂妹"), ("姑姑", "表弟"), ("姑父", "表弟"),
    ("姨妈", "小明"), ("姨父", "小明"), ("舅舅", "表姐"), ("舅妈", "表姐"),
    *[(p, c) for p in ("我", "妻子") for c in ("儿子", "女儿")],
]
SPOUSES = [
    ("曾祖父", "曾祖母"), ("爷爷", "奶奶"), ("叔祖父", "叔祖母"), ("外公", "外婆"),
    ("伯父", "伯母"), ("父亲", "母亲"), ("叔叔", "婶婶"), ("姑父", "姑姑"),
    ("舅舅", "舅妈"), ("姨父", "姨妈"), ("小姨父", "小姨"), ("我", "妻子"),
    ("姐夫", "姐姐"), ("弟弟", "弟媳"), ("岳父", "岳母"), ("连襟", "小姨子"), ("堂哥", "堂嫂"),
]
COLLEAGUES = ["赵磊", "钱芳", "孙伟", "周婷", "吴刚", "郑丽", "冯涛", "陈静", "褚亮", "卫红", "蒋鹏", "沈悦"]
FRIENDS = ["韩冰", "杨帆", "朱琳"]
CLASSMATES = ["秦川", "尤佳", "许诺"]

SURNAMES = list("王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈")
GIVEN = list("伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英华玉兰萍红建文辉力东鹏飞宇浩然子涵梓轩一诺欣怡")


# 地图与年谱演示数据：角色 -> (出生地, 现居地)
PLACES = {
    "曾祖父": ("广东省梅州市梅县区", None), "爷爷": ("广东省梅州市梅县区", None),
    "奶奶": ("广东省梅州市兴宁市", "广东省梅州市梅江区"), "叔祖父": ("广东省梅州市梅县区", "广西壮族自治区南宁市"),
    "外公": ("湖南省长沙市", None), "外婆": ("湖南省湘潭市", "湖南省长沙市"),
    "伯父": ("广东省梅州市", "广东省深圳市"), "父亲": ("广东省梅州市", "广东省广州市"),
    "母亲": ("湖南省长沙市", "广东省广州市"), "叔叔": ("广东省梅州市", "上海市"),
    "姑姑": ("广东省梅州市", "福建省厦门市"), "舅舅": ("湖南省长沙市", "湖南省长沙市"),
    "姨妈": ("湖南省长沙市", "湖北省武汉市"), "小姨": ("湖南省长沙市", "北京市"),
    "我": ("广东省广州市", "浙江省杭州市"), "妻子": ("江苏省南京市", "浙江省杭州市"),
    "姐姐": ("广东省广州市", "广东省深圳市"), "弟弟": ("广东省广州市", "四川省成都市"),
    "岳父": ("江苏省南京市", "江苏省南京市"), "堂哥": ("广东省深圳市", "广东省深圳市"),
    "小明": ("湖北省武汉市", "北京市"), "儿子": ("浙江省杭州市", "浙江省杭州市"),
}
MARRIAGES = {
    ("曾祖父", "曾祖母"): "1926", ("爷爷", "奶奶"): "1953-10", ("外公", "外婆"): "1954-05-01",
    ("父亲", "母亲"): "1980-01-26", ("伯父", "伯母"): "1978", ("叔叔", "婶婶"): "1986",
    ("我", "妻子"): "2010-10-01", ("姐夫", "姐姐"): "2006-05-01", ("弟弟", "弟媳"): "2012-12-12",
    ("堂哥", "堂嫂"): "2004",
}


def enrich_demo(db) -> int:
    """为已存在的演示家族补充地点与结婚日期（只填空字段，可重复执行）。"""
    by_name = {f"{p.surname}{p.given_name}": p for p in db.scalars(select(Person))}
    role_person = {role: by_name.get(v[0]) for role, v in FAMILY.items()}
    n = 0
    for role, (birth_place, residence) in PLACES.items():
        p = role_person.get(role)
        if p and not p.birth_place and not p.residence:
            p.birth_place, p.residence = birth_place, residence
            n += 1
    spouse = db.scalar(select(RelationType).where(RelationType.code == "spouse"))
    for (a, b), date in MARRIAGES.items():
        pa, pb = role_person.get(a), role_person.get(b)
        if not (pa and pb and spouse):
            continue
        r = db.scalar(select(Relationship).where(
            Relationship.type_id == spouse.id,
            ((Relationship.person_a_id == pa.id) & (Relationship.person_b_id == pb.id))
            | ((Relationship.person_a_id == pb.id) & (Relationship.person_b_id == pa.id)),
        ))
        if r and not r.start_date:
            r.start_date = date
    db.commit()
    return n


def _types(db):
    return {t.code: t.id for t in db.scalars(select(RelationType))}


def seed_demo() -> None:
    init_db()
    with SessionLocal() as db:
        if db.scalar(select(Person).where(Person.surname == "李", Person.given_name == "明远")):
            n = enrich_demo(db)
            print(f"演示数据已存在，已补充 {n} 人的地点与结婚日期")
            return
        t = _types(db)
        ids = {}
        for role, (name, gender, birth, death, gen_name) in FAMILY.items():
            surname, given = (name[:1], name[1:])
            p = Person(surname=surname, given_name=given, gender=gender, birth_date=birth, death_date=death,
                       is_living=death is None, generation_name=gen_name,
                       native_place="广东梅州" if surname == "李" else None, branch="长房" if role in ("伯父", "堂哥") else None)
            db.add(p)
            db.flush()
            ids[role] = p.id
        me = ids["我"]
        p_me = db.get(Person, me)
        p_me.phone, p_me.email, p_me.occupation, p_me.employer = "13800001234", "mingyuan@example.com", "软件工程师", "星河科技"
        p_me.bio = "家谱系统的发起人，喜欢整理老照片。"
        rels = [Relationship(person_a_id=ids[a], person_b_id=ids[b], type_id=t["parent"]) for a, b in PARENTS]
        rels += [Relationship(person_a_id=ids[a], person_b_id=ids[b], type_id=t["spouse"], start_date=None) for a, b in SPOUSES]
        rels.append(Relationship(person_a_id=me, person_b_id=ids["小明"], type_id=t["friend"], note="从小一起长大"))
        rels.append(Relationship(person_a_id=me, person_b_id=ids["小明"], type_id=t["classmate"], start_date="1998", end_date="2004"))
        rels.append(Relationship(person_a_id=me, person_b_id=ids["大舅子"], type_id=t["classmate"], start_date="2003", end_date="2007"))
        rels.append(Relationship(person_a_id=ids["父亲"], person_b_id=ids["岳父"], type_id=t["comrade"], start_date="1976", end_date="1980"))
        rels.append(Relationship(person_a_id=ids["堂伯"], person_b_id=me, type_id=t["teacher"], note="高中数学老师"))
        for group, code in ((COLLEAGUES, "colleague"), (FRIENDS, "friend"), (CLASSMATES, "classmate")):
            for i, name in enumerate(group):
                p = Person(surname=name[0], given_name=name[1:], gender="male" if i % 2 == 0 else "female",
                           birth_date=str(1980 + i % 9))
                db.add(p)
                db.flush()
                rels.append(Relationship(person_a_id=me, person_b_id=p.id, type_id=t[code]))
                if code == "colleague" and i < 3:
                    rels.append(Relationship(person_a_id=ids["妻子"], person_b_id=p.id, type_id=t["friend"]))
        for r in rels:
            r.is_public = True  # 演示数据中的关系全部公开
        db.add_all(rels)
        db.add(User(username="liming", password_hash=hash_password("Demo1234"), role="member", person_id=me,
                    must_change_password=False))
        db.add(User(username="xiaowen", password_hash=hash_password("Demo1234"), role="member",
                    person_id=ids["妻子"], must_change_password=False))
        db.commit()
        enrich_demo(db)
        seed_v2_extras(db)
        print(f"已写入演示家族：{len(ids) + len(COLLEAGUES) + len(FRIENDS) + len(CLASSMATES)} 人，{len(rels)} 条关系")
        print("成员账号：liming / Demo1234（李明远），xiaowen / Demo1234（林晓雯）")


def seed_v2_extras(db) -> None:
    """v2 功能演示：农历生卒、近期生日、离异再婚、同名人物、仅自己可见的关系、富文本简介与文章。可重复执行。"""
    from datetime import date, timedelta

    from lunardate import LunarDate

    from .models import Article

    if db.scalar(select(Person).where(Person.surname == "刘", Person.given_name == "春燕")):
        print("v2 演示数据已存在")
        return
    t = _types(db)
    by_name = {f"{p.surname}{p.given_name}": p for p in db.scalars(select(Person))}
    users = {u.username: u for u in db.scalars(select(User))}
    today = date.today()

    def lunar_of(d: date) -> str:
        ld = LunarDate.from_solar_date(d.year, d.month, d.day)
        return f"{ld.month:02d}-{ld.day:02d}", ld.isLeapMonth

    # 1. 农历出生 / 去世（可混合）
    p = by_name["李守德"]
    p.birth_date, p.birth_lunar, p.birth_hour = "1905-02-02", True, "寅"
    p.death_date, p.death_lunar, p.death_hour = "1990-10-15", True, "午"
    p.bio_format = "markdown"
    p.bio = ("## 生平\n\n李氏迁粤第十八世，字**守德**，以耕读传家。\n\n"
             "- 1926 年与王秀英成婚\n- 育有二子一女\n\n> 耕读传家久，诗书继世长。")
    p = by_name["王秀英"]  # 农历出生、公历去世
    p.birth_date, p.birth_lunar, p.birth_hour = "1907-06-21", True, "子"
    p = by_name["李振华"]  # 农历出生、公历去世
    p.birth_date, p.birth_lunar = "1930-01-19", True
    p.bio_format = "html"
    p.bio = "<p>早年随父务农，后任<strong>梅县中学</strong>教师三十余年。</p><ul><li>爱好书法</li><li>主持修订族谱</li></ul>"

    # 2. 近期生日（相对今天计算，保证铃铛里有内容）
    def solar_birthday(name: str, offset: int):
        d = today + timedelta(days=offset)
        p = by_name[name]
        p.birth_date, p.birth_lunar = f"{p.birth_date[:4]}-{d.month:02d}-{d.day:02d}", False

    def lunar_birthday(name: str, offset: int, hour: str | None = None):
        md, leap = lunar_of(today + timedelta(days=offset))
        p = by_name[name]
        p.birth_date, p.birth_lunar, p.birth_lunar_leap, p.birth_hour = f"{p.birth_date[:4]}-{md}", True, leap, hour

    solar_birthday("张慧敏", 0)    # 今天：母亲（公历）
    lunar_birthday("陈淑芬", 3, "辰")  # 3 天后：奶奶（农历）
    solar_birthday("林晓雯", 6)    # 6 天后：妻子（公历）
    lunar_birthday("李建国", 12)   # 12 天后：伯父（农历）
    solar_birthday("李子涵", 20)   # 20 天后：女儿（公历）
    by_name["刘玉珍"].privacy = {"birth_date": "self"}
    solar_birthday("刘玉珍", 2)    # 外婆：生日设为仅本人可见，成员账号不会收到提醒

    # 3. 离异与再婚：叔叔李建民先娶刘春燕（1990 年离异，育有一子），1992 年再娶周美玲
    first = Person(surname="刘", given_name="春燕", gender="female", birth_date="1963-04-18", native_place="广东梅州")
    son = Person(surname="李", given_name="明杰", gender="male", birth_date="1986-07-09", generation_name="明",
                 native_place="广东梅州")
    db.add_all([first, son])
    db.flush()
    uncle = by_name["李建民"]
    rels = [
        Relationship(person_a_id=uncle.id, person_b_id=first.id, type_id=t["spouse"], status="historical",
                     start_date="1984-05", end_date="1990-03", note="1990 年协议离婚"),
        Relationship(person_a_id=uncle.id, person_b_id=son.id, type_id=t["parent"]),
        Relationship(person_a_id=first.id, person_b_id=son.id, type_id=t["parent"]),
    ]
    spouse_rel = db.scalar(select(Relationship).where(
        Relationship.type_id == t["spouse"],
        ((Relationship.person_a_id == uncle.id) & (Relationship.person_b_id == by_name["周美玲"].id))
        | ((Relationship.person_a_id == by_name["周美玲"].id) & (Relationship.person_b_id == uncle.id)),
    ))
    if spouse_rel:
        spouse_rel.start_date = "1992-10-01"
    # 4. 同名人物：弟弟李明哲之子也叫李浩然（与堂侄李浩然同名）
    namesake = Person(surname="李", given_name="浩然", gender="male", birth_date="2016-03-21", generation_name="浩",
                      native_place="广东梅州")
    db.add(namesake)
    db.flush()
    rels += [
        Relationship(person_a_id=by_name["李明哲"].id, person_b_id=namesake.id, type_id=t["parent"]),
        Relationship(person_a_id=by_name["许静"].id, person_b_id=namesake.id, type_id=t["parent"]),
    ]
    # 5. 仅自己可见的社会关系（liming 创建，xiaowen 看不到；另一条公开）
    liming, xiaowen = users.get("liming"), users.get("xiaowen")
    if liming:
        liming.can_use_social = True  # 演示：liming 已开通社会关系功能，xiaowen 未开通
    me = by_name["李明远"]
    if liming:
        rels.append(Relationship(person_a_id=me.id, person_b_id=by_name["韩冰"].id, type_id=t["partner"],
                                 note="私下合伙做小生意", is_public=False, created_by=liming.id))
        rels.append(Relationship(person_a_id=me.id, person_b_id=son.id,
                                 type_id=t["friend"], note="堂兄弟也是好朋友", is_public=True,
                                 created_by=liming.id))
    if xiaowen:
        rels.append(Relationship(person_a_id=by_name["林晓雯"].id, person_b_id=by_name["钱芳"].id, type_id=t["neighbor"],
                                 note="老邻居", is_public=False, created_by=xiaowen.id))
    for r in rels:
        if r.is_public is None:
            r.is_public = True
    db.add_all(rels)

    # 6. 文章
    admin = next((u for u in users.values() if u.role == "admin"), None)
    db.add(Article(title="李氏家族源流考", format="markdown", author_id=liming.id if liming else None,
                   summary="陇西堂李氏自中原南迁至梅州的经过",
                   content="## 一、堂号由来\n\n李氏堂号为**陇西堂**，源自陇西郡。\n\n"
                           "## 二、迁徙路线\n\n1. 中原\n2. 江西宁都\n3. 广东梅州\n\n> 水有源，木有本。"))
    db.add(Article(title="2026 年清明祭祖安排", format="html", author_id=admin.id if admin else None,
                   content="<h2>时间</h2><p>农历<strong>二月廿八</strong>上午九点，在祖祠集合。</p>"
                           "<h2>分工</h2><ul><li>长房：准备祭品</li><li>二房：联系车辆</li></ul>"))
    db.commit()
    print("已写入 v2 演示数据：农历生卒、近期生日、离异再婚、同名人物、私密关系、文章")


def seed_large(persons: int = 3000, relations: int = 20000, seed: int = 42) -> None:
    """生成一个多代大家族 + 随机社会关系，用于性能基准。"""
    init_db()
    rnd = random.Random(seed)
    with SessionLocal() as db:
        t = _types(db)
        social = [t[c] for c in ("friend", "colleague", "classmate", "neighbor", "comrade")]
        created: list[tuple[int, str, int]] = []  # (id, gender, birth year)
        rels: list[Relationship] = []

        def new_person(gender, year, surname=None):
            p = Person(surname=surname or rnd.choice(SURNAMES), given_name=rnd.choice(GIVEN) + rnd.choice(GIVEN),
                       gender=gender, birth_date=f"{year}-{rnd.randint(1, 12):02d}", is_living=year > 1940)
            db.add(p)
            return p

        couples = []
        for _ in range(12):  # 12 个始祖家庭
            h, w = new_person("male", 1880), new_person("female", 1882)
            db.flush()
            rels.append(Relationship(person_a_id=h.id, person_b_id=w.id, type_id=t["spouse"]))
            couples.append((h, w, 1880))
            created += [(h.id, "male", 1880), (w.id, "female", 1882)]
        while len(created) < persons and couples:
            h, w, year = couples.pop(0)
            for _ in range(rnd.randint(2, 4)):
                if len(created) >= persons:
                    break
                cy = year + rnd.randint(22, 32)
                g = rnd.choice(("male", "female"))
                c = new_person(g, cy, h.surname if rnd.random() < 0.9 else None)
                db.flush()
                rels += [Relationship(person_a_id=h.id, person_b_id=c.id, type_id=t["parent"]),
                         Relationship(person_a_id=w.id, person_b_id=c.id, type_id=t["parent"])]
                created.append((c.id, g, cy))
                if cy < 2000 and len(created) < persons:
                    sp = new_person("female" if g == "male" else "male", cy + rnd.randint(-3, 3))
                    db.flush()
                    created.append((sp.id, sp.gender, cy))
                    rels.append(Relationship(person_a_id=c.id, person_b_id=sp.id, type_id=t["spouse"]))
                    couples.append((c, sp, cy) if g == "male" else (sp, c, cy))
        ids = [c[0] for c in created]
        while len(rels) < relations:
            a, b = rnd.sample(ids, 2)
            rels.append(Relationship(person_a_id=a, person_b_id=b, type_id=rnd.choice(social)))
        for r in rels:
            r.is_public = True  # 演示数据中的关系全部公开
        db.add_all(rels)
        db.commit()
        print(f"已写入基准数据：{len(created)} 人，{len(rels)} 条关系")


if __name__ == "__main__":
    if "--large" in sys.argv:
        seed_large()
    else:
        seed_demo()
