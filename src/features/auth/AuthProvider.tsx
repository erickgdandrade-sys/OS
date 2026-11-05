import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, supabaseConfigMissing } from "@/lib/supabase";
import type { Membership, Permission, SessionContext } from "@/lib/domain";

interface AuthState {
  status: "loading" | "signed_out" | "ready";
  session: Session | null;
  context: SessionContext | null;
  /** Organização ativa (membros da equipe). */
  membership: Membership | null;
  orgId: string | null;
  isClient: boolean;
  can: (p: Permission) => boolean;
  refresh: () => Promise<void>;
  switchOrg: (orgId: string) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const ORG_KEY = "nexo-active-org";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [activeOrg, setActiveOrg] = useState<string | null>(() => {
    try { return localStorage.getItem(ORG_KEY); } catch { return null; }
  });

  const loadContext = useCallback(async (s: Session | null) => {
    if (!s) { setContext(null); setStatus("signed_out"); return; }
    const { data, error } = await supabase.rpc("session_context");
    if (error) { console.error(error); setContext(null); setStatus("ready"); return; }
    setContext(data as SessionContext);
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (supabaseConfigMissing) { setStatus("signed_out"); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadContext(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Evita chamar o Supabase dentro do callback (deadlock conhecido do SDK).
        setTimeout(() => loadContext(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadContext]);

  const membership = useMemo(() => {
    const ms = context?.memberships ?? [];
    return ms.find((m) => m.organization_id === activeOrg) ?? ms[0] ?? null;
  }, [context, activeOrg]);

  const value = useMemo<AuthState>(() => ({
    status, session, context, membership,
    orgId: membership?.organization_id ?? null,
    isClient: !membership && (context?.client_accounts.length ?? 0) > 0,
    can: (p) => !!membership && (membership.role === "admin" || membership.permissions.includes(p)),
    refresh: () => loadContext(session),
    switchOrg: (id) => { setActiveOrg(id); try { localStorage.setItem(ORG_KEY, id); } catch { /* sem storage */ } },
    signOut: async () => {
      await supabase.rpc("log_auth_event", { p_action: "logout" });
      await supabase.auth.signOut();
    },
  }), [status, session, context, membership, loadContext]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fora do AuthProvider");
  return v;
}

/** Garante orgId (usado em páginas protegidas, que só renderizam com membro). */
export function useOrg() {
  const a = useAuth();
  if (!a.orgId || !a.membership) throw new Error("Sem organização ativa");
  return { orgId: a.orgId, membership: a.membership, can: a.can, userId: a.session!.user.id };
}
