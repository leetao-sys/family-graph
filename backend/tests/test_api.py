"""接口与权限测试：覆盖验收标准中的登录、越权、关系视图、族谱视图等要求。"""
import io

import pytest
from PIL import Image

from .conftest import make_client, login


def _types(c):
    return {t["code"]: t["id"] for t in c.get("/api/relation-types").json()}


def _person(c, surname, given, gender, birth=None):
    r = c.post("/api/persons", json={"surname": surname, "given_name": given, "gender": gender, "birth_date": birth})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _rel(c, a, b, type_id, **kw):
    r = c.post("/api/relationships", json={"person_a_id": a, "person_b_id": b, "type_id": type_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def family(admin):
    t = _types(admin)
    p = {
        "gf": _person(admin, "周", "老太爷", "male", "1940"),
        "dad": _person(admin, "周", "大伟", "male", "1965"),
        "mom": _person(admin, "钱", "淑贞", "female", "1967"),
        "aunt": _person(admin, "钱", "淑芳", "female", "1963"),
        "me": _person(admin, "周", "小舟", "male", "1990"),
        "cousin": _person(admin, "孙", "小明", "male", "1988"),
        "friend": _person(admin, "吴", "朋友", "female", "1991"),
        "x": _person(admin, "郑", "路人", "male", "1990"),
    }
    _rel(admin, p["gf"], p["dad"], t["parent"])
    _rel(admin, p["dad"], p["me"], t["parent"])
    _rel(admin, p["mom"], p["me"], t["parent"])
    _rel(admin, p["dad"], p["mom"], t["spouse"])
    # 姨妈与妈妈是兄弟姐妹（未录入共同父母）
    _rel(admin, p["aunt"], p["mom"], t["sibling"])
    _rel(admin, p["aunt"], p["cousin"], t["parent"])
    r = admin.post("/api/admin/users", json={"username": "zhouxz", "person_id": p["me"]})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    member = make_client()
    login(member, "zhouxz", r.json()["initial_password"])
    r2 = member.post("/api/auth/change-password",
                     json={"old_password": r.json()["initial_password"], "new_password": "Member123"})
    assert r2.status_code == 200
    # 社会关系功能需管理员开通；开通后成员登记的社会关系只有自己（和管理员）能看到
    assert admin.put(f"/api/admin/users/{uid}", json={"can_use_social": True}).status_code == 200
    _rel(member, p["me"], p["cousin"], t["friend"])
    _rel(member, p["me"], p["friend"], t["classmate"])
    return {"p": p, "t": t, "member": member, "member_uid": uid}


def test_unauthenticated_rejected():
    c = make_client()
    for url in ("/api/persons", "/api/graph/network?center=1", "/api/relation-types", "/api/kinship?a=1&b=2"):
        assert c.get(url).status_code == 401


def test_csrf_header_required(admin):
    c = make_client()
    c.headers.pop("X-Requested-With")
    assert c.post("/api/auth/login", json={"username": "admin", "password": "x"}).status_code == 403


def test_wrong_password_and_lockout():
    c = make_client()
    for _ in range(5):
        assert c.post("/api/auth/login", json={"username": "nobody", "password": "x"}).status_code == 401


def test_must_change_password(admin):
    r = admin.post("/api/admin/users", json={"username": "fresh"})
    c = make_client()
    login(c, "fresh", r.json()["initial_password"])
    assert c.get("/api/persons").status_code == 403
    assert c.get("/api/auth/me").status_code == 200


def test_network_multi_relationship(family):
    p, member = family["p"], family["member"]
    r = member.get(f"/api/graph/network?center={p['me']}&depth=1")
    assert r.status_code == 200
    data = r.json()
    ids = {n["id"] for n in data["nodes"]}
    assert {p["dad"], p["mom"], p["cousin"], p["friend"]} <= ids
    assert p["x"] not in ids
    # 与表哥既有推导的表亲关系，又有“朋友”这条独立边
    cousin = next(n for n in data["nodes"] if n["id"] == p["cousin"])
    assert cousin["kin_term"] == "表哥"
    labels = {e["label"] for e in data["edges"] if {e["source"], e["target"]} == {p["me"], p["cousin"]}}
    assert labels == {"朋友"}
    # 一度节点之间的边（父母配偶）也要返回
    assert any({e["source"], e["target"]} == {p["dad"], p["mom"]} for e in data["edges"])


def test_network_depth_and_filter(family):
    p, t, member = family["p"], family["t"], family["member"]
    d2 = member.get(f"/api/graph/network?center={p['me']}&depth=2").json()
    assert p["gf"] in {n["id"] for n in d2["nodes"]}
    only_social = member.get(f"/api/graph/network?center={p['me']}&types={t['friend']},{t['classmate']}").json()
    assert {n["id"] for n in only_social["nodes"]} == {p["me"], p["cousin"], p["friend"]}


def test_tree(family):
    p, member = family["p"], family["member"]
    r = member.get(f"/api/graph/tree?root={p['me']}&mode=hourglass&gen=2").json()
    assert {p["gf"], p["dad"], p["mom"], p["me"]} <= {int(k) for k in r["persons"]}
    assert {"child": p["me"], "parent": p["dad"], "kind": "parent"} in r["parents"]
    assert r["persons"][str(p["me"])]["generation"] == r["persons"][str(p["dad"])]["generation"] + 1


def test_kinship_api(family):
    p, member = family["p"], family["member"]
    r = member.get(f"/api/kinship?a={p['me']}&b={p['gf']}").json()
    assert r["a_to_b"]["term"] == "爷爷"
    assert r["b_to_a"]["term"] == "孙子"
    r = member.get(f"/api/kinship?a={p['me']}&b={p['x']}").json()
    assert r["a_to_b"]["found"] is False


def test_path(family):
    p, member = family["p"], family["member"]
    r = member.get(f"/api/graph/path?from={p['friend']}&to={p['gf']}").json()
    assert r["found"] and [n["id"] for n in r["nodes"]] == [p["friend"], p["me"], p["dad"], p["gf"]]


def test_member_permissions(family):
    p, t, member = family["p"], family["t"], family["member"]
    # 不能新增族谱关系
    r = member.post("/api/relationships", json={"person_a_id": p["x"], "person_b_id": p["me"], "type_id": t["parent"]})
    assert r.status_code == 403
    # 不能维护与自己无关的社会关系
    r = member.post("/api/relationships", json={"person_a_id": p["x"], "person_b_id": p["dad"], "type_id": t["friend"]})
    assert r.status_code == 403
    # 可以新增、删除与自己相关的社会关系
    r = member.post("/api/relationships", json={"person_a_id": p["me"], "person_b_id": p["x"], "type_id": t["neighbor"]})
    assert r.status_code == 201
    assert member.delete(f"/api/relationships/{r.json()['id']}").status_code == 200
    # 不能修改他人资料、不能新增人物、不能进管理后台
    assert member.put(f"/api/persons/{p['dad']}", json={"surname": "改", "given_name": "名"}).status_code == 403
    assert member.post("/api/persons", json={"surname": "新", "given_name": "人"}).status_code == 403
    assert member.get("/api/admin/users").status_code == 403
    # 可以修改自己的资料
    r = member.put(f"/api/persons/{p['me']}", json={"surname": "周", "given_name": "小舟", "gender": "male",
                                                    "birth_date": "1990", "occupation": "教师"})
    assert r.status_code == 200 and r.json()["occupation"] == "教师"


def test_admin_change_visible_to_member(admin, family):
    p, t, member = family["p"], family["t"], family["member"]
    new = _person(admin, "周", "小妹", "female", "1995")
    _rel(admin, p["dad"], new, t["parent"])
    _rel(admin, p["mom"], new, t["parent"])
    nodes = member.get(f"/api/graph/network?center={p['me']}").json()["nodes"]
    sis = next(n for n in nodes if n["id"] == new)
    assert sis["kin_term"] == "妹妹"


def test_relationship_validation(admin, family):
    p, t = family["p"], family["t"]
    r = admin.post("/api/relationships", json={"person_a_id": p["me"], "person_b_id": p["me"], "type_id": t["friend"]})
    assert r.status_code == 422
    # 成环：孙子不能成为爷爷的父亲
    r = admin.post("/api/relationships", json={"person_a_id": p["me"], "person_b_id": p["gf"], "type_id": t["parent"]})
    assert r.status_code == 422
    # 重复关系需确认
    body = {"person_a_id": p["cousin"], "person_b_id": p["me"], "type_id": t["friend"]}
    r = admin.post("/api/relationships", json=body)
    assert r.status_code == 409 and r.json()["detail"]["warnings"]
    # 年龄矛盾告警
    young = _person(admin, "周", "幼儿", "male", "2020")
    r = admin.post("/api/relationships", json={"person_a_id": young, "person_b_id": p["x"], "type_id": t["parent"]})
    assert r.status_code == 409
    r = admin.post("/api/relationships", json={"person_a_id": young, "person_b_id": p["x"], "type_id": t["parent"],
                                               "confirm": True})
    assert r.status_code == 201


def test_privacy(admin, family):
    p, member = family["p"], family["member"]
    admin.put(f"/api/persons/{p['x']}", json={"surname": "郑", "given_name": "路人", "gender": "male",
                                              "phone": "13900000000", "privacy": {"phone": "self"}})
    assert member.get(f"/api/persons/{p['x']}").json()["phone"] is None
    assert admin.get(f"/api/persons/{p['x']}").json()["phone"] == "13900000000"


def test_avatar_upload(family):
    p, member = family["p"], family["member"]
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), "red").save(buf, "PNG")
    r = member.post(f"/api/persons/{p['me']}/avatar", files={"file": ("a.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    url = r.json()["avatar"]
    assert url and member.get(url).status_code == 200
    assert make_client().get(url).status_code == 401
    bad = member.post(f"/api/persons/{p['me']}/avatar", files={"file": ("a.png", b"not an image", "image/png")})
    assert bad.status_code == 415


def test_export_import_and_audit(admin):
    exported = admin.get("/api/admin/export")
    assert exported.status_code == 200
    before = admin.get("/api/admin/summary").json()["persons"]
    r = admin.post("/api/admin/import", files={"file": ("d.json", exported.content, "application/json")})
    assert r.status_code == 200
    assert admin.get("/api/admin/summary").json()["persons"] == before * 2
    logs = admin.get("/api/admin/audit-logs?object_type=relationship").json()
    assert logs["total"] > 0


def test_csv_import(admin):
    csv_text = "姓,名,性别,出生日期\n欧阳,修,男,1007\n,,女,\n"
    r = admin.post("/api/admin/import/persons-csv", files={"file": ("p.csv", csv_text.encode("utf-8"), "text/csv")})
    # 有一行出错时整个文件不导入，返回带行号的错误
    assert r.json()["created"] == 0 and r.json()["errors"] == ["第 3 行：缺少姓名"]
    r = admin.post("/api/admin/import/persons-csv",
                   files={"file": ("p.csv", "姓,名,性别,出生日期\n欧阳,修,男,1007\n".encode("utf-8"), "text/csv")})
    assert r.json()["created"] == 1 and r.json()["errors"] == []


def test_map_and_places(admin, family):
    p, member = family["p"], family["member"]
    admin.put(f"/api/persons/{p['dad']}", json={"surname": "周", "given_name": "大伟", "gender": "male",
                                                "birth_date": "1965", "birth_place": "湖南省长沙市",
                                                "residence": "广东省广州市", "privacy": {"residence": "self"}})
    admin.put(f"/api/persons/{p['gf']}", json={"surname": "周", "given_name": "老太爷", "gender": "male",
                                               "birth_date": "1940", "native_place": "江西省赣州市"})
    data = member.get("/api/map/persons").json()
    by_id = {i["person"]["id"]: i for i in data["items"]}
    # 现居地对成员不可见时退回出生地；只有籍贯时用籍贯
    assert by_id[p["dad"]]["address"] == "湖南省长沙市" and by_id[p["dad"]]["source"] == "birth_place"
    assert by_id[p["gf"]]["source"] == "native_place"
    assert admin.get("/api/map/persons").json()["items"] and any(
        i["address"] == "广东省广州市" for i in admin.get("/api/map/persons").json()["items"])
    r = member.put("/api/places", json={"address": "湖南省长沙市", "lat": 28.2, "lng": 112.9})
    assert r.status_code == 200
    # 成员不能覆盖已有坐标
    member.put("/api/places", json={"address": "湖南省长沙市", "lat": 1, "lng": 1})
    assert member.get("/api/map/persons").json()["places"]["湖南省长沙市"]["lat"] == 28.2
    assert member.put("/api/places", json={"address": "x", "lat": 100, "lng": 1}).status_code == 422


def test_timeline(admin, family):
    p, t, member = family["p"], family["t"], family["member"]
    rel = admin.get(f"/api/persons/{p['dad']}/relationships").json()
    spouse = next(r for r in rel if r["type_id"] == t["spouse"])
    admin.put(f"/api/relationships/{spouse['id']}", json={
        "person_a_id": spouse["person_a_id"], "person_b_id": spouse["person_b_id"], "type_id": t["spouse"],
        "start_date": "1988-05-01", "confirm": True})
    events = member.get("/api/timeline").json()["events"]
    kinds = {e["type"] for e in events}
    assert {"birth", "marriage"} <= kinds
    assert any(e["type"] == "marriage" and e["date"] == "1988-05-01" for e in events)
    assert [e["date"] for e in events] == sorted(e["date"] for e in events)
    only = member.get(f"/api/timeline?types=marriage&person_id={p['me']}").json()["events"]
    assert only and all(e["type"] == "marriage" for e in only)
