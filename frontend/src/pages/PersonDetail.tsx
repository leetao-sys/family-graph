import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GitFork, Network as NetIcon, Pencil } from "lucide-react";
import { get, qs } from "../api";
import { useAuth } from "../auth";
import PersonForm from "../components/PersonForm";
import { generationText, lifeText } from "../components/PersonPanel";
import RelationsTable from "../components/RelationsTable";
import type { KinResult, Person } from "../types";
import { GENDER_LABEL } from "../types";
import { Avatar, ErrorState, ListSkeleton, Modal, Seal } from "../ui";
import { birthText } from "../lunar";
import { RichContent } from "../components/RichText";

export default function PersonDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const { user } = useAuth();
  const [person, setPerson] = useState<Person | null>(null);
  const [kin, setKin] = useState<KinResult | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"info" | "rels">("info");

  useEffect(() => {
    setPerson(null);
    setError("");
    get<Person>(`/api/persons/${pid}`).then(setPerson).catch((e) => setError(e.message));
    if (user?.person_id && user.person_id !== pid) {
      get<{ a_to_b: KinResult }>(`/api/kinship?${qs({ a: user.person_id, b: pid })}`)
        .then((r) => setKin(r.a_to_b))
        .catch(() => setKin(null));
    } else setKin(null);
  }, [pid, user?.person_id]);

  if (error)
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  if (!person)
    return (
      <div className="page">
        <ListSkeleton />
      </div>
    );

  const isAdmin = user?.role === "admin";
  const rows: [string, string | null | undefined][] = [
    ["性别", GENDER_LABEL[person.gender]],
    ["出生", person.is_living ? birthText(person) : null],
    ["生卒", person.is_living ? null : lifeText(person)],
    ["世代", generationText(person)],
    ["排行", person.birth_order ? `第 ${person.birth_order}` : null],
    ["曾用名", person.former_name],
    ["字 / 号", person.courtesy_name],
    ["封赠 / 功名", person.honorific],
    ["昵称", person.nickname],
    ["所属分支", person.branch],
    ["堂号", person.hall_name],
    ["籍贯", person.native_place],
    ["民族", person.ethnicity],
    ["出生地（今）", person.birth_place_modern],
    ["安葬地", person.burial_place],
    ["出嫁地", person.marriage_place ? `${person.marriage_place}${person.marriage_inferred ? "（推断）" : ""}` : null],
    ["旧地名", person.birth_place_modern ? person.birth_place : null],
    ["现居地", person.residence],
    ["手机", person.phone],
    ["邮箱", person.email],
    ["工作单位", person.employer],
    ["职业", person.occupation],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="page person-page">
      <div className="person-hero">
        <span className="person-hero-seal">{person.surname || "谱"}</span>
        <div className="person-portrait">
          {person.avatar ? <img className={!person.is_living ? "deceased" : ""} src={person.avatar_large ?? ""} alt="" /> : <Avatar person={person} size={108} />}
        </div>
        <div className="person-hero-main">
          <div className="kicker">{generationText(person) || "谱中人物"} · 人物小传</div>
          <h1>
            {person.name}
            {!person.is_living && (
              <span className="en" style={{ color: "var(--cinnabar)" }}>
                已故
              </span>
            )}
          </h1>
          <div className="life">
            {lifeText(person) || "生卒不详"}
            {person.branch && <span style={{ marginLeft: 12, color: "var(--ink-3)" }}>· {person.branch}</span>}
          </div>
          <div className="badges">
            {kin?.term && <span className="badge kin">我的{kin.term}</span>}
            {person.id === user?.person_id && <span className="badge primary">我</span>}
            {person.has_account && <span className="badge primary">已注册账号</span>}
            {person.native_place && <span className="badge">{person.native_place}</span>}
          </div>
        </div>
        <div className="person-hero-actions">
          <Link className="btn btn-sm" to={`/network?center=${person.id}`}>
            <NetIcon size={14} /> 关系网
          </Link>
          <Link className="btn btn-sm" to={`/tree?root=${person.id}`}>
            <GitFork size={14} style={{ transform: "rotate(180deg)" }} /> 族谱
          </Link>
          {person.can_edit && (
            <button className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
              <Pencil size={14} /> 编辑资料
            </button>
          )}
        </div>
      </div>

      <div className="person-columns">
        <aside className="person-toc" aria-hidden="true">
          <span className="toc-mark">人 物 小 传</span>
          <span className="toc-dot" />
          <Seal char={person.surname?.slice(0, 1) || "谱"} size={26} ghost />
        </aside>
        <div className="person-content">
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === "info"} onClick={() => setTab("info")}>
              基本信息
            </button>
            <button className="tab" role="tab" aria-selected={tab === "rels"} onClick={() => setTab("rels")}>
              亲属关系
            </button>
          </div>
          {tab === "info" ? (
            <div style={{ marginTop: 20 }}>
              {kin?.paths?.[0] && (
                <div className="alert info small" style={{ marginBottom: 16 }}>
                  关系推导：我 → {kin.paths[0].description}
                </div>
              )}
              <div className="person-facts">
                {rows.map(([k, v]) => (
                  <div className="person-fact" key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </div>
              {person.hidden_fields && person.hidden_fields.length > 0 && (
                <div className="muted small" style={{ marginTop: 10 }}>
                  部分信息因隐私设置不可见
                </div>
              )}
              {person.bio && (
                <section className="person-section">
                  <h2>小传</h2>
                  <RichContent content={person.bio} format={person.bio_format || "markdown"} className="person-bio" />
                </section>
              )}
              {isAdmin && person.notes && (
                <section className="person-section">
                  <h2>管理员备注</h2>
                  <div className="person-notes">{person.notes}</div>
                </section>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <RelationsTable person={person} allowAdd={isAdmin} />
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={`编辑资料：${person.name}`} onClose={() => setEditing(false)}>
          <PersonForm
            person={person}
            showNotes={isAdmin}
            onCancel={() => setEditing(false)}
            onChange={setPerson}
            onSaved={(p) => {
              setPerson(p);
              setEditing(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

