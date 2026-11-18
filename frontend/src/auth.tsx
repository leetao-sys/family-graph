import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, onUnauthorized, post } from "./api";
import type { RelationType, User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  siteName: string;
  types: RelationType[];
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
  reloadTypes: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteName, setSiteName] = useState("家族关系图谱");
  const [types, setTypes] = useState<RelationType[]>([]);

  const refresh = useCallback(async () => {
    try {
      setUser(await get<User>("/api/auth/me"));
    } catch (e) {
      // 服务暂不可用时稍后重试，而不是把用户踢回登录页
      if ((e as { status?: number }).status !== 401) {
        setTimeout(() => refresh(), 2000);
        return;
      }
      setUser(null);
    }
    setLoading(false);
  }, []);

  const reloadTypes = useCallback(async () => {
    setTypes(await get<RelationType[]>("/api/relation-types"));
  }, []);

  useEffect(() => {
    refresh();
    get<{ site_name: string }>("/api/public/settings")
      .then((s) => setSiteName(s.site_name))
      .catch(() => {});
    return onUnauthorized(() => setUser(null));
  }, [refresh]);

  useEffect(() => {
    document.title = siteName;
  }, [siteName]);

  useEffect(() => {
    if (user && !user.must_change_password) reloadTypes().catch(() => {});
  }, [user, reloadTypes]);

  const logout = useCallback(async () => {
    await post("/api/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, siteName, types, setUser, refresh, reloadTypes, logout }}>
      {children}
    </Ctx.Provider>
  );
}
