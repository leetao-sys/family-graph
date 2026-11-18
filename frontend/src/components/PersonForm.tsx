import { useRef, useState, type FormEvent } from "react";
import { Trash2, Upload } from "lucide-react";
import { ApiError, del, get, post, put, qs, upload } from "../api";
import { useAuth } from "../auth";
import type { Person, PersonBrief, PersonRelation } from "../types";
import { Avatar, PersonLine, PersonPicker, useConfirm, useToast } from "../ui";
import { BRANCHES, dateText, hourRange } from "../lunar";
import DateInput, { solarDateError } from "./DateInput";
import { RichEditor, type TextFormat } from "./RichText";

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

type FormState = Record<string, string | boolean | null>;

const EMPTY: FormState = {
  surname: "", given_name: "", former_name: "", courtesy_name: "", honorific: "", nickname: "", gender: "unknown",
  birth_date: "", birth_lunar: false, birth_lunar_leap: false, birth_hour: "", death_date: "",
  death_lunar: false, death_lunar_leap: false, death_hour: "", is_living: true, generation_name: "", birth_order: "",
  branch: "", hall_name: "", native_place: "", ethnicity: "", phone: "", email: "", residence: "",
  employer: "", occupation: "", birth_place: "", birth_place_modern: "", burial_place: "", marriage_place: "", bio: "", bio_format: "markdown", notes: "",
};

function toState(p?: Person | null): FormState {
  if (!p) return { ...EMPTY };
  const s: FormState = { ...EMPTY };
  Object.keys(EMPTY).forEach((k) => {
    const v = (p as unknown as Record<string, unknown>)[k];
    s[k] = typeof v === "boolean" ? v : v === null || v === undefined ? (typeof EMPTY[k] === "boolean" ? EMPTY[k] : "") : String(v);
  });
  return s;
}

function toPayload(s: FormState) {
  const out: Record<string, unknown> = {};
  Object.entries(s).forEach(([k, v]) => {
    if (typeof v === "boolean") out[k] = v;
    else if (k === "birth_order") out[k] = v ? Number(v) : null;
    else if (k === "surname" || k === "given_name" || k === "gender") out[k] = v ?? "";
    else out[k] = v === "" ? null : v;
  });
  return out;
}

/** 人物资料表单：管理员新增/编辑，成员编辑本人资料。 */
export default function PersonForm({
  person,
  onSaved,
  onChange,
  onCancel,
  showNotes,
}: {
  person?: Person | null;
  onSaved: (p: Person) => void;
  onChange?: (p: Person) => void; // 头像变化（不关闭表单）
  onCancel?: () => void;
  showNotes?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [s, setS] = useState<FormState>(() => toState(person));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<Person | null>(person ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { types } = useAuth();
  // 新增人物时直接选择父母（等同于同时添加两条“亲子”关系）
  const [father, setFather] = useState<PersonBrief | null>(null);
  const [mother, setMother] = useState<PersonBrief | null>(null);
  const [parentHint, setParentHint] = useState("");

  /** 选了一位家长后：另一位为空时自动填其唯一的现任配偶；姓、籍贯、堂号、分支为空时沿用（优先父亲） */
  const onPickParent = async (role: "father" | "mother", p: PersonBrief | null) => {
    (role === "father" ? setFather : setMother)(p);
    if (!p) return setParentHint("");
    const hints: string[] = [];
    try {
      const [full, rels] = await Promise.all([
        get<Person>(`/api/persons/${p.id}`),
        get<PersonRelation[]>(`/api/persons/${p.id}/relationships`),
      ]);
      const spouseType = types.find((t) => t.kinship_role === "spouse")?.id;
      const spouses = rels.filter((r) => r.type_id === spouseType && r.status === "active" && r.role_of_other === "配偶");
      const otherEmpty = role === "father" ? !mother : !father;
      if (otherEmpty && spouses.length === 1) {
        const sp = spouses[0].other;
        (role === "father" ? setMother : setFather)(sp);
        hints.push(`已自动填入${role === "father" ? "母亲" : "父亲"}：${sp.name}（${p.name}的配偶），可修改`);
      }
      // 沿用家族信息：以父亲为准，没选父亲时用母亲
      if (role === "father" || !father) {
        const inherit: [string, string, string | null][] = [
          ["surname", "姓", role === "father" ? full.surname : null],
          ["native_place", "籍贯", full.native_place],
          ["hall_name", "堂号", full.hall_name],
          ["branch", "分支", full.branch],
        ];
        const updates = inherit.filter(([k, , v]) => v && !String(s[k] ?? "").trim());
        const filled = updates.map(([, label]) => label);
        if (updates.length) setS((x) => ({ ...x, ...Object.fromEntries(updates.map(([k, , v]) => [k, v])) }));
        if (filled.length) hints.push(`已沿用${p.name}的${filled.join("、")}`);
      }
    } catch {
      /* 读取失败时仅选择父母，不做自动填充 */
    }
    setParentHint(hints.join("；"));
  };

  const set = (k: string, v: string | boolean) => setS((x) => ({ ...x, [k]: v }));
  const text = (k: string, label: string, opts: { placeholder?: string; type?: string; span?: boolean } = {}) => (
    <div className={`field ${opts.span ? "span-all" : ""}`}>
      <label htmlFor={`pf-${k}`}>{label}</label>
      <input
        id={`pf-${k}`}
        className={`input ${errors[k] ? "invalid" : ""}`}
        type={opts.type || "text"}
        placeholder={opts.placeholder}
        value={String(s[k] ?? "")}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={!!errors[k]}
      />
      {errors[k] && <span className="error">{errors[k]}</span>}
    </div>
  );

  /** 出生 / 去世日期：各自可选公历或农历，时辰可不填 */
  const dateBlock = (kind: "birth" | "death") => {
    const word = kind === "birth" ? "出生" : "去世";
    const dk = `${kind}_date`, lk = `${kind}_lunar`, leapK = `${kind}_lunar_leap`, hk = `${kind}_hour`;
    const lunar = !!s[lk];
    const value = String(s[dk] ?? "");
    return (
      <>
        <label className="checkbox" style={{ alignSelf: "end", height: 38 }}>
          <input type="checkbox" checked={lunar} onChange={(e) => setS((x) => ({ ...x, [lk]: e.target.checked, [leapK]: false }))} />{" "}
          {kind === "birth" ? "农历生日" : "农历忌日"}
        </label>
        <div className="field span-all">
          <label>
            {word}日期（{lunar ? "农历" : "公历"}，可只选年或年月）
          </label>
          <DateInput
            label={word}
            calendar={lunar ? "lunar" : "solar"}
            value={value}
            leap={!!s[leapK]}
            invalid={!!errors[dk]}
            onChange={(date) => setS((x) => ({ ...x, [dk]: date, ...(date.length < 7 ? { [leapK]: false } : {}) }))}
            onLeapChange={(leap) => set(leapK, leap)}
          />
          {errors[dk] && <span className="error">{errors[dk]}</span>}
        </div>
        <div className="field">
          <label htmlFor={`pf-${hk}`}>{word}时辰（可不填）</label>
          <select id={`pf-${hk}`} className="select" value={String(s[hk] ?? "")} onChange={(e) => set(hk, e.target.value)}>
            <option value="">不填</option>
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}时（{hourRange(b)}）
              </option>
            ))}
          </select>
        </div>
        {value && DATE_RE.test(value) && (
          <div className="field span-all">
            <span className="muted small">
              显示为：{dateText(value, { lunar, leap: !!s[leapK], hour: String(s[hk] || "") })}
            </span>
          </div>
        )}
      </>
    );
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!String(s.surname).trim() && !String(s.given_name).trim()) e.given_name = "请至少填写姓或名";
    for (const k of ["birth_date", "death_date"]) {
      if (s[k] && !DATE_RE.test(String(s[k]))) e[k] = "请填写 4 位年份";
      else if (s[k] && !s[k.replace("_date", "_lunar")]) {
        const err = solarDateError(String(s[k]));
        if (err) e[k] = err;
      }
    }
    // 农历日期与公历不可直接比较；任一为农历时只比较年份
    const cmpLen = s.birth_lunar || s.death_lunar ? 4 : 10;
    if (s.birth_date && s.death_date && String(s.death_date).slice(0, cmpLen) < String(s.birth_date).slice(0, cmpLen))
      e.death_date = "去世日期早于出生日期";
    if (s.email && !/^\S+@\S+\.\S+$/.test(String(s.email))) e.email = "邮箱格式不正确";
    if (s.birth_order && !/^\d{1,2}$/.test(String(s.birth_order))) e.birth_order = "请填写数字";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!current) {
      // 新增时提示同名人物，避免重复录入；确认是不同的人仍可继续
      const name = `${String(s.surname).trim()}${String(s.given_name).trim()}`;
      try {
        const r = await get<{ items: PersonBrief[] }>(`/api/persons?${qs({ q: name, size: 20 })}`);
        const same = r.items.filter((p) => p.name === name);
        if (
          same.length &&
          !(await confirm({
            title: "已有同名人物",
            message: (
              <div className="stack" style={{ gap: 6 }}>
                <div>系统中已有 {same.length} 位“{name}”：</div>
                {same.map((p) => (
                  <PersonLine key={p.id} p={p} />
                ))}
                <div className="muted small">如果是同一个人，请取消后直接编辑已有人物；确认是不同的人可继续创建（建议补充出生日期、父母关系以便区分）。</div>
              </div>
            ),
            okText: "仍然创建",
          }))
        )
          return;
      } catch {
        /* 查重失败不阻止创建 */
      }
    }
    setBusy(true);
    const send = async (confirmed: boolean): Promise<void> => {
      const payload = toPayload(s);
      if (payload.death_date) payload.is_living = false;
      if (!current) Object.assign(payload, { father_id: father?.id ?? null, mother_id: mother?.id ?? null, confirm: confirmed });
      try {
        const saved = current
          ? await put<Person>(`/api/persons/${current.id}`, payload)
          : await post<Person>("/api/persons", payload);
        const parents = [father && `父亲 ${father.name}`, mother && `母亲 ${mother.name}`].filter(Boolean);
        toast("success", !current && parents.length ? `已保存，并登记${parents.join("、")}` : "已保存");
        setCurrent(saved);
        onSaved(saved);
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 409 && e.warnings.length) {
          const ok = await confirm({
            title: "请确认父母关系",
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
          if (ok) return send(true);
          return;
        }
        toast("error", e.message);
      }
    };
    try {
      await send(false);
    } finally {
      setBusy(false);
    }
  };

  const onAvatar = async (file?: File) => {
    if (!file || !current) return;
    if (file.size > 5 * 1024 * 1024) return toast("error", "图片不能超过 5MB");
    try {
      const saved = await upload<Person>(`/api/persons/${current.id}/avatar`, file);
      setCurrent(saved);
      onChange?.(saved);
      toast("success", "头像已更新");
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const removeAvatar = async () => {
    if (!current) return;
    if (!(await confirm({ title: "删除头像", message: "删除后将显示默认头像，确定吗？", danger: true, okText: "删除" }))) return;
    const saved = await del<Person>(`/api/persons/${current.id}/avatar`);
    setCurrent(saved);
    onChange?.(saved);
  };

  return (
    <form className="stack" onSubmit={submit} noValidate style={{ gap: 16 }}>
      {current && (
        <div className="row" style={{ gap: 16 }}>
          <img className="avatar" src={current.avatar_large || undefined} alt="" style={{ display: current.avatar_large ? "block" : "none", width: 72, height: 72 }} />
          {!current.avatar_large && <Avatar person={current} size={72} />}
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> 上传头像
              </button>
              {current.avatar && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={removeAvatar}>
                  <Trash2 size={14} /> 删除
                </button>
              )}
            </div>
            <span className="muted small">JPG / PNG / WebP，不超过 5MB，自动居中裁剪为正方形</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => onAvatar(e.target.files?.[0])} />
          </div>
        </div>
      )}
      <fieldset>
        <legend>基本信息</legend>
        <div className="form-grid">
          {text("surname", "姓")}
          {text("given_name", "名")}
          <div className="field">
            <label htmlFor="pf-gender">性别</label>
            <select id="pf-gender" className="select" value={String(s.gender)} onChange={(e) => set("gender", e.target.value)}>
              <option value="male">男</option>
              <option value="female">女</option>
              <option value="unknown">未知</option>
            </select>
          </div>
          {dateBlock("birth")}
          <label className="checkbox" style={{ alignSelf: "end", height: 38 }}>
            <input type="checkbox" checked={!!s.is_living} onChange={(e) => set("is_living", e.target.checked)} /> 在世
          </label>
          {!s.is_living && dateBlock("death")}
          {text("former_name", "曾用名")}
          {text("courtesy_name", "字 / 号")}
          {text("honorific", "封赠 / 功名", { placeholder: "如 例赠登仕郎、太学生、敕授文林郎" })}
          {text("nickname", "昵称 / 小名")}
        </div>
      </fieldset>
      <fieldset>
        <legend>家族信息</legend>
        <div className="form-grid">
          {!current && (
            <>
              <div className="field">
                <label>父亲（可选）</label>
                <PersonPicker value={father} onChange={(p) => onPickParent("father", p)} ariaLabel="父亲" placeholder="搜索父亲姓名" />
              </div>
              <div className="field">
                <label>母亲（可选）</label>
                <PersonPicker value={mother} onChange={(p) => onPickParent("mother", p)} ariaLabel="母亲" placeholder="搜索母亲姓名" />
              </div>
              <div className="field span-all">
                <span className="muted small">
                  {parentHint || "选择父母后会同时登记亲子关系，兄弟姐妹由共同父母自动得出。"}
                </span>
              </div>
            </>
          )}
          {text("generation_name", "字辈")}
          {text("birth_order", "排行", { placeholder: "兄弟姐妹中第几" })}
          {text("branch", "所属分支")}
          {text("hall_name", "堂号")}
          {text("native_place", "籍贯")}
          {text("ethnicity", "民族")}
          {text("birth_place", "出生地（旧）")}
          {text("birth_place_modern", "出生地（今）", { placeholder: "如：贵州省毕节市大方县东关乡" })}
          {text("burial_place", "安葬地（今）", { placeholder: "已故人物的安葬地点" })}
          {text("marriage_place", "出嫁地（今）", { placeholder: "女性出嫁/出阁地点" })}
        </div>
      </fieldset>
      <fieldset>
        <legend>联系与工作</legend>
        <div className="form-grid">
          {text("phone", "手机")}
          {text("email", "邮箱", { type: "email" })}
          {text("residence", "现居地")}
          {text("employer", "工作单位")}
          {text("occupation", "职业")}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="pf-bio">简介 / 传记</label>
        <RichEditor
          id="pf-bio"
          value={String(s.bio ?? "")}
          format={(s.bio_format as TextFormat) || "markdown"}
          minHeight={160}
          onChange={(bio, bio_format) => setS((x) => ({ ...x, bio, bio_format }))}
        />
      </div>
      {showNotes && (
        <div className="field">
          <label htmlFor="pf-notes">管理员备注（仅管理员与本人可见）</label>
          <textarea id="pf-notes" className="textarea" value={String(s.notes ?? "")} onChange={(e) => set("notes", e.target.value)} />
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "保存中…" : current ? "保存" : "创建"}
        </button>
      </div>
    </form>
  );
}
