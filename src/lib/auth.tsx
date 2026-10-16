import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  enter: (name: string) => Promise<void>;
  rename: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function cleanName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, 24);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setProfile({ id: userId, display_name: session?.user.user_metadata?.full_name ?? "Jogador", avatar_url: null });
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => data && setProfile(data));
  }, [userId]);

  const value: AuthState = {
    session,
    profile,
    loading,
    async enter(name) {
      const display = cleanName(name);
      if (!display) throw new Error("Escolha um apelido.");
      const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: display } } });
      if (error) {
        if (/anonymous/i.test(error.message)) throw new Error("A entrada sem login ainda não foi ativada no Supabase (Allow anonymous sign-ins).");
        throw error;
      }
    },
    async rename(name) {
      const display = cleanName(name);
      if (!display || !userId) return;
      const { error } = await supabase.from("profiles").update({ display_name: display }).eq("id", userId);
      if (error) throw error;
      setProfile((p) => (p ? { ...p, display_name: display } : p));
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
