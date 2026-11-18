import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Download, KeyRound, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { del, get, post, put, qs, upload } from "../api";
import { useAuth } from "../auth";
import PersonForm from "../components/PersonForm";
import RelationshipForm, { type RelationshipValue } from "../components/RelationshipForm";
import type { Person, PersonBrief, RelationType, User } from "../types";
import { GENDER_LABEL } from "../types";
import { Empty, ListSkeleton, Modal, PageHeading, Pagination, PersonLine, PersonPicker, useConfirm, useDebounced, useToast } from "../ui";

const SECTIONS = [
  ["", "概览"],
  ["persons", "人物"],
  ["relationships", "关系"],
  ["types", "关系类型"],
  ["users", "账号"],
  ["rules", "称谓规则"],
  ["audit", "审计日志"],
  ["data", "备份与导入"],
  ["settings", "系统设置"],
] as const;

export default function Admin() {
  const params = useParams();
  const nav = useNavigate();
  const section = params["*"] || "";
  return (
    <div className="page">
      <PageHeading mark="谱" title="谱务管理" sub="人物 · 关系 · 账号 · 谱册数据" />
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {SECTIONS.map(([k, label]) => (
          <button key={k} className="tab" role="tab" aria-selected={section === k} onClick={() => nav(`/admin/${k}`)}>
            {label}
          </button>
        ))}
      </div>
      {section === "" && <Overview />}
      {section === "persons" && <AdminPersons />}
      {section === "relationships" && <AdminRelationships />}
      {section === "types" && <AdminTypes />}
      {section === "users" && <AdminUsers />}
      {section === "rules" && <AdminRules />}
      {section === "audit" && <AdminAudit />}
      {section === "data" && <AdminData />}
      {section === "settings" && <AdminSettings />}
    </div>
  );
}

function Overview() {
  const [s, setS] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    get("/api/admin/summary").then(setS);
  }, []);
  if (!s) return <ListSkeleton />;
  const items: [string, string, string][] = [
    ["persons", "人物", "/admin/persons"],
    ["relationships", "关系", "/admin/relationships"],
    ["users", "账号", "/admin/users"],
    ["relation_types", "关系类型", "/admin/types"],
  ];
  return (
    <div className="stack">
      <div className="stat-grid">
        {items.map(([k, label, to]) => (
          <Link key={k} to={to} className="card stat" style={{ color: "inherit" }}>
            <div className="muted small">{label}</div>
            <div className="num">{s[k]}</div>
          </Link>
        ))}
      </div>
      <div className="card card-body small muted">
        数据备份：可在「备份与导入」中导出/恢复完整 JSON 备份（人物、关系、文章等）；Docker 部署时 backup 服务仍每日备份数据库与头像文件。
      </div>
    </div>
  );
}

/* ---------------- 人物 ---------------- */
function AdminPersons() {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: (PersonBrief & { branch: string | null })[] } | null>(null);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const load = useCallback(() => {
    get(`/api/persons?${qs({ q: dq, page, size: 20 })}`).then(setData);
  }, [dq, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [dq]);

  const remove = async (p: PersonBrief) => {
    const ok = await confirm({
      title: "删除人物",
      message: `确定删除 ${p.name} 吗？其全部关系将一并删除，操作会记录在审计日志中。`,
      danger: true,
      okText: "删除",
    });
    if (!ok) return;
    try {
      await del(`/api/persons/${p.id}`);
      toast("success", "已删除");
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 280 }} placeholder="搜索姓名" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索人物" />
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> 新增人物
          </button>
        </div>
        {!data ? (
          <ListSkeleton />
        ) : data.items.length === 0 ? (
          <Empty title="没有找到人物" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>性别</th>
                  <th>出生</th>
                  <th className="hide-mobile">世代</th>
                  <th className="hide-mobile">分支</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/persons/${p.id}`} style={{ color: "inherit" }}>
                        <PersonLine p={{ ...p, birth_year: null }} />
                      </Link>
                    </td>
                    <td>{GENDER_LABEL[p.gender]}</td>
                    <td>{p.birth_year || "—"}</td>
                    <td className="hide-mobile">{p.generation !== null ? `第 ${p.generation + 1} 世` : "—"}</td>
                    <td className="hide-mobile">{p.branch || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="icon-btn" aria-label="编辑" title="编辑" onClick={async () => setEditing(await get<Person>(`/api/persons/${p.id}`))}>
                          <Pencil size={16} />
                        </button>
                        <button className="icon-btn" aria-label="删除" title="删除" onClick={() => remove(p)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} size={20} total={data.total} onPage={setPage} />}
      </div>
      {editing && (
        <Modal title={editing === "new" ? "新增人物" : `编辑：${editing.name}`} onClose={() => setEditing(null)}>
          <PersonForm
            person={editing === "new" ? null : editing}
            showNotes
            onCancel={() => setEditing(null)}
            onChange={load}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 关系 ---------------- */
interface RelRow {
  id: number;
  person_a: PersonBrief;
  person_b: PersonBrief;
  type_id: number;
  type_name: string;
  category: "kin" | "social";
  label: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  note: string | null;
  is_public: boolean;
}

function AdminRelationships() {
  const { types } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [category, setCategory] = useState("");
  const [typeId, setTypeId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: RelRow[] } | null>(null);
  const [editing, setEditing] = useState<Partial<RelationshipValue> | null>(null);
  const load = useCallback(() => {
    get(`/api/relationships?${qs({ q: dq, category, type_id: typeId, page, size: 20 })}`).then(setData);
  }, [dq, category, typeId, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [dq, category, typeId]);

  const remove = async (r: RelRow) => {
    const ok = await confirm({
      title: "删除关系",
      message: `确定删除 ${r.person_a.name} 与 ${r.person_b.name} 的“${r.type_name}”关系吗？`,
      danger: true,
      okText: "删除",
    });
    if (!ok) return;
    await del(`/api/relationships/${r.id}`);
    toast("success", "已删除");
    load();
  };

  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 220 }} placeholder="按人物姓名搜索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="按人物搜索关系" />
          <select className="select" style={{ maxWidth: 140 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="类别">
            <option value="">全部类别</option>
            <option value="kin">族谱关系</option>
            <option value="social">社会关系</option>
          </select>
          <select className="select" style={{ maxWidth: 140 }} value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="类型">
            <option value="">全部类型</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> 新增关系
          </button>
        </div>
        {!data ? (
          <ListSkeleton />
        ) : data.items.length === 0 ? (
          <Empty title="没有找到关系" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>人物 A</th>
                  <th>关系</th>
                  <th>人物 B</th>
                  <th className="hide-mobile">时间</th>
                  <th className="hide-mobile">状态</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td><PersonLine p={{ ...r.person_a, birth_year: null }} /></td>
                    <td><span className={`badge ${r.category}`}>{r.label}</span>{r.category === "social" && <span className="badge" title="社会关系只有登记人本人和管理员能看到" style={{ marginLeft: 4 }}>仅登记人可见</span>}</td>
                    <td><PersonLine p={{ ...r.person_b, birth_year: null }} /></td>
                    <td className="hide-mobile small">{[r.start_date, r.end_date].filter(Boolean).join(" ~ ") || "—"}</td>
                    <td className="hide-mobile">
                      {r.status === "active" ? <span className="badge">有效</span> : r.status === "historical" ? <span className="badge">历史</span> : <span className="badge warning">待确认</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button
                          className="icon-btn"
                          aria-label="编辑"
                          onClick={() =>
                            setEditing({ id: r.id, person_a: r.person_a, person_b: r.person_b, type_id: r.type_id, start_date: r.start_date, end_date: r.end_date, status: r.status, note: r.note })
                          }
                        >
                          <Pencil size={16} />
                        </button>
                        <button className="icon-btn" aria-label="删除" onClick={() => remove(r)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} size={20} total={data.total} onPage={setPage} />}
      </div>
      {editing && (
        <Modal title={editing.id ? "编辑关系" : "新增关系"} onClose={() => setEditing(null)}>
          <RelationshipForm
            value={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 关系类型 ---------------- */
const ROLE_LABEL: Record<string, string> = { parent: "亲子", adoptive: "收养", step: "继亲", spouse: "配偶", sibling: "兄弟姐妹" };

function AdminTypes() {
  const { types, reloadTypes } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<RelationType> | null>(null);
  const save = async () => {
    if (!editing) return;
    const body = {
      code: editing.code,
      name: editing.name,
      category: editing.category || "social",
      symmetric: editing.symmetric ?? true,
      forward_name: editing.forward_name || editing.name,
      reverse_name: editing.reverse_name || editing.name,
      kinship_role: editing.category === "kin" ? editing.kinship_role || null : null,
      sort: Number(editing.sort ?? 100),
      color: editing.color || "#64748b",
    };
    try {
      if (editing.id) await put(`/api/relation-types/${editing.id}`, body);
      else await post("/api/relation-types", body);
      toast("success", "已保存");
      setEditing(null);
      reloadTypes();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const remove = async (t: RelationType) => {
    if (!(await confirm({ title: "删除关系类型", message: `确定删除“${t.name}”吗？`, danger: true, okText: "删除" }))) return;
    try {
      await del(`/api/relation-types/${t.id}`);
      reloadTypes();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const field = (k: keyof RelationType, label: string, placeholder?: string, disabled?: boolean) => (
    <div className="field">
      <label>{label}</label>
      <input className="input" placeholder={placeholder} disabled={disabled} value={String(editing?.[k] ?? "")} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
    </div>
  );
  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row">
          <span className="muted small">内置类型的结构不可修改（可改名称、颜色、排序）；自定义类型可删除（未被使用时）。</span>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEditing({ category: "social", symmetric: true, color: "#0d9488", sort: 50 })}>
            <Plus size={16} /> 新增类型
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>名称</th><th>类别</th><th>方向</th><th className="hide-mobile">参与称谓计算</th><th className="hide-mobile">排序</th><th style={{ width: 100 }} /></tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="row"><span className="dot" style={{ background: t.color }} /> {t.name}{t.builtin && <span className="badge">内置</span>}</span>
                  </td>
                  <td><span className={`badge ${t.category}`}>{t.category === "kin" ? "族谱" : "社会"}</span></td>
                  <td className="small">{t.symmetric ? "对称" : `A 是 B 的${t.forward_name} / B 是 A 的${t.reverse_name}`}</td>
                  <td className="hide-mobile">{t.kinship_role ? ROLE_LABEL[t.kinship_role] : "—"}</td>
                  <td className="hide-mobile">{t.sort}</td>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      <button className="icon-btn" aria-label="编辑" onClick={() => setEditing(t)}><Pencil size={16} /></button>
                      {!t.builtin && <button className="icon-btn" aria-label="删除" onClick={() => remove(t)}><Trash2 size={16} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <Modal
          title={editing.id ? `编辑类型：${editing.name}` : "新增关系类型"}
          onClose={() => setEditing(null)}
          footer={<><button className="btn" onClick={() => setEditing(null)}>取消</button><button className="btn btn-primary" onClick={save}>保存</button></>}
        >
          <div className="form-grid">
            {field("name", "名称", "如：发小")}
            {field("code", "编码（英文）", "如：buddy", !!editing.id)}
            <div className="field">
              <label>类别</label>
              <select className="select" disabled={editing.builtin} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as "kin" | "social" })}>
                <option value="social">社会关系</option>
                <option value="kin">族谱关系</option>
              </select>
            </div>
            {editing.category === "kin" && (
              <div className="field">
                <label>称谓计算角色</label>
                <select className="select" disabled={editing.builtin} value={editing.kinship_role || ""} onChange={(e) => setEditing({ ...editing, kinship_role: e.target.value || null })}>
                  <option value="">不参与</option>
                  {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            <label className="checkbox" style={{ alignSelf: "end", height: 38 }}>
              <input type="checkbox" disabled={editing.builtin} checked={editing.symmetric ?? true} onChange={(e) => setEditing({ ...editing, symmetric: e.target.checked })} /> 对称关系
            </label>
            {!editing.symmetric && field("forward_name", "A 是 B 的…", "如：老师")}
            {!editing.symmetric && field("reverse_name", "B 是 A 的…", "如：学生")}
            <div className="field">
              <label>颜色</label>
              <input className="input" type="color" value={editing.color || "#64748b"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} style={{ padding: 4 }} />
            </div>
            {field("sort", "排序", "数字越小越靠前")}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 账号 ---------------- */
interface AdminUser extends User {
  is_active: boolean;
  social_enabled: boolean;
  last_login_at: string | null;
  locked: boolean;
}

function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [creating, setCreating] = useState<{ username: string; role: string; person: PersonBrief | null } | null>(null);
  const [binding, setBinding] = useState<AdminUser | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const load = useCallback(() => {
    get<AdminUser[]>("/api/admin/users").then(setUsers);
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!creating?.username.trim()) return toast("error", "请填写用户名");
    try {
      const r = await post<{ initial_password: string; username: string }>("/api/admin/users", {
        username: creating.username.trim(),
        role: creating.role,
        person_id: creating.person?.id ?? null,
      });
      setCreating(null);
      setSecret({ username: r.username, password: r.initial_password });
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const update = async (u: AdminUser, body: Record<string, unknown>) => {
    try {
      await put(`/api/admin/users/${u.id}`, body);
      toast("success", "已更新");
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const reset = async (u: AdminUser) => {
    if (!(await confirm({ title: "重置密码", message: `将为 ${u.username} 生成新的初始密码，其现有登录会话立即失效。继续吗？`, okText: "重置" }))) return;
    const r = await post<{ initial_password: string }>(`/api/admin/users/${u.id}/reset-password`);
    setSecret({ username: u.username, password: r.initial_password });
    load();
  };
  const remove = async (u: AdminUser) => {
    if (!(await confirm({ title: "删除账号", message: `确定删除账号 ${u.username} 吗？绑定的人物资料不会被删除。`, danger: true, okText: "删除" }))) return;
    try {
      await del(`/api/admin/users/${u.id}`);
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setCreating({ username: "", role: "member", person: null })}>
            <Plus size={16} /> 新增账号
          </button>
        </div>
        {!users ? (
          <ListSkeleton />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>用户名</th><th>绑定人物</th><th>角色</th><th title="开通后该账号可登记社会关系，且只有他自己能看到">社会关系</th><th>状态</th><th className="hide-mobile">最近登录</th><th style={{ width: 150 }} /></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>
                      {u.person ? <PersonLine p={u.person} /> : <span className="muted">未绑定</span>}
                    </td>
                    <td>
                      <select className="select" style={{ height: 30, width: 96 }} value={u.role} disabled={u.id === me?.id} onChange={(e) => update(u, { role: e.target.value })} aria-label="角色">
                        <option value="member">成员</option>
                        <option value="admin">管理员</option>
                      </select>
                    </td>
                    <td>
                      {u.role === "admin" ? (
                        <span className="muted small" title="管理员始终可以使用社会关系功能">管理员默认可用</span>
                      ) : (
                        <label className="checkbox" title="开通后该账号可登记社会关系（同学、老师等），且只有他自己能看到">
                          <input
                            type="checkbox"
                            checked={u.social_enabled}
                            onChange={(e) => update(u, { can_use_social: e.target.checked })}
                            aria-label={`${u.username} 社会关系功能`}
                          />{" "}
                          {u.social_enabled ? "已开通" : "未开通"}
                        </label>
                      )}
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {u.is_active ? <span className="badge">启用</span> : <span className="badge danger">停用</span>}
                        {u.locked && <span className="badge warning">锁定中</span>}
                        {u.must_change_password && <span className="badge warning">待改密</span>}
                      </div>
                    </td>
                    <td className="hide-mobile small">{u.last_login_at ? new Date(u.last_login_at + "Z").toLocaleString() : "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="icon-btn" title="绑定人物" aria-label="绑定人物" onClick={() => setBinding(u)}><Pencil size={16} /></button>
                        <button className="icon-btn" title="重置密码" aria-label="重置密码" onClick={() => reset(u)}><KeyRound size={16} /></button>
                        {u.id !== me?.id && (
                          <button className="btn btn-sm btn-ghost" onClick={() => update(u, { is_active: !u.is_active })}>{u.is_active ? "停用" : "启用"}</button>
                        )}
                        {u.id !== me?.id && <button className="icon-btn" title="删除" aria-label="删除账号" onClick={() => remove(u)}><Trash2 size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="新增账号" onClose={() => setCreating(null)} footer={<><button className="btn" onClick={() => setCreating(null)}>取消</button><button className="btn btn-primary" onClick={create}>创建</button></>}>
          <div className="stack">
            <div className="field">
              <label>用户名</label>
              <input className="input" value={creating.username} onChange={(e) => setCreating({ ...creating, username: e.target.value })} placeholder="字母、数字、下划线，或手机号" autoFocus />
            </div>
            <div className="field">
              <label>角色</label>
              <select className="select" value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="member">普通成员</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="field">
              <label>绑定人物（一个账号对应一个人物）</label>
              <PersonPicker value={creating.person} onChange={(p) => setCreating({ ...creating, person: p })} />
            </div>
            <div className="muted small">系统将生成初始密码，用户首次登录时需修改。</div>
          </div>
        </Modal>
      )}
      {binding && <BindModal user={binding} onClose={() => setBinding(null)} onSave={(body) => { update(binding, body); setBinding(null); }} />}
      {secret && (
        <Modal title="初始密码" size="sm" onClose={() => setSecret(null)} footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>我已记下</button>}>
          <div className="stack">
            <div>账号 <strong>{secret.username}</strong> 的初始密码：</div>
            <code style={{ fontSize: 20, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, userSelect: "all" }}>{secret.password}</code>
            <div className="muted small">此密码只显示一次，请通过安全渠道告知本人。首次登录后需修改。</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BindModal({ user, onClose, onSave }: { user: AdminUser; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [p, setP] = useState<PersonBrief | null>(user.person);
  return (
    <Modal
      title={`绑定人物：${user.username}`}
      onClose={onClose}
      footer={
        <>
          {user.person && <button className="btn btn-danger" onClick={() => onSave({ unbind: true })}>解除绑定</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!p} onClick={() => onSave({ person_id: p?.id })}>保存</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 6 }}>
        <PersonPicker value={p} onChange={setP} autoFocus placeholder="输入姓名搜索人物" />
        <span className="muted small">一个账号只能绑定一位人物，已绑定其他账号的人物无法选择。</span>
      </div>
    </Modal>
  );
}

/* ---------------- 称谓规则 ---------------- */
const TOKEN_HELP = "f 父 · m 母 · h 夫 · w 妻 · s 子 · d 女 · ob 兄 · yb 弟 · os 姐 · ys 妹；&o/&y 表示同辈中年长/年幼";

function AdminRules() {
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [rows, setRows] = useState<{ id: number; chain: string; term: string }[] | null>(null);
  const [edit, setEdit] = useState<{ chain: string; term: string } | null>(null);
  const load = useCallback(() => {
    get(`/api/admin/kinship-rules?${qs({ q: dq })}`).then(setRows);
  }, [dq]);
  useEffect(load, [load]);
  const save = async () => {
    if (!edit) return;
    try {
      await put("/api/admin/kinship-rules", edit);
      toast("success", "规则已保存");
      setEdit(null);
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <div className="card">
      <div className="card-body stack">
        <div className="muted small">{TOKEN_HELP}</div>
        <div className="row wrap">
          <input className="input" style={{ maxWidth: 260 }} placeholder="搜索称谓或关系链" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索称谓规则" />
          <span className="muted small">{rows?.length ?? 0} 条</span>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setEdit({ chain: "", term: "" })}><Plus size={16} /> 新增规则</button>
        </div>
        {!rows ? <ListSkeleton /> : (
          <div className="table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>关系链</th><th>称谓</th><th style={{ width: 90 }} /></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.id}>
                    <td><code>{r.chain}</code></td>
                    <td>{r.term}</td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="icon-btn" aria-label="编辑" onClick={() => setEdit({ chain: r.chain, term: r.term })}><Pencil size={16} /></button>
                        <button className="icon-btn" aria-label="删除" onClick={async () => {
                          if (await confirm({ title: "删除规则", message: `删除 ${r.chain} → ${r.term}？`, danger: true, okText: "删除" })) {
                            await del(`/api/admin/kinship-rules/${r.id}`);
                            load();
                          }
                        }}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (
        <Modal title="称谓规则" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn btn-primary" onClick={save}>保存</button></>}>
          <div className="stack">
            <div className="field">
              <label>关系链</label>
              <input className="input" value={edit.chain} onChange={(e) => setEdit({ ...edit, chain: e.target.value.trim() })} placeholder="如 m,os,s&o" />
              <span className="muted small">{TOKEN_HELP}</span>
            </div>
            <div className="field">
              <label>称谓</label>
              <input className="input" value={edit.term} onChange={(e) => setEdit({ ...edit, term: e.target.value })} placeholder="如 表哥" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 审计日志 ---------------- */
const ACTION_LABEL: Record<string, string> = { create: "新增", update: "修改", delete: "删除", login: "登录", lock: "锁定", import: "导入", export: "导出" };
const OBJ_LABEL: Record<string, string> = { person: "人物", relationship: "关系", user: "账号", relation_type: "关系类型", kinship_rule: "称谓规则", settings: "设置", system: "系统" };

function AdminAudit() {
  const [objectType, setObjectType] = useState("");
  const [objectId, setObjectId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: { id: number; username: string; action: string; object_type: string; object_id: number | null; summary: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; created_at: string }[] } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    get(`/api/admin/audit-logs?${qs({ object_type: objectType, object_id: objectId, page, size: 30 })}`).then(setData);
  }, [objectType, objectId, page]);
  useEffect(() => setPage(1), [objectType, objectId]);
  return (
    <div className="card">
      <div className="card-body stack">
        <div className="row wrap">
          <select className="select" style={{ maxWidth: 160 }} value={objectType} onChange={(e) => setObjectType(e.target.value)} aria-label="对象类型">
            <option value="">全部对象</option>
            {Object.entries(OBJ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 140 }} placeholder="对象 ID" value={objectId} onChange={(e) => setObjectId(e.target.value.replace(/\D/g, ""))} aria-label="对象 ID" />
        </div>
        {!data ? <ListSkeleton /> : data.items.length === 0 ? <Empty title="暂无日志" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>说明</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: r.before || r.after ? "pointer" : undefined }}>
                      <td className="small" style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at + "Z").toLocaleString()}</td>
                      <td>{r.username || "—"}</td>
                      <td><span className="badge">{ACTION_LABEL[r.action] || r.action}</span></td>
                      <td className="small">
                        {OBJ_LABEL[r.object_type] || r.object_type}
                        {r.object_id ? (
                          <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setObjectType(r.object_type); setObjectId(String(r.object_id)); }} title="查看该对象的全部变更">#{r.object_id}</button>
                        ) : null}
                      </td>
                      <td className="small">{r.summary}</td>
                    </tr>
                    {open === r.id && (r.before || r.after) && (
                      <tr>
                        <td colSpan={5}>
                          <div className="table-wrap">
                            <table className="table small">
                              <thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
                              <tbody>
                                {[...new Set([...Object.keys(r.before || {}), ...Object.keys(r.after || {})])].map((k) => (
                                  <tr key={k}><td>{k}</td><td>{JSON.stringify(r.before?.[k] ?? null)}</td><td>{JSON.stringify(r.after?.[k] ?? null)}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} size={30} total={data.total} onPage={setPage} />}
      </div>
    </div>
  );
}

/* ---------------- 导入导出 ---------------- */
interface ImportResult {
  title: string;
  created: number;
  skipped?: number;
  errors: string[];
  warnings: string[];
}

function ImportResultView({ r }: { r: ImportResult }) {
  const failed = r.errors.length > 0;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`alert ${failed ? "danger" : "info"}`}>
        {failed ? (
          <>
            <strong>{r.title}：发现 {r.errors.length} 处错误，整个文件未导入。</strong>
            <div className="small">请按下面的行号修改文件后重新导入。</div>
          </>
        ) : (
          <strong>
            {r.title}：已导入 {r.created} 条
            {r.skipped ? `，跳过已存在的 ${r.skipped} 条` : ""}。
          </strong>
        )}
      </div>
      {failed && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--danger)", maxHeight: 260, overflow: "auto" }}>
          {r.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {r.warnings.length > 0 && (
        <>
          <div className="small" style={{ color: "var(--warning)" }}>
            请核对以下提示（{failed ? "不影响错误修正" : "已照常导入"}）：
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--warning)", maxHeight: 200, overflow: "auto" }}>
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AdminData() {
  const toast = useToast();
  const confirm = useConfirm();
  const jsonRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const personCsvRef = useRef<HTMLInputElement>(null);
  const relCsvRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [jsonResult, setJsonResult] = useState("");
  const [backupResult, setBackupResult] = useState("");
  const [busy, setBusy] = useState(false);
  const download = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.click();
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const r = await upload<{ persons: number; relationships: number }>("/api/admin/import", f);
      setJsonResult(`已导入 ${r.persons} 位人物、${r.relationships} 条关系`);
      toast("success", "导入完成");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  const restoreFull = async (f?: File) => {
    if (!f) return;
    let data: { format?: string; persons?: unknown[]; relationships?: unknown[]; articles?: unknown[] };
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast("error", "备份文件不是有效的 JSON");
      return;
    }
    if (data.format !== "family-graph-backup") {
      toast("error", "这不是完整备份包，请选择“导出完整备份”生成的文件");
      return;
    }
    const persons = data.persons?.length ?? 0;
    const relationships = data.relationships?.length ?? 0;
    const articles = data.articles?.length ?? 0;
    if (!(await confirm({
      title: "恢复完整备份",
      message: `将用备份替换当前人物、关系、文章、地点、称谓规则和系统设置。\n备份包含 ${persons} 位人物、${relationships} 条关系、${articles} 篇文章。账号和密码不会被替换。`,
      danger: true,
      okText: "确认恢复",
    }))) return;
    setBusy(true);
    setBackupResult("");
    try {
      const r = await upload<{ persons: number; relationships: number; articles: number; message: string }>(
        "/api/admin/restore",
        f,
      );
      setBackupResult(`恢复完成：${r.persons} 位人物、${r.relationships} 条关系、${r.articles} 篇文章。${r.message}`);
      toast("success", "备份恢复完成，即将刷新页面");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async (kind: "persons" | "relationships", f?: File) => {
    if (!f) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await upload<{ created: number; skipped?: number; errors: string[]; warnings: string[] }>(
        `/api/admin/import/${kind}-csv`,
        f,
      );
      setResult({ title: kind === "persons" ? `人物（${f.name}）` : `关系（${f.name}）`, ...r });
      toast(r.errors.length ? "error" : "success", r.errors.length ? "文件有错误，未导入" : "导入完成");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card card-body stack">
        <h2>完整备份与恢复</h2>
        <div className="muted small">
          备份包包含人物、关系、关系类型、文章、地点、称谓规则和系统设置。
          <strong>恢复会整体替换这些数据</strong>；账号与密码保持不变，头像文件不在备份包内。
          恢复前系统还会在服务器媒体目录保存一份恢复前快照。
        </div>
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy} onClick={() => download("/api/admin/backup")}>
            <Download size={16} /> 导出完整备份
          </button>
          <button className="btn" disabled={busy} onClick={() => backupRef.current?.click()}>
            <Upload size={16} /> 恢复完整备份
          </button>
        </div>
        <input
          ref={backupRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            restoreFull(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {backupResult && <div className="alert info small">{backupResult}</div>}
      </div>
      <div className="card card-body stack">
        <h2>批量导入（CSV）</h2>
        <div className="muted small">
          用 Excel 或 WPS 按模板填写后“另存为 CSV（UTF-8）”。<strong>先导入人物，再导入关系</strong>
          （关系表用姓名指代人物，同名的写成“姓名#出生年”）。文件中任何一行有错都不会导入，系统会列出出错的行号和原因；同一份关系表重复导入不会产生重复。
          兄弟姐妹由共同父母自动推导，一般不用单独填写。
        </div>
        <div className="row wrap" style={{ alignItems: "stretch" }}>
          <div className="card card-body stack" style={{ flex: "1 1 260px", gap: 8 }}>
            <strong>第 1 步：人物</strong>
            <div className="muted small">姓名、性别、出生 / 去世日期（支持农历、闰月、时辰）、字辈、排行、籍贯、联系方式、简介等。</div>
            <div className="row wrap">
              <button className="btn btn-primary" disabled={busy} onClick={() => personCsvRef.current?.click()}>
                <Upload size={16} /> 导入人物 CSV
              </button>
              <button className="btn btn-ghost" onClick={() => download("/api/admin/import/persons-template")}>
                <Download size={16} /> 人物模板
              </button>
            </div>
          </div>
          <div className="card card-body stack" style={{ flex: "1 1 260px", gap: 8 }}>
            <strong>第 2 步：关系</strong>
            <div className="muted small">每行“人物A 是 人物B 的 [关系]”，如 父亲、母亲、儿子、妻子、配偶；离异的婚姻在“状态”填“离异”。</div>
            <div className="row wrap">
              <button className="btn btn-primary" disabled={busy} onClick={() => relCsvRef.current?.click()}>
                <Upload size={16} /> 导入关系 CSV
              </button>
              <button className="btn btn-ghost" onClick={() => download("/api/admin/import/relationships-template")}>
                <Download size={16} /> 关系模板
              </button>
            </div>
          </div>
        </div>
        {busy && <div className="muted small">正在导入…</div>}
        {result && <ImportResultView r={result} />}
        <input ref={personCsvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { importCsv("persons", e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={relCsvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { importCsv("relationships", e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <div className="card card-body stack">
        <h2>人物与关系 JSON 追加导入（旧方式）</h2>
        <div className="muted small">只包含人物、关系与关系类型；导入为追加方式（重新编号，不覆盖现有数据）。完整备份恢复请使用上方“完整备份与恢复”。</div>
        <div className="row wrap">
          <button className="btn" onClick={() => download("/api/admin/export")}><Download size={16} /> 导出 JSON</button>
          <button className="btn" onClick={() => jsonRef.current?.click()}><Upload size={16} /> 导入 JSON</button>
        </div>
        <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ""; }} />
        {jsonResult && <div className="alert info small">{jsonResult}</div>}
      </div>
    </div>
  );
}

/* ---------------- 系统设置 ---------------- */
function AdminSettings() {
  const toast = useToast();
  const [s, setS] = useState<{ site_name: string; relation_confirm_required: boolean; amap_key: string; amap_security_code: string } | null>(null);
  useEffect(() => {
    get("/api/settings").then(setS);
  }, []);
  if (!s) return <ListSkeleton />;
  const save = async () => {
    try {
      setS(await put("/api/settings", s));
      toast("success", "设置已保存，站点名称刷新页面后生效");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };
  return (
    <div className="card card-body stack" style={{ maxWidth: 560 }}>
      <div className="field">
        <label>站点名称</label>
        <input className="input" value={s.site_name} onChange={(e) => setS({ ...s, site_name: e.target.value })} />
      </div>
      <fieldset>
        <legend>高德地图（族谱 → 地图）</legend>
        <div className="stack">
          <div className="muted small">
            在 <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer">高德开放平台控制台</a> 创建应用，添加
            “Web端(JS API)”类型的 Key，并把本站域名加入白名单，然后填入 Key 与安全密钥。
          </div>
          <div className="field">
            <label>Key</label>
            <input className="input" value={s.amap_key} onChange={(e) => setS({ ...s, amap_key: e.target.value.trim() })} autoComplete="off" />
          </div>
          <div className="field">
            <label>安全密钥（securityJsCode）</label>
            <input className="input" value={s.amap_security_code} onChange={(e) => setS({ ...s, amap_security_code: e.target.value.trim() })} autoComplete="off" />
          </div>
        </div>
      </fieldset>
      <div><button className="btn btn-primary" onClick={save}>保存</button></div>
    </div>
  );
}

