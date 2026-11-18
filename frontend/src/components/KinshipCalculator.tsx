import { useEffect, useState } from "react";
import { ArrowLeftRight, MousePointerClick } from "lucide-react";
import { get, qs } from "../api";
import { useAuth } from "../auth";
import type { KinPath, KinResult, PersonBrief } from "../types";
import { Avatar, PersonPicker } from "../ui";

interface Result {
  a: PersonBrief;
  b: PersonBrief;
  a_to_b: KinResult;
  b_to_a: KinResult;
}

function Chain({ path }: { path: KinPath }) {
  return (
    <div className="chainline" aria-label={`推导链路：${path.description}`}>
      {path.steps.map((s, i) => (
        <span key={`${s.id}-${i}`} className="row" style={{ gap: 4 }}>
          {i > 0 && <span className="muted">→</span>}
          <span className="step">
            {s.name}
            <small>{i === 0 ? "起点" : `的${s.label}`}</small>
          </span>
        </span>
      ))}
    </div>
  );
}

function Direction({ from, to, r, meId }: { from: PersonBrief; to: PersonBrief; r: KinResult; meId: number | null }) {
  const isMe = from.id === meId;
  const toIsMe = to.id === meId;
  if (!r.found)
    return (
      <div className="calc-result" style={{ background: "var(--surface-2)" }}>
        <div className="muted">{r.reason || "暂无亲属关系或关系过远"}</div>
      </div>
    );
  const [main, ...others] = r.paths;
  return (
    <div className="calc-result stack" style={{ gap: 8 }}>
      <div className="small" style={{ color: "var(--text-2)" }}>
        {isMe ? `你应称呼 ${to.name} 为` : toIsMe ? `${from.name} 称呼你为` : `${from.name} 称呼 ${to.name} 为`}
      </div>
      <div className="calc-term">{r.term}</div>
      {main && (
        <>
          <div className="small muted">推导：{main.description}</div>
          <Chain path={main} />
        </>
      )}
      {others.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>
            另有 {others.length} 条亲属路径
          </summary>
          <div className="stack" style={{ marginTop: 8, gap: 8 }}>
            {others.map((p, i) => (
              <div key={i} className="stack" style={{ gap: 4 }}>
                <div className="small">
                  也可称 <strong>{p.term}</strong>（{p.description}）
                </div>
                <Chain path={p} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** 称呼计算器：选择 A、B 两人，显示双向称谓与推导链路。 */
export default function KinshipCalculator({
  a,
  b,
  onChange,
  pickMode,
  onPickMode,
  onPath,
}: {
  a: PersonBrief | null;
  b: PersonBrief | null;
  onChange: (a: PersonBrief | null, b: PersonBrief | null) => void;
  pickMode?: boolean;
  onPickMode?: (v: boolean) => void;
  onPath?: (ids: number[]) => void;
}) {
  const { user } = useAuth();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResult(null);
    setError("");
    if (!a || !b || a.id === b.id) {
      onPath?.([]);
      return;
    }
    let alive = true;
    setBusy(true);
    get<Result>(`/api/kinship?${qs({ a: a.id, b: b.id })}`)
      .then((r) => {
        if (!alive) return;
        setResult(r);
        onPath?.(r.a_to_b.paths[0]?.steps.map((s) => s.id) || []);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, b?.id]);

  return (
    <div className="calc">
      <div className="stack" style={{ gap: 8 }}>
        <div className="field">
          <label>人物 A</label>
          <PersonPicker value={a} onChange={(p) => onChange(p, b)} placeholder="搜索或在图中点选" ariaLabel="选择人物 A" />
        </div>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(b, a)} disabled={!a && !b} title="交换 A、B">
            <ArrowLeftRight size={14} /> 交换
          </button>
          {user?.person && (
            <button className="btn btn-sm btn-ghost" onClick={() => onChange(user.person, b)}>
              A 设为我
            </button>
          )}
          {onPickMode && (
            <button
              className={`btn btn-sm ${pickMode ? "btn-primary" : "btn-ghost"}`}
              onClick={() => onPickMode(!pickMode)}
              aria-pressed={pickMode}
              title="开启后，依次点击族谱中的两个人物"
            >
              <MousePointerClick size={14} /> 图中点选
            </button>
          )}
        </div>
        <div className="field">
          <label>人物 B</label>
          <PersonPicker value={b} onChange={(p) => onChange(a, p)} placeholder="搜索或在图中点选" ariaLabel="选择人物 B" />
        </div>
      </div>
      {pickMode && <div className="alert info small">请在族谱中依次点击人物 A 和人物 B</div>}
      {a && b && a.id === b.id && <div className="alert warning small">请选择两个不同的人物</div>}
      {busy && <div className="muted small">计算中…</div>}
      {error && <div className="alert danger small">{error}</div>}
      {result && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="row">
              <Avatar person={result.a} size={28} /> {result.a.name}
            </span>
            <ArrowLeftRight size={16} className="muted" />
            <span className="row">
              {result.b.name} <Avatar person={result.b} size={28} />
            </span>
          </div>
          <Direction from={result.a} to={result.b} r={result.a_to_b} meId={user?.person_id ?? null} />
          <Direction from={result.b} to={result.a} r={result.b_to_a} meId={user?.person_id ?? null} />
        </>
      )}
      {!a && !b && <div className="muted small">选择两位人物后，自动计算“A 称呼 B”与“B 称呼 A”的亲属称谓，并展示推导链路。</div>}
    </div>
  );
}
