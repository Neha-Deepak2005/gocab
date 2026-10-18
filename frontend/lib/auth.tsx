"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: Record<string, unknown>) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api<User>("/api/auth/me"));
    } catch (e: any) {
      if (e.status === 401) setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/api/auth/login", { method: "POST", json: { email, password } });
    setToken(res.access_token);
    setUser(res.user);
    return res.user;
  };
  const register = async (data: Record<string, unknown>) => {
    const res = await api<{ access_token: string; user: User }>("/api/auth/register", { method: "POST", json: data });
    setToken(res.access_token);
    setUser(res.user);
    return res.user;
  };
  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

/** Redirects to /login if signed out, or to the right home if the role doesn't match. */
export function useRequireAuth(role?: "rider" | "driver") {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (role && user.role !== role && user.role !== "admin") router.replace(user.role === "driver" ? "/driver" : "/ride");
  }, [user, loading, role, router]);
  return { user, ready: !loading && !!user && (!role || user.role === role || user.role === "admin") };
}

export const homeFor = (u: User) => (u.role === "driver" ? "/driver" : "/ride");
