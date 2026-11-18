import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarHeart,
  Calculator,
  GitFork,
  LogOut,
  Monitor,
  Moon,
  Network,
  ScrollText,
  Settings2,
  Sun,
  UserRound,
} from "lucide-react";
import { useAuth } from "../auth";
import { useTheme, type ThemePref } from "../theme";
import { Avatar, PersonPicker } from "../ui";
import BirthdayBell from "./BirthdayBell";
import Logo from "./Logo";

const THEME_ICON: Record<ThemePref, ReactNode> = {
  system: <Monitor size={17} />,
  light: <Sun size={17} />,
  dark: <Moon size={17} />,
};
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<ThemePref, string> = { system: "跟随系统", light: "纸色", dark: "墨夜" };

const PAGE_TITLES: [RegExp, string][] = [
  [/^\/network/, "人物关系"],
  [/^\/tree/, "族谱长卷"],
  [/^\/kinship/, "称呼考"],
  [/^\/articles/, "谱牒文章"],
  [/^\/persons/, "人物小传"],
  [/^\/me/, "个人中心"],
  [/^\/admin/, "谱务管理"],
];

function pageTitle(path: string) {
  for (const [re, title] of PAGE_TITLES) if (re.test(path)) return title;
  return "纸谱";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, siteName, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [theme, setTheme] = useTheme();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const links = [
    { to: "/network", icon: <Network size={18} />, label: "关系", full: "人物关系" },
    { to: "/tree", icon: <GitFork size={18} style={{ transform: "rotate(180deg)" }} />, label: "族谱", full: "族谱长卷" },
    { to: "/kinship", icon: <Calculator size={18} />, label: "称呼", full: "称呼考" },
    { to: "/articles", icon: <ScrollText size={18} />, label: "文章", full: "谱牒文章" },
    { to: "/me", icon: <UserRound size={18} />, label: "我的", full: "个人中心" },
    ...(user?.role === "admin"
      ? [{ to: "/admin", icon: <Settings2 size={18} />, label: "谱务", full: "谱务管理" }]
      : []),
  ];
  const title = pageTitle(loc.pathname);

  return (
    <div className="shell">
      <aside className="rail" aria-label="主导航">
        <NavLink to="/network" className="rail-brand" aria-label={siteName}>
          <Logo size={36} />
          <span className="brand-name">纸谱</span>
        </NavLink>
        <nav className="rail-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}
              title={l.full}
            >
              {l.icon}
              <span className="rail-label">{l.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <button
            className="icon-btn"
            onClick={() => setTheme(THEME_NEXT[theme])}
            title={`主题：${THEME_LABEL[theme]}（点击切换）`}
            aria-label={`切换主题，当前${THEME_LABEL[theme]}`}
          >
            {THEME_ICON[theme]}
          </button>
          <span className="seal ghost sm" aria-hidden="true">
            宣
          </span>
        </div>
      </aside>

      <div className="shell-main">
        <header className="band">
          <div className="band-left">
            <span className="band-kicker">纸谱</span>
            <span className="band-title">{siteName || "家族关系图谱"}</span>
            <span className="band-sub">/ {title}</span>
          </div>
          <div className="band-search">
            <PersonPicker
              placeholder="寻人 · 姓名 / 字 / 号 / 曾用名"
              ariaLabel="全局搜索人物"
              clearOnSelect
              onChange={(p) => p && nav(`/network?center=${p.id}`)}
            />
          </div>
          <div className="band-actions">
            {user && (
              <span className="hide-mobile">
                <BirthdayBell userId={user.id} />
              </span>
            )}
            <button
              className="icon-btn hide-mobile"
              onClick={() => setTheme(THEME_NEXT[theme])}
              title={`主题：${THEME_LABEL[theme]}`}
              aria-label={`切换主题，当前${THEME_LABEL[theme]}`}
            >
              {THEME_ICON[theme]}
            </button>
            <span className="band-sep hide-mobile" />
            <div style={{ position: "relative" }} ref={menuRef}>
              <button
                className="icon-btn keep-mobile"
                onClick={() => setMenu((m) => !m)}
                aria-label="账号菜单"
                aria-expanded={menu}
                style={{ width: 38, height: 38 }}
              >
                {user?.person ? <Avatar person={user.person} size={30} /> : <UserRound size={21} />}
              </button>
              {menu && (
                <div className="account-menu" style={{ right: 0 }}>
                  <div className="who">
                    <div className="name">{user?.person?.name || user?.username}</div>
                    <div className="muted small">
                      {user?.username} · {user?.role === "admin" ? "谱务管理员" : "家族成员"}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMenu(false);
                      nav("/me");
                    }}
                  >
                    <UserRound size={15} /> 个人中心
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      nav(user?.person_id ? `/network?center=${user.person_id}` : "/network");
                    }}
                  >
                    <CalendarHeart size={15} /> {user?.person_id ? "我的谱心" : "谱系桌面"}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      logout();
                    }}
                  >
                    <LogOut size={15} /> 退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="底部导航">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {l.icon}
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
