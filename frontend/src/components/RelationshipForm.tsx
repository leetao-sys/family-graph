import { useState, type FormEvent } from "react";
import { ApiError, post, put } from "../api";
import { useAuth } from "../auth";
import type { PersonBrief } from "../types";
import { PersonPicker, useConfirm, useToast } from "../ui";
import DateInput, { solarDateError } from "./DateInput";

interface Suggestion {
  person_a_id: number;
  person_b_id: number;
  type_id: number;
  label: string;
  reason: string;
  checked: boolean;
}

export interface RelationshipValue {
  id?: number;
  person_a: PersonBrief | null;
  person_b: PersonBrief | null;
  type_id: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  note: string | null;
  is_public?: boolean;
}

/** 新增/编辑关系。普通成员只能选择社会关系，且一方固定为本人。 */
export default function RelationshipForm({
  value,
  onSaved,
  onCancel,
  socialOnly,
  lockA,
}: {
  value?: Partial<RelationshipValue>;
  onSaved: () => void;
  onCancel: () => void;
  socialOnly?: boolean;
  lockA?: boolean;
}) {
  const { types } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState<RelationshipValue>({
    person_a: null,
    person_b: null,
    type_id: null,
    start_date: null,
    end_date: null,
    status: "active",
    note: null,
    ...value,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const options = types.filter((t) => !socialOnly || t.category === "social");
  const type = types.find((t) => t.id === v.type_id);

  const describe = () => {
    if (!type || !v.person_a || !v.person_b) return null;
    if (type.kinship_role && ["parent", "adoptive", "step"].includes(type.kinship_role))
      return `${v.person_a.name} 是 ${v.person_b.name} 的${type.forward_name}`;
    return type.symmetric
      ? `${v.person_a.name} 与 ${v.person_b.name} 互为${type.name}`
      : `${v.person_a.name} 是 ${v.person_b.name} 的${type.forward_name}`;
  };

  /** 关系联动：询问是否同步补上相关的父母关系（兄弟姐妹由共同父母自动推导） */
  const offerFollowups = async (list: Suggestion[]) => {
    const picked = new Set<number>();
    list.forEach((s, i) => s.checked && picked.add(i));
    const ok = await confirm({
      title: "同步添加相关关系？",
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted small">根据刚添加的关系，下列关系可能也成立。勾选后一并添加；兄弟姐妹关系会由共同父母自动得出。</div>
          {list.map((s, i) => (
            <label key={i} className="checkbox" style={{ alignItems: "flex-start" }}>
              <input
                type="checkbox"
                defaultChecked={s.checked}
                onChange={(e) => (e.target.checked ? picked.add(i) : picked.delete(i))}
                style={{ marginTop: 3 }}
              />
              <span>
                {s.label}
                <span className="muted small" style={{ display: "block" }}>
                  {s.reason}
                </span>
              </span>
            </label>
          ))}
        </div>
      ),
      okText: "添加勾选的关系",
    });
    if (!ok || !picked.size) return;
    let added = 0;
    const failed: string[] = [];
    for (const i of [...picked].sort()) {
      const s = list[i];
      try {
        await post("/api/relationships", { person_a_id: s.person_a_id, person_b_id: s.person_b_id, type_id: s.type_id, confirm: true });
        added++;
      } catch (e) {
        failed.push(`${s.label}：${(e as Error).message}`);
      }
    }
    if (added) toast("success", `已同步添加 ${added} 条关系`);
    if (failed.length) toast("error", failed.join("；"));
  };

  const save = async (confirmed = false): Promise<void> => {
    const body = {
      person_a_id: v.person_a!.id,
      person_b_id: v.person_b!.id,
      type_id: v.type_id,
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      status: v.status,
      note: v.note || null,
      confirm: confirmed,
    };
    try {
      if (v.id) await put(`/api/relationships/${v.id}`, body);
      else {
        const created = await post<{ suggestions?: Suggestion[] }>("/api/relationships", body);
        toast("success", "关系已保存");
        if (created.suggestions?.length) await offerFollowups(created.suggestions);
        onSaved();
        return;
      }
      toast("success", "关系已保存");
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 409 && e.warnings.length) {
        const ok = await confirm({
          title: "请确认",
          message: (
            <div className="stack" style={{ gap: 6 }}>
              {e.warnings.map((w) => (
                <div key={w}>• {w}</div>
              ))}
              <div className="muted small">仍要保存吗？</div>
            </div>
          ),
          okText: "仍然保存",
        });
        if (ok) return save(true);
        return;
      }
      setError(e.message);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!v.person_a || !v.person_b) return setError("请选择两位人物");
    if (v.person_a.id === v.person_b.id) return setError("不能与自己建立关系");
    if (!v.type_id) return setError("请选择关系类型");
    const dateErr = solarDateError(v.start_date) || solarDateError(v.end_date);
    if (dateErr) return setError(dateErr);
    if (v.start_date && v.end_date && v.end_date < v.start_date) return setError("结束时间早于开始时间");
    setBusy(true);
    await save();
    setBusy(false);
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="field">
          <label>人物 A</label>
          {lockA ? (
            <input className="input" value={v.person_a?.name || ""} disabled />
          ) : (
            <PersonPicker value={v.person_a} onChange={(p) => setV({ ...v, person_a: p })} ariaLabel="人物 A" />
          )}
        </div>
        <div className="field">
          <label>关系类型</label>
          <select className="select" value={v.type_id ?? ""} onChange={(e) => setV({ ...v, type_id: Number(e.target.value) || null })} aria-label="关系类型">
            <option value="">请选择</option>
            {(["kin", "social"] as const).map((cat) => {
              const list = options.filter((t) => t.category === cat);
              if (!list.length) return null;
              return (
                <optgroup key={cat} label={cat === "kin" ? "族谱关系" : "社会关系"}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {!t.symmetric ? `（A 是 B 的${t.forward_name}）` : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
        <div className="field">
          <label>人物 B</label>
          <PersonPicker value={v.person_b} onChange={(p) => setV({ ...v, person_b: p })} ariaLabel="人物 B" />
        </div>
        <div className="field">
          <label>开始时间</label>
          <DateInput label="开始" value={v.start_date || ""} onChange={(d) => setV({ ...v, start_date: d })} />
        </div>
        <div className="field">
          <label>结束时间</label>
          <DateInput label="结束" value={v.end_date || ""} onChange={(d) => setV({ ...v, end_date: d })} />
        </div>
        <div className="field">
          <label>状态</label>
          <select className="select" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="active">有效</option>
            <option value="historical">历史（如离异、已结束）</option>
            {!socialOnly && <option value="pending">待确认</option>}
          </select>
        </div>
        <div className="field span-all">
          <label>备注</label>
          <input className="input" value={v.note || ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </div>
      </div>
      {type?.category === "social" && (
        <div className="muted small">社会关系仅自己可见：只有登记人本人和管理员能看到这条关系。</div>
      )}
      {describe() && <div className="alert info small">{describe()}</div>}
      {error && <div className="alert danger">{error}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
