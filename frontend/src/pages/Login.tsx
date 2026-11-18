import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, UserRound } from "lucide-react";
import { post } from "../api";
import { useAuth } from "../auth";
import type { User } from "../types";
import Logo from "../components/Logo";

export default function Login() {
  const { setUser, siteName } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const u = await post<User>("/api/auth/login", { username: username.trim(), password });
      setUser(u);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== "/login" ? from : "/network", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <section className="login-art" aria-hidden="true">
        <div className="login-art-head">
          <Logo size={64} />
          <div>
            <div className="login-art-kicker">FAMILY ATLAS · 纸谱</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 13, letterSpacing: ".2em", marginTop: 3 }}>
              一纸谱系 · 千年血脉
            </div>
          </div>
        </div>

        <div className="login-art-body">
          <div className="login-vertical-title">{(siteName || "家族关系图谱").slice(0, 6)}</div>
          <div className="login-poem">
            <div className="line">木有本，水有源；</div>
            <div className="line">人有祖，族有谱。</div>
            <div className="note">
              以人物为中心，循着墨线展开亲缘。
              <br />
              拖动画布，去往更远的分支；
              <br />
              每一次停驻，都是一次认祖归宗。
            </div>
            <div className="login-stat">
              <div>
                <b>一</b>
                <span>谱</span>
              </div>
              <div>
                <b>世</b>
                <span>系</span>
              </div>
              <div>
                <b>∞</b>
                <span>亲缘</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-art-foot">纸谱 · 家族关系图谱系统</div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="kicker">族内登录</div>
          <h1>入谱</h1>
          <p className="lead">
            家族内部使用，请使用管理员分配的账号登录。
            <br />
            本谱数据仅对族内成员开放。
          </p>
          <form className="login-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="username">用户名</label>
              <div className="picker-input">
                <UserRound size={16} />
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入账号"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">密码</label>
              <div className="picker-input">
                <KeyRound size={16} />
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                />
              </div>
            </div>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary btn-block login-submit" disabled={busy}>
              {busy ? "正在核验…" : "登 录"}
            </button>
          </form>
          <div className="login-meta">
            <span>家族内部系统</span>
            <span>v1.0 · 纸谱</span>
          </div>
        </div>
      </section>
    </div>
  );
}
