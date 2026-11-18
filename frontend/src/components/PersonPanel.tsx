import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, GitFork, Network as NetIcon, Route, X } from "lucide-react";
import { get, qs } from "../api";
import { useAuth } from "../auth";
import type { KinResult, Person, PersonBrief, PersonRelation } from "../types";
import { GENDER_LABEL } from "../types";
import { Avatar, ErrorState, ListSkeleton, Seal } from "../ui";
import { birthText, deathText, type LifeDates } from "../lunar";
import { RichContent } from "./RichText";

export function generationText(p: { generation: number | null; generation_name?: string | null }) {
  if (p.generation === null || p.generation === undefined) return null;
  return `第 ${p.generation + 1} 世${p.generation_name ? `（${p.generation_name}字辈）` : ""}`;
}

export function lifeText(p: LifeDates & { is_living: boolean }) {
  const b = birthText(p);
  const d = deathText(p);
  if (!b && !d) return p.is_living ? null : "已故";
  if (p.is_living && !d) return b;
  return `${b || "?"} – ${d || "?"}`;
}

/** 人物笺：基本信息 + 与谱心 / 我的关系 + 全部关系。 */
export default function PersonPanel({
  personId,
  centerId,
  onClose,
  onCenter,
  onSelect,
  view,
}: {
  personId: number;
  centerId?: number;
  onClose: () => void;
  onCenter?: (id: number) => void;
  onSelect?: (id: number) => void;
  view: "network" | "tree";
}) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [rels, setRels] = useState<PersonRelation[] | null>(null);
  const [meKin, setMeKin] = useState<KinResult | null>(null);
  const [centerKin, setCenterKin] = useState<{ a_to_b: KinResult; b_to_a: KinResult } | null>(null);
  const [path, setPath] = useState<{ nodes: PersonBrief[]; edges: { label: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const me = user?.person_id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setPerson(null);
    setRels(null);
    setMeKin(null);
    setCenterKin(null);
    setPath(null);
    setError("");
    Promise.all([get<Person>(`/api/persons/${personId}`), get<PersonRelation[]>(`/api/persons/${personId}/relationships`)])
      .then(([p, r]) => {
        if (!alive) return;
        setPerson(p);
        setRels(r);
      })
      .catch((e) => alive && setError(e.message));
    if (me && me !== personId) {
      get<{ a_to_b: KinResult }>(`/api/kinship?${qs({ a: me, b: personId })}`)
        .then((r) => alive && setMeKin(r.a_to_b))
        .catch(() => {});
    }
    if (centerId && centerId !== personId) {
      get<{ a_to_b: KinResult; b_to_a: KinResult }>(`/api/kinship?${qs({ a: centerId, b: personId })}`)
        .then((r) => alive && setCenterKin(r))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [personId, me, centerId, reload]);

  const showPath = async () => {
    if (!me) return;
    try {
      setPath(await get(`/api/graph/path?${qs({ from: me, to: personId })}`));
    } catch {
      setPath({ nodes: [], edges: [] });
    }
  };

  return (
    <aside className="atlas-drawer" aria-label="人物笺">
      <div className="atlas-drawer-head">
        <Seal char="笺" size={26} />
        <div>
          <div className="drawer-title">人 物 笺</div>
          <div className="muted tiny" style={{ letterSpacing: ".12em" }}>
            {view === "network" ? "谱系关系" : "族谱长卷"}
          </div>
        </div>
        <span className="spacer" />
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="关闭人物笺">
          <X size={17} />
        </button>
      </div>

      <div className="atlas-drawer-body">
        {error ? (
          <ErrorState message={error} onRetry={() => setReload((x) => x + 1)} />
        ) : !person || !rels ? (
          <ListSkeleton rows={8} />
        ) : (
          <div className="stack" style={{ gap: 0 }}>
            <div className="drawer-person">
              <Avatar person={person} size={64} />
              <div style={{ minWidth: 0 }}>
                <div className="name">
                  {person.name}
                  {person.id === me && <span className="badge primary" style={{ marginLeft: 7, verticalAlign: "middle" }}>我</span>}
                </div>
                <div className="dates">{lifeText(person) || "生卒不详"}</div>
                <div className="badges">
                  <span className="badge">{GENDER_LABEL[person.gender]}</span>
                  {!person.is_living && <span className="badge">已故</span>}
                  {person.has_account && <span className="badge primary">已注册</span>}
                  {generationText(person) && <span className="badge kin">{generationText(person)}</span>}
                </div>
              </div>
            </div>

            <div className="drawer-actions">
              {onCenter && centerId !== person.id && (
                <button className="btn btn-sm btn-primary" onClick={() => onCenter(person.id)}>
                  <CrosshairIcon /> {view === "network" ? "设为谱心" : "设为起点"}
                </button>
              )}
              {view === "tree" ? (
                <button className="btn btn-sm" onClick={() => nav(`/network?center=${person.id}`)}>
                  <NetIcon size={14} /> 关系网
                </button>
              ) : (
                <button className="btn btn-sm" onClick={() => nav(`/tree?root=${person.id}`)}>
                  <GitFork size={14} style={{ transform: "rotate(180deg)" }} /> 族谱
                </button>
              )}
              <Link className="btn btn-sm" to={`/persons/${person.id}`}>
                <ExternalLink size={14} /> 详情
              </Link>
            </div>

            {(centerKin || meKin) && (
              <section className="drawer-section">
                <h3>称 谓</h3>
                {centerKin?.a_to_b?.term && centerId && centerId !== person.id && (
                  <div className="drawer-kinship" style={{ marginBottom: meKin && me !== centerId ? 8 : 0 }}>
                    <div className="small muted">
                      {centerId === me ? "你" : "谱心人物"}称 TA 为
                    </div>
                    <div className="term">{centerKin.a_to_b.term}</div>
                    {centerKin.a_to_b.paths?.[0]?.description && (
                      <div className="chain">{centerKin.a_to_b.paths[0].description}</div>
                    )}
                  </div>
                )}
                {meKin?.term && me !== person.id && me !== centerId && (
                  <div className="drawer-kinship">
                    <div className="small muted">你称 TA 为</div>
                    <div className="term">我的{meKin.term}</div>
                    {meKin.paths?.[0]?.description && <div className="chain">{meKin.paths[0].description}</div>}
                  </div>
                )}
              </section>
            )}

            <section className="drawer-section">
              <h3>生 平</h3>
              <dl className="kv" style={{ gridTemplateColumns: "72px 1fr" }}>
                {lifeText(person) && (
                  <>
                    <dt>生卒</dt>
                    <dd>{lifeText(person)}</dd>
                  </>
                )}
                {generationText(person) && (
                  <>
                    <dt>世代</dt>
                    <dd>{generationText(person)}</dd>
                  </>
                )}
                {person.birth_order ? (
                  <>
                    <dt>排行</dt>
                    <dd>第 {person.birth_order}</dd>
                  </>
                ) : null}
                {person.honorific && (
                  <>
                    <dt>封赠</dt>
                    <dd>{person.honorific}</dd>
                  </>
                )}
                {person.native_place && (
                  <>
                    <dt>籍贯</dt>
                    <dd>{person.native_place}</dd>
                  </>
                )}
                {person.birth_place_modern && (
                  <>
                    <dt>出生（今）</dt>
                    <dd>{person.birth_place_modern}</dd>
                  </>
                )}
                {person.birth_place && (
                  <>
                    <dt>出生（旧）</dt>
                    <dd>{person.birth_place}</dd>
                  </>
                )}
                {person.burial_place && (
                  <>
                    <dt>安葬地</dt>
                    <dd>{person.burial_place}</dd>
                  </>
                )}
                {person.gender === "female" && person.marriage_place && (
                  <>
                    <dt>出嫁地</dt>
                    <dd>
                      {person.marriage_place}
                      {person.marriage_inferred && <span className="muted small">（推断）</span>}
                    </dd>
                  </>
                )}
                {person.branch && (
                  <>
                    <dt>分支</dt>
                    <dd>{person.branch}</dd>
                  </>
                )}
                {person.occupation && (
                  <>
                    <dt>职业</dt>
                    <dd>{person.occupation}</dd>
                  </>
                )}
                {person.residence && (
                  <>
                    <dt>现居</dt>
                    <dd>{person.residence}</dd>
                  </>
                )}
                {person.phone && (
                  <>
                    <dt>手机</dt>
                    <dd>{person.phone}</dd>
                  </>
                )}
              </dl>
            </section>

            {person.bio && (
              <section className="drawer-section">
                <h3>小 传</h3>
                <RichContent content={person.bio} format={person.bio_format || "markdown"} className="small" />
              </section>
            )}

            {me && me !== person.id && (
              <section className="drawer-section">
                <h3>路 径</h3>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">从「我」到 TA 的关系链</span>
                  {!path && (
                    <button className="btn btn-sm btn-ghost" onClick={showPath}>
                      <Route size={13} /> 查询
                    </button>
                  )}
                </div>
                {path &&
                  (path.nodes.length ? (
                    <div className="chainline" style={{ marginTop: 8 }}>
                      {path.nodes.map((n, i) => (
                        <span key={n.id} className="row" style={{ gap: 4 }}>
                          {i > 0 && <span className="muted small">—{path.edges[i - 1]?.label}→</span>}
                          <span className="step">{n.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted small">没有找到关系路径</span>
                  ))}
              </section>
            )}

            <section className="drawer-section">
              <h3>全 部 关 系 · {rels.length}</h3>
              {rels.length === 0 ? (
                <span className="muted small">暂无关系</span>
              ) : (
                <div className="drawer-relation-group">
                  {rels.map((r) => (
                    <button
                      key={r.id}
                      className="drawer-relation"
                      onClick={() => {
                        if (onSelect) onSelect(r.other.id);
                        else if (onCenter) onCenter(r.other.id);
                        else nav(`/persons/${r.other.id}`);
                      }}
                      title={onSelect ? `查看 ${r.other.name}` : onCenter ? `以 ${r.other.name} 为谱心` : r.other.name}
                    >
                      <Avatar person={r.other} size={26} />
                      <span className="rel-name">{r.other.name}</span>
                      <span className={`badge ${r.category}`} style={{ marginLeft: 2 }}>
                        {r.role_of_other}
                      </span>
                      {r.status === "historical" && <span className="badge">历史</span>}
                      {r.status === "derived" && <span className="badge" title={r.note || "由共同父母推导"}>推导</span>}
                      {r.status === "pending" && <span className="badge warning">待确认</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

function CrosshairIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}
