import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { post } from "../api";
import { useAuth } from "../auth";
import type { User } from "../types";
import { Seal, useToast } from "../ui";

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [oldPw, setOldPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setError("新密码至少 8 位");
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setError("新密码需同时包含字母和数字");
    if (pw !== pw2) return setError("两次输入的新密码不一致");
    setBusy(true);
    setError("");
    try {
      const u = await post<User>("/api/auth/change-password", { old_password: oldPw, new_password: pw });
      toast("success", "密码已修改");
      setUser(u);
      setOldPw("");
      setPw("");
      setPw2("");
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 380 }}>
      <div className="field">
        <label htmlFor="old-pw">当前密码</label>
        <input
          id="old-pw"
          type="password"
          className="input"
          autoComplete="current-password"
          value={oldPw}
          onChange={(e) => setOldPw(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-pw">新密码</label>
        <input
          id="new-pw"
          type="password"
          className="input"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <span className="muted small">至少 8 位，需包含字母和数字</span>
      </div>
      <div className="field">
        <label htmlFor="new-pw2">确认新密码</label>
        <input
          id="new-pw2"
          type="password"
          className="input"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </div>
      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}
      <div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "提交中…" : "修改密码"}
        </button>
      </div>
    </form>
  );
}

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { logout } = useAuth();
  return (
    <div className="center-page">
      <div className="center-card">
        <div className="center-card-head">
          <Seal char="密" size={38} />
          <div>
            <div className="kicker">账号安全</div>
            <h1>设置新密码</h1>
          </div>
        </div>
        {forced && <div className="alert info">首次登录或密码被重置后，需要先修改初始密码。</div>}
        <div className="center-card-body">
          <PasswordForm />
        </div>
        <div className="center-card-foot">
          <KeyRound size={14} />
          <span className="muted small">修改后旧会话会立即失效，需要使用新密码重新登录其他设备。</span>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={logout}>
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
