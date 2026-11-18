import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post } from "../api";
import { useAuth } from "../auth";
import type { PersonBrief, PersonRelation } from "../types";
import { Avatar, Empty, ErrorState, ListSkeleton, Modal, useConfirm, useToast } from "../ui";
import RelationshipForm, { type RelationshipValue } from "./RelationshipForm";

/** 某人物的关系列表，可按权限新增/编辑/删除。 */
export default function RelationsTable({
  person,
  category,
  allowAdd,
  socialOnly,
}: {
  person: PersonBrief;
  category?: "kin" | "social";
  allowAdd?: boolean;
  socialOnly?: boolean;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<PersonRelation[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Partial<RelationshipValue> | null>(null);

  const load = useCallback(() => {
    setError("");
    get<PersonRelation[]>(`/api/persons/${person.id}/relationships`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [person.id]);
  useEffect(load, [load]);

  const remove = async (r: PersonRelation) => {
    const ok = await confirm({
      title: "删除关系",
      message: `确定删除与 ${r.other.name} 的“${r.type_name}”关系吗？此操作会记录在审计日志中。`,
      danger: true,
      okText: "删除",
    });
    if (!ok) return;
    try {
      await del(`/api/relationships/${r.id}`);
      toast("success", "已删除");
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const accept = async (r: PersonRelation) => {
    try {
      await post(`/api/relationships/${r.id}/confirm`);
      toast("success", "已确认");
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  const edit = (r: PersonRelation) => {
    const self = person;
    const a = r.person_a_id === self.id ? self : r.other;
    const b = r.person_b_id === self.id ? self : r.other;
    setEditing({ id: Number(r.id), person_a: a, person_b: b, type_id: r.type_id, start_date: r.start_date, end_date: r.end_date, status: r.status, note: r.note });
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <ListSkeleton rows={4} />;
  const list = rows.filter((r) => !category || r.category === category);

  return (
    <div className="stack">
      {allowAdd && (
        <div>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ person_a: person })}>
            <Plus size={14} /> 新增关系
          </button>
        </div>
      )}
      {list.length === 0 ? (
        <Empty title="暂无关系" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>人物</th>
                <th>关系</th>
                <th className="hide-mobile">时间</th>
                <th className="hide-mobile">备注</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/persons/${r.other.id}`} className="row" style={{ color: "inherit" }}>
                      <Avatar person={r.other} size={28} /> {r.other.name}
                    </Link>
                  </td>
                  <td>
                    <div className="row wrap" style={{ gap: 4 }}>
                      <span className={`badge ${r.category}`}>{r.role_of_other}</span>
                      {r.status === "historical" && <span className="badge">历史</span>}
                      {r.status === "derived" && (
                        <span className="badge" title={r.note || "由共同父母推导"}>
                          推导
                        </span>
                      )}
                      {r.status === "pending" && <span className="badge warning">待确认</span>}
                    </div>
                  </td>
                  <td className="hide-mobile small">{[r.start_date, r.end_date].filter(Boolean).join(" ~ ") || "—"}</td>
                  <td className="hide-mobile small">{r.note || "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                      {r.status === "pending" && (user?.role === "admin" || user?.person_id === person.id) && (
                        <button className="icon-btn" title="确认关系" aria-label="确认关系" onClick={() => accept(r)}>
                          <Check size={16} />
                        </button>
                      )}
                      {r.can_edit && (
                        <>
                          <button className="icon-btn" title="编辑" aria-label="编辑关系" onClick={() => edit(r)}>
                            <Pencil size={16} />
                          </button>
                          <button className="icon-btn" title="删除" aria-label="删除关系" onClick={() => remove(r)}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? "编辑关系" : "新增关系"} onClose={() => setEditing(null)}>
          <RelationshipForm
            value={editing}
            socialOnly={socialOnly}
            lockA={socialOnly && !editing.id}
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
