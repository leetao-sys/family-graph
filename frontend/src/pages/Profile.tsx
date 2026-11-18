import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { get, put } from "../api";
import { useAuth } from "../auth";
import PersonForm from "../components/PersonForm";
import RelationsTable from "../components/RelationsTable";
import { useReducedMotion, useTheme, type ThemePref } from "../theme";
import type { Person } from "../types";
import { Empty, ErrorState, ListSkeleton, PageHeading, useToast } from "../ui";
import { PasswordForm } from "./ChangePassword";

const TABS = [
  ["profile", "我的资料"],
  ["relations", "我的关系"],
  ["privacy", "隐私设置"],
  ["security", "账号安全"],
  ["display", "显示设置"],
] as const;

const PRIVACY_FIELDS: [string, string][] = [
  ["phone", "手机"],
  ["email", "邮箱"],
  ["residence", "现居地"],
  ["employer", "工作单位"],
  ["occupation", "职业"],
  ["birth_date", "完整出生日期"],
];
const SCOPES: [string, string][] = [
  ["all", "全体成员"],
  ["kin", "近亲（两步以内亲属）"],
  ["self", "仅本人与管理员"],
];

export default function Profile() {
  const { user, refresh } = useAuth();
  const params = useParams();
  const nav = useNavigate();
  const tab = (params["*"] || "profile") as (typeof TABS)[number][0];
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.person_id) return;
    get<Person>(`/api/persons/${user.person_id}`).then(setPerson).catch((e) => setError(e.message));
  }, [user?.person_id]);

  const needsPerson = tab === "profile" || tab === "relations" || tab === "privacy";

  return (
    <div className="page">
      <PageHeading mark="人" title="个人中心" sub="我的资料与显示设置" />
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => nav(`/me/${k === "profile" ? "" : k}`)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-body">
          {needsPerson && !user?.person_id ? (
            <Empty title="当前账号尚未绑定人物" hint="请联系管理员把你的账号与族谱中的人物绑定。" />
          ) : needsPerson && error ? (
            <ErrorState message={error} />
          ) : needsPerson && !person ? (
            <ListSkeleton />
          ) : tab === "profile" ? (
            <PersonForm
              person={person}
              onChange={setPerson}
              onSaved={(p) => {
                setPerson(p);
                refresh();
              }}
            />
          ) : tab === "relations" ? (
            user?.can_use_social ? (
              <div className="stack">
                <div className="alert info small">
                  你可以登记自己与他人的社会关系（朋友、同学、同事等），这些关系只有你自己和管理员能看到。族谱关系（父母、配偶、子女等）由管理员维护，如发现错误请联系管理员。
                </div>
                <h3>社会关系（仅自己可见）</h3>
                <RelationsTable person={person!} category="social" socialOnly allowAdd />
                <h3 style={{ marginTop: 8 }}>族谱关系</h3>
                <RelationsTable person={person!} category="kin" />
              </div>
            ) : (
              <div className="stack">
                <div className="alert info small">族谱关系（父母、配偶、子女等）由管理员维护，如发现错误请联系管理员。</div>
                <RelationsTable person={person!} category="kin" />
              </div>
            )
          ) : tab === "privacy" ? (
            <PrivacyForm person={person!} onSaved={setPerson} />
          ) : tab === "security" ? (
            <div className="stack">
              <div className="muted small">账号：{user?.username}</div>
              <PasswordForm />
            </div>
          ) : (
            <DisplaySettings />
          )}
        </div>
      </div>
    </div>
  );
}

function PrivacyForm({ person, onSaved }: { person: Person; onSaved: (p: Person) => void }) {
  const toast = useToast();
  const [privacy, setPrivacy] = useState<Record<string, string>>(person.privacy || {});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...person, privacy } as Record<string, unknown>;
      ["id", "name", "avatar", "avatar_large", "generation", "birth_year", "has_account", "can_edit", "hidden_fields"].forEach((k) => delete body[k]);
      const saved = await put<Person>(`/api/persons/${person.id}`, body);
      onSaved(saved);
      toast("success", "隐私设置已保存");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <div className="muted small">设置以下信息对谁可见。管理员始终可以查看全部信息。</div>
      {PRIVACY_FIELDS.map(([k, label]) => (
        <div key={k} className="row" style={{ justifyContent: "space-between" }}>
          <label htmlFor={`pv-${k}`}>{label}</label>
          <select id={`pv-${k}`} className="select" style={{ width: 220 }} value={privacy[k] || "all"} onChange={(e) => setPrivacy({ ...privacy, [k]: e.target.value })}>
            {SCOPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          保存
        </button>
      </div>
    </div>
  );
}

function DisplaySettings() {
  const [theme, setTheme] = useTheme();
  const [reduce, setReduce] = useReducedMotion();
  return (
    <div className="stack" style={{ maxWidth: 480 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>主题</span>
        <div className="segmented" role="group" aria-label="主题">
          {(
            [
              ["system", "跟随系统"],
              ["light", "浅色"],
              ["dark", "深色"],
            ] as [ThemePref, string][]
          ).map(([v, l]) => (
            <button key={v} aria-pressed={theme === v} onClick={() => setTheme(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
        减少动效（关闭展开、切换时的过渡动画）
      </label>
    </div>
  );
}
