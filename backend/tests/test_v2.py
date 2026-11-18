"""v2 新功能：农历生日、文章、关系可见性、生日提醒。"""
from datetime import date

import pytest

from app.lunar import format_lunar, ganzhi_year, lunar_day_name, lunar_to_solar, next_lunar_birthday

from .conftest import login, make_client


def _types(c):
    return {t["code"]: t["id"] for t in c.get("/api/relation-types").json()}


def _member(admin, username, person_id):
    r = admin.post("/api/admin/users", json={"username": username, "person_id": person_id})
    assert r.status_code == 201, r.text
    c = make_client()
    login(c, username, r.json()["initial_password"])
    assert c.post("/api/auth/change-password",
                  json={"old_password": r.json()["initial_password"], "new_password": "Member123"}).status_code == 200
    return c


def _person(c, **kw):
    r = c.post("/api/persons", json={"gender": "male", **kw})
    assert r.status_code == 201, r.text
    return r.json()


# —— 农历 ——
def test_lunar_formatting():
    assert ganzhi_year(2026) == "丙午"
    assert ganzhi_year(1984) == "甲子"
    assert [lunar_day_name(d) for d in (1, 10, 11, 20, 21, 30)] == ["初一", "初十", "十一", "二十", "廿一", "三十"]
    assert format_lunar("2026-01-05", hour="丑") == "丙午年正月初五丑时（2026）"
    assert format_lunar("2026-01-05") == "丙午年正月初五（2026）"
    assert format_lunar("1990-12") == "庚午年腊月（1990）"
    assert format_lunar("2025-06-01", leap=True) == "乙巳年闰六月初一（2025）"


def test_lunar_to_solar():
    assert lunar_to_solar(2026, 1, 5) == date(2026, 2, 21)  # 2026 年春节为 2 月 17 日
    assert lunar_to_solar(2025, 6, 1, leap=True) == date(2025, 7, 25)
    # 当年无该闰月 → 按正常月；小月无三十 → 廿九
    assert lunar_to_solar(2026, 6, 1, leap=True) == lunar_to_solar(2026, 6, 1)
    assert lunar_to_solar(2026, 2, 30) == lunar_to_solar(2026, 2, 29)
    # 腊月生日在公历次年 1–2 月
    d, y = next_lunar_birthday(12, 20, False, date(2026, 11, 7))
    assert y == 2026 and d.year == 2027


def test_person_lunar_fields(admin):
    p = _person(admin, surname="农", given_name="历", birth_date="2026-01-05", birth_lunar=True, birth_hour="丑")
    assert p["birth_lunar"] and p["birth_hour"] == "丑" and p["birth_lunar_leap"] is False
    r = admin.post("/api/persons", json={"given_name": "x", "birth_date": "2026-13-01", "birth_lunar": True})
    assert r.status_code == 422
    r = admin.post("/api/persons", json={"given_name": "x", "birth_hour": "午时"})
    assert r.status_code == 422


def test_person_lunar_death_date(admin):
    # 出生农历、去世公历（及反之）可分别选择
    p = _person(admin, surname="古", given_name="人", birth_date="1798-02-02", birth_lunar=True, birth_hour="寅",
                is_living=False, death_date="1860-03-15", death_lunar=True, death_hour="午", death_lunar_leap=True)
    assert p["death_lunar"] and p["death_hour"] == "午" and p["death_lunar_leap"]
    assert format_lunar("1798-02-02", hour="寅") == "戊午年二月初二寅时（1798）"
    r = admin.put(f"/api/persons/{p['id']}", json={"surname": "古", "given_name": "人", "birth_date": "1798-02-02",
                                                   "birth_lunar": True, "death_date": "1860-05-01", "death_lunar": False,
                                                   "death_lunar_leap": True, "is_living": False})
    assert r.status_code == 200
    out = r.json()
    assert out["death_lunar"] is False and out["death_lunar_leap"] is False and out["birth_lunar"] is True
    bad = admin.post("/api/persons", json={"given_name": "x", "death_date": "1860-13-01", "death_lunar": True})
    assert bad.status_code == 422
    assert admin.post("/api/persons", json={"given_name": "x", "death_hour": "寅时"}).status_code == 422


def test_bio_markdown(admin):
    p = _person(admin, given_name="简介", bio="# 标题\n\n**粗体**", bio_format="markdown")
    assert p["bio_format"] == "markdown" and p["bio"].startswith("# 标题")
    r = admin.put(f"/api/persons/{p['id']}", json={"given_name": "简介", "bio": "<p><b>富文本</b></p>", "bio_format": "html"})
    assert r.json()["bio_format"] == "html"
    assert admin.put(f"/api/persons/{p['id']}", json={"given_name": "简介", "bio_format": "doc"}).status_code == 422


# —— 文章 ——
def test_articles_crud_and_permissions(admin):
    me = _person(admin, surname="文", given_name="作者")
    other = _person(admin, surname="文", given_name="读者")
    author = _member(admin, "article_author", me["id"])
    reader = _member(admin, "article_reader", other["id"])

    r = author.post("/api/articles", json={"title": "  家族往事  ", "content": "## 第一章\n\n内容 **加粗**"})
    assert r.status_code == 201, r.text
    art = r.json()
    assert art["title"] == "家族往事" and art["format"] == "markdown" and art["can_edit"]
    assert art["author"]["name"] == "文作者"
    assert author.post("/api/articles", json={"title": "   "}).status_code == 422
    assert author.post("/api/articles", json={"title": "x", "format": "doc"}).status_code == 422

    lst = reader.get("/api/articles?q=家族").json()
    item = next(i for i in lst["items"] if i["id"] == art["id"])
    assert "content" not in item and "第一章" in item["excerpt"] and not item["can_edit"]
    got = reader.get(f"/api/articles/{art['id']}").json()
    assert got["content"].startswith("## 第一章")

    # 只有作者与管理员可以修改、删除
    assert reader.put(f"/api/articles/{art['id']}", json={"title": "篡改"}).status_code == 403
    assert reader.delete(f"/api/articles/{art['id']}").status_code == 403
    r = author.put(f"/api/articles/{art['id']}", json={"title": "家族往事（修订）", "content": "<p>富文本</p>", "format": "html"})
    assert r.status_code == 200 and r.json()["format"] == "html"
    assert admin.get(f"/api/articles/{art['id']}").json()["can_edit"]
    assert any(i["id"] == art["id"] for i in author.get("/api/articles?mine=true").json()["items"])
    assert not any(i["id"] == art["id"] for i in reader.get("/api/articles?mine=true").json()["items"])
    assert admin.delete(f"/api/articles/{art['id']}").status_code == 200
    assert reader.get(f"/api/articles/{art['id']}").status_code == 404


# —— 社会关系：管理员按账号开通，只有创建者本人与管理员可见 ——
@pytest.fixture(scope="module")
def vis(admin):
    t = _types(admin)
    a = _person(admin, surname="可", given_name="甲", birth_date="1990")
    b = _person(admin, surname="可", given_name="乙", birth_date="1991")
    c = _person(admin, surname="可", given_name="丙", birth_date="1992")
    ma = _member(admin, "vis_a", a["id"])
    mb = _member(admin, "vis_b", b["id"])
    uid = {u["username"]: u["id"] for u in admin.get("/api/admin/users").json()}
    return {"t": t, "a": a["id"], "b": b["id"], "c": c["id"], "ma": ma, "mb": mb, "uid": uid}


def _social_codes(client):
    return {x["code"] for x in client.get("/api/relation-types").json() if x["category"] == "social"}


def test_social_feature_off_by_default(admin, vis):
    t, ma = vis["t"], vis["ma"]
    me = ma.get("/api/auth/me").json()
    assert me["can_use_social"] is False
    # 未开通：看不到社会关系类型，也不能登记
    assert _social_codes(ma) == set()
    assert {"parent", "spouse"} <= {x["code"] for x in ma.get("/api/relation-types").json()}
    r = ma.post("/api/relationships", json={"person_a_id": vis["a"], "person_b_id": vis["c"], "type_id": t["friend"]})
    assert r.status_code == 422
    # 管理员可以看到并维护全部关系类型
    assert "classmate" in _social_codes(admin) and admin.get("/api/auth/me").json()["can_use_social"] is True
    users = {u["username"]: u for u in admin.get("/api/admin/users").json()}
    assert users["vis_a"]["social_enabled"] is False


def test_social_relationship_only_visible_to_creator(admin, vis):
    t, ma, mb = vis["t"], vis["ma"], vis["mb"]
    assert admin.put(f"/api/admin/users/{vis['uid']['vis_a']}", json={"can_use_social": True}).status_code == 200
    assert ma.get("/api/auth/me").json()["can_use_social"] is True
    assert "classmate" in _social_codes(ma)
    r = ma.post("/api/relationships", json={"person_a_id": vis["a"], "person_b_id": vis["c"], "type_id": t["friend"],
                                            "is_public": True})  # is_public 被忽略：社会关系一律仅自己可见
    assert r.status_code == 201 and r.json()["is_public"] is False and r.json()["status"] == "active"
    rid = r.json()["id"]

    # 创建者本人与管理员可见
    assert any(x["id"] == rid for x in ma.get(f"/api/persons/{vis['c']}/relationships").json())
    assert any(x["id"] == rid for x in admin.get(f"/api/persons/{vis['c']}/relationships").json())
    assert any(e["id"] == rid for e in ma.get(f"/api/graph/network?center={vis['a']}").json()["edges"])
    assert ma.get(f"/api/graph/path?from={vis['a']}&to={vis['c']}").json()["found"] is True

    # 其他成员（无论是否开通）在所有接口中都看不到
    for other in (mb,):
        assert not any(x["id"] == rid for x in other.get(f"/api/persons/{vis['c']}/relationships").json())
        assert not any(x["id"] == rid for x in other.get(f"/api/relationships?person_id={vis['c']}").json()["items"])
        net = other.get(f"/api/graph/network?center={vis['c']}").json()
        assert not any(e["id"] == rid for e in net["edges"])
        assert other.get(f"/api/graph/path?from={vis['a']}&to={vis['c']}").json()["found"] is False
        assert other.delete(f"/api/relationships/{rid}").status_code == 404
    admin.put(f"/api/admin/users/{vis['uid']['vis_b']}", json={"can_use_social": True})
    assert not any(x["id"] == rid for x in mb.get(f"/api/persons/{vis['c']}/relationships").json())

    # 管理员登记的社会关系，开通了的成员也看不到（只看自己登记的）
    r2 = admin.post("/api/relationships", json={"person_a_id": vis["a"], "person_b_id": vis["b"], "type_id": t["neighbor"]})
    assert r2.status_code == 201
    assert not any(x["id"] == r2.json()["id"] for x in ma.get(f"/api/persons/{vis['a']}/relationships").json())

    # 关闭功能后自己登记的也看不到（数据保留，重新开通后恢复）
    admin.put(f"/api/admin/users/{vis['uid']['vis_a']}", json={"can_use_social": False})
    assert not any(x["id"] == rid for x in ma.get(f"/api/persons/{vis['c']}/relationships").json())
    assert ma.delete(f"/api/relationships/{rid}").status_code == 404
    admin.put(f"/api/admin/users/{vis['uid']['vis_a']}", json={"can_use_social": True})
    assert any(x["id"] == rid for x in ma.get(f"/api/persons/{vis['c']}/relationships").json())


def test_kin_relationships_always_visible(admin, vis):
    t = vis["t"]
    r = admin.post("/api/relationships", json={"person_a_id": vis["b"], "person_b_id": vis["c"],
                                               "type_id": t["sibling"], "is_public": False})
    assert r.status_code == 201 and r.json()["is_public"] is True
    for client in (vis["ma"], vis["mb"]):
        assert any(x["id"] == r.json()["id"] for x in client.get(f"/api/persons/{vis['c']}/relationships").json())


# —— 生日提醒 ——
def test_birthday_reminders(admin):
    solar = _person(admin, surname="生", given_name="公历", birth_date="1990-11-20")
    lunar = _person(admin, surname="生", given_name="农历", birth_date="1960-10-01", birth_lunar=True, birth_hour="子")
    far = _person(admin, surname="生", given_name="很远", birth_date="1990-06-01")
    yearonly = _person(admin, surname="生", given_name="只有年", birth_date="1990")
    dead = _person(admin, surname="生", given_name="已故", birth_date="1930-11-10", is_living=False, death_date="2000")
    # 只填了去世日期、未取消“在世”的人，创建时自动视为已故，同样不提醒
    dead2 = _person(admin, surname="生", given_name="漏勾", birth_date="1931-11-12", death_date="2001")
    assert dead2["is_living"] is False
    dead3 = _person(admin, surname="生", given_name="已故农历", birth_date="1930-10-01", birth_lunar=True,
                    is_living=False)
    hidden = _person(admin, surname="生", given_name="隐私", birth_date="1980-11-12",
                     privacy={"birth_date": "self"})
    viewer_p = _person(admin, surname="生", given_name="观察者")
    viewer = _member(admin, "bday_viewer", viewer_p["id"])

    # 农历 2026 年十月初一 = 公历 2026-11-09
    assert lunar_to_solar(2026, 10, 1) == date(2026, 11, 9)
    data = viewer.get("/api/notifications/birthdays?days=30&today=2026-11-07").json()
    by_id = {i["person"]["id"]: i for i in data["items"]}
    assert solar["id"] in by_id and lunar["id"] in by_id
    for p in (far, yearonly, dead, dead2, dead3, hidden):
        assert p["id"] not in by_id
    assert by_id[solar["id"]]["calendar"] == "solar" and by_id[solar["id"]]["days_until"] == 13
    assert by_id[solar["id"]]["age"] == 36
    li = by_id[lunar["id"]]
    assert li["calendar"] == "lunar" and li["date"] == "2026-11-09" and li["days_until"] == 2 and li["age"] == 66
    assert li["birth_text"] == "庚子年十月初一子时（1960）"
    days = [i["days_until"] for i in data["items"]]
    assert days == sorted(days)

    # 管理员能看到受隐私保护的生日
    admin_ids = {i["person"]["id"] for i in admin.get("/api/notifications/birthdays?days=30&today=2026-11-07").json()["items"]}
    assert hidden["id"] in admin_ids


# —— 同名人物 ——
def test_same_name_hint(admin):
    t = _types(admin)
    dad = _person(admin, surname="重", given_name="名父")
    mom = _person(admin, surname="重", given_name="名母", gender="female")
    wife = _person(admin, surname="重", given_name="名妻", gender="female")
    a = _person(admin, surname="重", given_name="名人", birth_date="1980")
    b = _person(admin, surname="重", given_name="名人", birth_date="1990")
    for parent in (dad, mom):
        assert admin.post("/api/relationships", json={"person_a_id": parent["id"], "person_b_id": a["id"],
                                                      "type_id": t["parent"]}).status_code == 201
    assert admin.post("/api/relationships", json={"person_a_id": b["id"], "person_b_id": wife["id"], "type_id": t["spouse"],
                                                  "status": "historical"}).status_code == 201
    items = {p["id"]: p for p in admin.get("/api/persons?q=重名人").json()["items"]}
    assert items[a["id"]]["hint"] == "父 重名父 · 母 重名母"
    assert items[b["id"]]["hint"] == "前配偶 重名妻"


# —— 日期合法性与一夫一妻 ——
def test_invalid_solar_dates_rejected(admin):
    for bad in ("2003-08-32", "2023-02-29", "2003-13", "2003-00-10"):
        r = admin.post("/api/persons", json={"given_name": "日期", "birth_date": bad})
        assert r.status_code == 422, bad
    assert admin.post("/api/persons", json={"given_name": "日期", "birth_date": "2024-02-29"}).status_code == 201
    # 农历没有公历的“月份天数”限制：二月三十合法
    assert admin.post("/api/persons", json={"given_name": "日期", "birth_date": "2024-02-30",
                                            "birth_lunar": True}).status_code == 201
    a = _person(admin, given_name="日期甲")
    b = _person(admin, given_name="日期乙")
    t = _types(admin)
    r = admin.post("/api/relationships", json={"person_a_id": a["id"], "person_b_id": b["id"], "type_id": t["friend"],
                                               "start_date": "2010-04-31"})
    assert r.status_code == 422
    r = admin.post("/api/relationships", json={"person_a_id": a["id"], "person_b_id": b["id"], "type_id": t["friend"],
                                               "start_date": "2010-05", "end_date": "2009"})
    assert r.status_code == 422


def test_one_active_spouse_at_a_time(admin):
    t = _types(admin)
    husband = _person(admin, surname="婚", given_name="丈夫")
    wife1 = _person(admin, surname="婚", given_name="前妻", gender="female")
    wife2 = _person(admin, surname="婚", given_name="新妻", gender="female")

    def marry(a, b, **kw):
        return admin.post("/api/relationships", json={"person_a_id": a["id"], "person_b_id": b["id"],
                                                      "type_id": t["spouse"], **kw})

    r1 = marry(husband, wife1)
    assert r1.status_code == 201
    r = marry(husband, wife2, confirm=True)
    assert r.status_code == 422 and "已有配偶" in r.json()["detail"]
    # 登记一段已结束的婚姻不受限
    assert marry(husband, wife2, status="historical", confirm=True).status_code == 201
    # 原婚姻改为离异后可以再婚
    rid = r1.json()["id"]
    assert admin.put(f"/api/relationships/{rid}", json={"person_a_id": husband["id"], "person_b_id": wife1["id"],
                                                        "type_id": t["spouse"], "status": "historical",
                                                        "confirm": True}).status_code == 200
    wife3 = _person(admin, surname="婚", given_name="三妻", gender="female")
    assert marry(husband, wife3, confirm=True).status_code == 201

    # 丧偶再婚：原配偶已故不受限
    widower = _person(admin, surname="婚", given_name="鳏夫")
    late = _person(admin, surname="婚", given_name="亡妻", gender="female", is_living=False, death_date="2000")
    assert marry(widower, late).status_code == 201
    assert marry(widower, _person(admin, surname="婚", given_name="续弦", gender="female"), confirm=True).status_code == 201

    # 本人已故的旧时多配偶：只提示确认
    ancestor = _person(admin, surname="婚", given_name="先祖", is_living=False, death_date="1900")
    old1 = _person(admin, surname="婚", given_name="原配", gender="female")
    assert marry(ancestor, old1).status_code == 201
    old2 = _person(admin, surname="婚", given_name="侧室", gender="female")
    r = marry(ancestor, old2)
    assert r.status_code == 409 and any("旧时多配偶" in w for w in r.json()["detail"]["warnings"])
    assert marry(ancestor, old2, confirm=True).status_code == 201


def test_widowed_and_remarried_marriage_is_ended(admin):
    t = _types(admin)
    man = _person(admin, surname="丧", given_name="夫")
    first = _person(admin, surname="丧", given_name="原配", gender="female")
    second = _person(admin, surname="丧", given_name="继室", gender="female")
    marry = lambda a, b: admin.post("/api/relationships", json={"person_a_id": a["id"], "person_b_id": b["id"],
                                                               "type_id": t["spouse"], "confirm": True})
    assert marry(man, first).status_code == 201

    def spouses():
        tree = admin.get(f"/api/graph/tree?root={man['id']}&mode=descendants&gen=1").json()
        return {(s["a"], s["b"]): s for s in tree["spouses"]}

    key1 = tuple(sorted((man["id"], first["id"])))
    # 原配去世但未再婚：仍是有效婚姻
    admin.put(f"/api/persons/{first['id']}", json={"surname": "丧", "given_name": "原配", "gender": "female",
                                                   "is_living": False})
    assert spouses()[key1]["active"] is True
    # 再婚后：与已故原配的婚姻显示为已结束
    assert marry(man, second).status_code == 201
    s = spouses()
    assert s[key1]["active"] is False and s[key1]["widowed"] is True
    assert s[tuple(sorted((man["id"], second["id"])))]["active"] is True
    rels = {r["other"]["name"]: r["role_of_other"] for r in admin.get(f"/api/persons/{man['id']}/relationships").json()}
    assert rels["丧原配"] == "已故配偶" and rels["丧继室"] == "配偶"
    net = admin.get(f"/api/graph/network?center={man['id']}").json()
    assert {e["label"] for e in net["edges"] if first["id"] in (e["source"], e["target"])} == {"已故配偶"}


# —— 族谱“血亲”视图：直系血亲 + 三代以内旁系血亲 ——
def test_tree_blood_mode(admin):
    t = _types(admin)
    P = {}
    for key, g in [("ggf", "male"), ("gf", "male"), ("gm", "female"), ("great_uncle", "male"), ("dad", "male"),
                   ("uncle", "male"), ("uncle_wife", "female"), ("cousin", "female"), ("cousin_kid", "male"),
                   ("mgf", "male"), ("mgm", "female"), ("mom", "female"), ("maunt", "female"), ("mcousin", "male"),
                   ("me", "male"), ("wife", "female"), ("sister", "female"), ("sister_husband", "male"),
                   ("nephew", "male"), ("grand_nephew", "male"), ("son", "male"), ("grandson", "male"),
                   ("stepbro", "male"), ("explicit_aunt", "female"), ("explicit_cousin", "male")]:
        P[key] = _person(admin, surname="血", given_name=key, gender=g)["id"]

    def parent(a, b, kind="parent"):
        assert admin.post("/api/relationships", json={"person_a_id": P[a], "person_b_id": P[b],
                                                      "type_id": t[kind], "confirm": True}).status_code == 201

    def link(a, b, kind):
        assert admin.post("/api/relationships", json={"person_a_id": P[a], "person_b_id": P[b],
                                                      "type_id": t[kind], "confirm": True}).status_code == 201

    for a, b in [("ggf", "gf"), ("ggf", "great_uncle"), ("gf", "dad"), ("gm", "dad"), ("gf", "uncle"), ("gm", "uncle"),
                 ("uncle", "cousin"), ("uncle_wife", "cousin"), ("cousin", "cousin_kid"),
                 ("mgf", "mom"), ("mgm", "mom"), ("mgf", "maunt"), ("mgm", "maunt"), ("maunt", "mcousin"),
                 ("dad", "me"), ("mom", "me"), ("dad", "sister"), ("mom", "sister"),
                 ("sister", "nephew"), ("nephew", "grand_nephew"), ("me", "son"), ("son", "grandson"),
                 ("explicit_aunt", "explicit_cousin")]:
        parent(a, b)
    parent("mom", "stepbro", "step")
    link("gf", "gm", "spouse")
    link("mgf", "mgm", "spouse")
    link("dad", "mom", "spouse")
    link("uncle", "uncle_wife", "spouse")
    link("me", "wife", "spouse")
    link("sister", "sister_husband", "spouse")
    link("explicit_aunt", "dad", "sibling")  # 只登记了兄弟姐妹关系，未录入共同父母

    tree = admin.get(f"/api/graph/tree?root={P['me']}&mode=blood&gen=2").json()
    got = {int(k) for k in tree["persons"]}
    name = {v: k for k, v in P.items()}
    expected = {"gf", "gm", "mgf", "mgm", "dad", "mom", "uncle", "uncle_wife", "cousin", "maunt", "mcousin",
                "me", "wife", "sister", "sister_husband", "nephew", "son", "grandson",
                "explicit_aunt", "explicit_cousin"}
    assert {name[x] for x in got} == expected
    # 超出三代的旁系（堂/表兄弟姐妹的子女、侄孙、叔祖）和继亲不在其中；曾祖父超出 gen=2
    assert {"cousin_kid", "grand_nephew", "great_uncle", "stepbro", "ggf"}.isdisjoint({name[x] for x in got})
    assert {"a": min(P["dad"], P["explicit_aunt"]), "b": max(P["dad"], P["explicit_aunt"])} in tree["siblings"]
    # gen=3 时曾祖父（直系）出现，叔祖（旁系四代）仍不出现
    got3 = {name[int(k)] for k in admin.get(f"/api/graph/tree?root={P['me']}&mode=blood&gen=3").json()["persons"]}
    assert "ggf" in got3 and "great_uncle" not in got3
    # gen=1 时仍包含祖父母，以便显示伯叔姑舅姨
    got1 = {name[int(k)] for k in admin.get(f"/api/graph/tree?root={P['me']}&mode=blood&gen=1").json()["persons"]}
    assert {"gf", "uncle", "cousin"} <= got1 and "grandson" not in got1


# —— 关系联动 ——
def test_relationship_followup_suggestions(admin):
    t = _types(admin)
    dad = _person(admin, surname="联", given_name="父", birth_date="1950")["id"]
    mom = _person(admin, surname="联", given_name="母", gender="female", birth_date="1952")["id"]
    big = _person(admin, surname="联", given_name="长女", gender="female", birth_date="1975")["id"]
    new = _person(admin, surname="联", given_name="幼子", birth_date="1980")["id"]

    def rel(a, b, code, **kw):
        r = admin.post("/api/relationships", json={"person_a_id": a, "person_b_id": b, "type_id": t[code],
                                                   "confirm": True, **kw})
        assert r.status_code == 201, r.text
        return r.json()

    rel(dad, mom, "spouse")
    rel(dad, big, "parent")
    rel(mom, big, "parent")
    # 给父亲新增儿子：建议把父亲的配偶（母亲）也加为儿子的母亲，默认勾选
    r = rel(dad, new, "parent")
    s = r["suggestions"]
    assert len(s) == 1 and s[0]["person_a_id"] == mom and s[0]["person_b_id"] == new and s[0]["checked"]
    assert s[0]["type_id"] == t["parent"] and "母亲" in s[0]["label"]
    # 采纳建议后，兄弟姐妹关系由共同父母自动成立，人物关系列表里能看到（只读、推导）
    rel(s[0]["person_a_id"], s[0]["person_b_id"], "parent")
    sibs = [x for x in admin.get(f"/api/persons/{new}/relationships").json() if x["status"] == "derived"]
    assert [(x["other"]["id"], x["role_of_other"], x["can_edit"]) for x in sibs] == [(big, "姐姐", False)]
    rels_big = {x["other"]["id"]: x["role_of_other"] for x in admin.get(f"/api/persons/{big}/relationships").json()}
    assert rels_big[new] == "弟弟"
    # 之后再给父亲添加子女，仍会建议母亲
    assert rel(dad, _person(admin, surname="联", given_name="次子")["id"], "parent")["suggestions"][0]["checked"]

    # 新增配偶：只登记了一位父/母的子女，建议另一方也为其父/母（可能是继子女，默认不勾选）
    single = _person(admin, surname="联", given_name="单亲父")["id"]
    kid = _person(admin, surname="联", given_name="单亲子")["id"]
    rel(single, kid, "parent")
    wife = _person(admin, surname="联", given_name="后妻", gender="female")["id"]
    s = rel(single, wife, "spouse")["suggestions"]
    assert [(x["person_a_id"], x["person_b_id"], x["checked"]) for x in s] == [(wife, kid, False)]

    # 新增兄弟姐妹：一方有父母、一方没有 → 建议把父母补到另一方
    orphan = _person(admin, surname="联", given_name="失联弟")["id"]
    s = rel(big, orphan, "sibling")["suggestions"]
    assert {(x["person_a_id"], x["person_b_id"]) for x in s} == {(dad, orphan), (mom, orphan)}
    assert all(x["checked"] for x in s)
    # 社会关系不给建议
    assert rel(big, orphan, "friend")["suggestions"] == []


def test_half_sibling_labels(admin):
    t = _types(admin)
    f = _person(admin, surname="半", given_name="父")["id"]
    m1 = _person(admin, surname="半", given_name="前妻", gender="female")["id"]
    m2 = _person(admin, surname="半", given_name="后妻", gender="female")["id"]
    a = _person(admin, surname="半", given_name="大", birth_date="1990")["id"]
    b = _person(admin, surname="半", given_name="小", gender="female", birth_date="2000")["id"]
    for p, c in ((f, a), (m1, a), (f, b), (m2, b)):
        admin.post("/api/relationships", json={"person_a_id": p, "person_b_id": c, "type_id": t["parent"], "confirm": True})
    rels = {x["other"]["id"]: x["role_of_other"] for x in admin.get(f"/api/persons/{a}/relationships").json()}
    assert rels[b] == "同父异母的妹妹"


# —— CSV 导入 ——
def _upload(admin, url, text):
    return admin.post(url, files={"file": ("x.csv", text.encode("utf-8"), "text/csv")}).json()


def test_csv_person_import_full(admin):
    from app.csv_import import parse_date
    assert parse_date("1960/5/1", "d") == ("1960-05-01", {})
    assert parse_date("1960年5月1日", "d") == ("1960-05-01", {})
    assert parse_date("1960.5", "d") == ("1960-05", {})
    assert parse_date("1798年闰二月初二寅时", "d") == ("1798-02-02", {"lunar": True, "leap": True, "hour": "寅"})
    assert parse_date("1907年腊月廿一", "d") == ("1907-12-21", {"lunar": True, "leap": False})

    tpl = admin.get("/api/admin/import/persons-template")
    assert tpl.status_code == 200 and "出生时辰" in tpl.content.decode("utf-8-sig")
    # 模板本身可以直接导入
    r = admin.post("/api/admin/import/persons-csv", files={"file": ("t.csv", tpl.content, "text/csv")})
    assert r.json()["created"] == 4 and r.json()["errors"] == [], r.json()
    wang = admin.get("/api/persons?q=秀英").json()["items"][0]
    w = admin.get(f"/api/persons/{wang['id']}").json()
    assert (w["birth_date"], w["birth_lunar"], w["birth_hour"], w["is_living"]) == ("1907-06-21", True, "子", False)

    csv_text = ("姓,名,性别,出生日期,农历,闰月,出生时辰,在世,去世日期,去世农历,字号,排行,简介\n"
                "导,甲,男,1950/3/4,否,,卯时,否,2001年腊月初八,,子美,2,一位老人\n"
                "导,乙,女,1952年5月6日,,,,,,,,,\n")
    r = _upload(admin, "/api/admin/import/persons-csv", csv_text)
    assert r["created"] == 2 and r["errors"] == []
    a = admin.get(f"/api/persons/{admin.get('/api/persons?q=导甲').json()['items'][0]['id']}").json()
    assert (a["birth_date"], a["birth_hour"], a["death_date"], a["death_lunar"], a["courtesy_name"], a["birth_order"],
            a["is_living"]) == ("1950-03-04", "卯", "2001-12-08", True, "子美", 2, False)

    # 任一行有错：全部不导入，错误带行号和中文列名
    bad = ("姓,名,性别,出生日期,农历,出生时辰,手机\n"
           "错,一,男,2003-08-32,,,\n"
           "错,二,男人,1990,,,\n"
           "错,三,女,1990,也许,,\n"
           "错,四,女,1990,,午后,\n"
           "错,五,女,1990,,,1234567890123456789012345678901234567890\n"
           "对,六,女,1990,,,\n")
    r = _upload(admin, "/api/admin/import/persons-csv", bad)
    assert r["created"] == 0 and len(r["errors"]) == 5
    assert r["errors"][0].startswith("第 2 行") and "不存在" in r["errors"][0]
    assert "性别" in r["errors"][1] and "农历" in r["errors"][2] and "时辰" in r["errors"][3] and "手机" in r["errors"][4]
    assert admin.get("/api/persons?q=对六").json()["total"] == 0
    # 同名提示（仍可导入）
    r = _upload(admin, "/api/admin/import/persons-csv", "姓,名,性别\n导,甲,男\n")
    assert r["created"] == 1 and any("同名" in w for w in r["warnings"])


def test_csv_relationship_import(admin):
    people = ("姓,名,性别,出生日期\n关,爷,男,1930\n关,奶,女,1932\n关,爸,男,1958\n关,妈,女,1960\n"
              "关,我,男,1985\n关,妹,女,1990\n关,前妻,女,1986\n关,妻,女,1988\n关,同名,男,2001\n关,同名,男,2005\n")
    assert _upload(admin, "/api/admin/import/persons-csv", people)["created"] == 10
    tpl = admin.get("/api/admin/import/relationships-template").content.decode("utf-8-sig")
    assert tpl.startswith("人物A,关系,人物B")

    rels = ("人物A,关系,人物B,开始时间,结束时间,状态,备注\n"
            "# 说明行会被忽略\n"
            "关爷,丈夫,关奶,1953/10,,,\n"
            "关爷,父亲,关爸,,,,\n"
            "关奶,母亲,关爸,,,,\n"
            "关爸,配偶,关妈,1980,,,\n"
            "关我,儿子,关爸,,,,\n"       # A 是 B 的儿子 → 关爸 是 关我 的父亲
            "关妈,母亲,关我,,,,\n"
            "关爸,父亲,关妹,,,,\n"
            "关妈,母亲,关妹,,,,\n"
            "关我,配偶,关前妻,2008,2012,离异,\n"
            "关我,丈夫,关妻,2015,,,\n"
            "关同名#2001,父亲,关我,,,,\n")  # 故意的错误：后面替换
    rels = rels.replace("关同名#2001,父亲,关我", "关同名#2005,朋友,关同名#2001")
    r = _upload(admin, "/api/admin/import/relationships-csv", rels)
    assert r["errors"] == [] and r["created"] == 11, r
    me = admin.get("/api/persons?q=关我").json()["items"][0]["id"]
    got = {x["other"]["name"]: x["role_of_other"] for x in admin.get(f"/api/persons/{me}/relationships").json()}
    assert got["关爸"] == "父亲" and got["关妈"] == "母亲" and got["关妹"] == "妹妹"
    assert got["关前妻"] == "前配偶" and got["关妻"] == "配偶"
    # 重复导入：全部跳过，不产生重复
    r = _upload(admin, "/api/admin/import/relationships-csv", rels)
    assert r["created"] == 0 and r["skipped"] == 11 and r["errors"] == []

    # 错误：同名未区分、找不到人、无法识别的关系、违反一夫一妻 —— 全部不导入
    bad = ("人物A,关系,人物B\n"
           "关同名,朋友,关爷\n"
           "关不存在,父亲,关我\n"
           "关爷,表舅,关我\n"
           "关我,配偶,关妹\n"
           "关爷,邻居,关我\n")
    r = _upload(admin, "/api/admin/import/relationships-csv", bad)
    assert r["created"] == 0 and len(r["errors"]) == 4, r
    assert "2001、2005" in r["errors"][0] and "关同名#出生年" in r["errors"][0]
    assert "找不到" in r["errors"][1] and "无法识别关系" in r["errors"][2] and "已有配偶" in r["errors"][3]
    assert not any(x["other"]["name"] == "关爷" and x["type_name"] == "邻居"
                   for x in admin.get(f"/api/persons/{me}/relationships").json())
    # 性别与称呼不符时提示
    r = _upload(admin, "/api/admin/import/relationships-csv", "人物A,关系,人物B\n关妹,哥哥,关同名#2005\n")
    assert r["created"] == 1 and any("性别" in w for w in r["warnings"])


# —— 新增人物时直接选择父母 ——
def test_create_person_with_parents(admin):
    t = _types(admin)
    dad = _person(admin, surname="选", given_name="父", birth_date="1960")["id"]
    mom = _person(admin, surname="选", given_name="母", gender="female", birth_date="1962")["id"]
    big = _person(admin, surname="选", given_name="姐", gender="female", birth_date="1985")["id"]
    for p in (dad, mom):
        admin.post("/api/relationships", json={"person_a_id": p, "person_b_id": big, "type_id": t["parent"]})

    r = admin.post("/api/persons", json={"surname": "选", "given_name": "子", "gender": "male", "birth_date": "1990",
                                         "father_id": dad, "mother_id": mom})
    assert r.status_code == 201, r.text
    kid = r.json()["id"]
    rels = {x["other"]["id"]: x["role_of_other"] for x in admin.get(f"/api/persons/{kid}/relationships").json()}
    assert rels[dad] == "父亲" and rels[mom] == "母亲" and rels[big] == "姐姐"  # 姐姐由共同父母推导

    # 只选父亲也可以
    r = admin.post("/api/persons", json={"surname": "选", "given_name": "单", "father_id": dad})
    assert r.status_code == 201
    assert [x["role_of_other"] for x in admin.get(f"/api/persons/{r.json()['id']}/relationships").json()
            if x["status"] != "derived"] == ["父亲"]

    def count(name):
        return admin.get(f"/api/persons?q={name}").json()["total"]

    # 性别不符、同一人、不存在：报错且不留下人物
    for body, msg in (({"father_id": mom}, "性别"), ({"father_id": dad, "mother_id": dad}, "同一人"),
                      ({"mother_id": 999999}, "不存在")):
        r = admin.post("/api/persons", json={"surname": "选", "given_name": "错", **body})
        assert r.status_code == 422 and msg in r.json()["detail"], r.text
    assert count("选错") == 0
    # 年龄矛盾：需确认，未确认时不保存
    r = admin.post("/api/persons", json={"surname": "选", "given_name": "老", "birth_date": "1950", "father_id": dad})
    assert r.status_code == 409 and r.json()["detail"]["warnings"] and count("选老") == 0
    r = admin.post("/api/persons", json={"surname": "选", "given_name": "老", "birth_date": "1950", "father_id": dad,
                                         "confirm": True})
    assert r.status_code == 201 and count("选老") == 1
    # 修改资料时 father_id 等字段会被忽略（父母关系请在“关系”中维护）
    r = admin.put(f"/api/persons/{kid}", json={"surname": "选", "given_name": "子", "gender": "male", "father_id": mom})
    assert r.status_code == 200


# —— 封赠 / 功名 ——
def test_person_honorific(admin):
    p = _person(admin, surname="封", given_name="赠", honorific="例赠登仕郎")
    assert p["honorific"] == "例赠登仕郎"
    r = admin.put(f"/api/persons/{p['id']}", json={"surname": "封", "given_name": "赠", "honorific": "敕授文林郎"})
    assert r.json()["honorific"] == "敕授文林郎"
    assert admin.post("/api/persons", json={"given_name": "长", "honorific": "长" * 129}).status_code == 422
    # CSV：“封赠功名”列及同义表头
    text = "姓,名,性别,功名\n封,甲,男,太学生\n"
    r = admin.post("/api/admin/import/persons-csv", files={"file": ("x.csv", text.encode("utf-8"), "text/csv")}).json()
    assert r["created"] == 1
    pid = admin.get("/api/persons?q=封甲").json()["items"][0]["id"]
    assert admin.get(f"/api/persons/{pid}").json()["honorific"] == "太学生"
