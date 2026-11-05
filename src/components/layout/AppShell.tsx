import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell, BriefcaseBusiness, Building2, CalendarDays, ChevronRight, CircleDollarSign, FileSignature, FileText, FolderKanban,
  Image, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Palette, Search, Settings, Sparkles, Sun, Users, X,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, cn, IconButton } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { roleLabel, type Permission } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { CommandPalette } from "./CommandPalette";

/* ---------------------------------------------------------------- Tema */
type Theme = "light" | "dark" | "system";
function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem("nexo-theme") as Theme) || "system"; } catch { return "system"; } });
  useEffect(() => { applyTheme(theme); try { localStorage.setItem("nexo-theme", theme); } catch { /* */ } }, [theme]);
  return { theme, toggle: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark") };
}

/* ------------------------------------------------------- Breadcrumbs */
type Crumb = { label: string; to?: string };
const CrumbCtx = createContext<(c: Crumb[]) => void>(() => {});
export function useBreadcrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { set(crumbs); }, [key, set]);
}

/* ----------------------------------------------------------- Navegação */
// Módulos das fases seguintes aparecem desabilitados e identificados, nunca como botões falsos.
type NavItem = { label: string; to?: string; icon: LucideIcon; perm?: Permission; phase?: number };
const nav: { section: string; items: NavItem[] }[] = [
  { section: "Geral", items: [
    { label: "Dashboard", to: "/", icon: LayoutDashboard, perm: "dashboard.view" },
    { label: "Minhas tarefas", to: "/tarefas", icon: ListChecks },
    { label: "Calendário", icon: CalendarDays, phase: 3 },
  ] },
  { section: "Operação", items: [
    { label: "Clientes", to: "/clientes", icon: Building2, perm: "clients.read" },
    { label: "Projetos", to: "/projetos", icon: FolderKanban },
    { label: "CRM", icon: BriefcaseBusiness, perm: "crm.read", phase: 2 },
    { label: "Propostas", icon: FileText, perm: "proposals.read", phase: 2 },
    { label: "Contratos", icon: FileSignature, perm: "contracts.read", phase: 2 },
    { label: "Financeiro", icon: CircleDollarSign, perm: "finance.read", phase: 3 },
  ] },
  { section: "Criação", items: [
    { label: "Branding e naming", icon: Palette, phase: 4 },
    { label: "Social media", icon: Image, phase: 4 },
    { label: "Assistente IA", icon: Sparkles, perm: "ai.use", phase: 5 },
  ] },
  { section: "Estúdio", items: [
    { label: "Equipe", to: "/equipe", icon: Users, perm: "team.read" },
    { label: "Configurações", to: "/configuracoes", icon: Settings, perm: "settings.manage" },
  ] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { membership, can, context, switchOrg } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className="flex h-14 items-center px-4">
        <Link to="/" onClick={onNavigate} className="text-[15px] font-semibold tracking-tight text-white">NEXO <span className="font-normal text-white/50">Studio OS</span></Link>
      </div>
      {(context?.memberships.length ?? 0) > 1 ? (
        <select aria-label="Estúdio" value={membership?.organization_id} onChange={(e) => switchOrg(e.target.value)}
          className="mx-3 mb-3 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white">
          {context!.memberships.map((m) => <option key={m.organization_id} value={m.organization_id} className="text-black">{m.organization_name}</option>)}
        </select>
      ) : (
        <div className="mx-4 mb-3 truncate text-xs text-white/50">{membership?.organization_name}</div>
      )}
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4 scrollbar-thin" aria-label="Principal">
        {nav.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.section}>
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-white/35">{g.section}</p>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const active = i.to && (i.to === "/" ? path === "/" : path.startsWith(i.to));
                  const Icon = i.icon;
                  if (!i.to) {
                    return (
                      <li key={i.label}>
                        <span aria-disabled="true" title={`Disponível na Fase ${i.phase}`}
                          className="flex h-8 cursor-not-allowed items-center gap-2.5 rounded-md px-2 text-[13px] text-white/30">
                          <Icon className="size-4" />{i.label}<span className="ml-auto rounded bg-white/5 px-1.5 text-[10px]">Fase {i.phase}</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={i.label}>
                      <Link to={i.to} onClick={onNavigate}
                        className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                          active ? "bg-[var(--sidebar-active)] text-white" : "hover:bg-[var(--sidebar-hover)] hover:text-white")}>
                        <Icon className={cn("size-4", active && "text-brand")} />{i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3 text-[11px] text-white/40">{membership && roleLabel[membership.role]}{membership?.job_title ? ` · ${membership.job_title}` : ""}</div>
    </div>
  );
}

/* -------------------------------------------------------- Notificações */
function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data as { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }[];
    },
    refetchInterval: 60_000,
  });
  const unread = data.filter((n) => !n.read_at).length;
  const markAll = async () => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <div className="relative">
      <IconButton label={unread ? `Notificações (${unread} não lidas)` : "Notificações"} onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" />}
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-lg border border-border bg-surface shadow-md animate-pop">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-sm font-medium">Notificações</p>
              <button onClick={markAll} disabled={!unread} className="text-xs text-accent disabled:text-fg-3">Marcar todas como lidas</button>
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {data.length === 0 && <li className="px-4 py-8 text-center text-xs text-fg-3">Nenhuma notificação.</li>}
              {data.map((n) => (
                <li key={n.id}>
                  <button className={cn("w-full px-3 py-2.5 text-left hover:bg-surface-2", !n.read_at && "bg-accent-soft/40")}
                    onClick={async () => {
                      setOpen(false);
                      if (!n.read_at) { await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id); qc.invalidateQueries({ queryKey: ["notifications"] }); }
                      if (n.link) nav({ to: n.link });
                    }}>
                    <p className="text-sm">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-fg-3">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-fg-3">{dateTime(n.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: profile } = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: async () => (await supabase.from("profiles").select("full_name").eq("id", session!.user.id).single()).data,
    enabled: !!session,
  });
  const name = profile?.full_name || session?.user.email;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md p-1 hover:bg-surface-2" aria-label="Conta">
        <Avatar name={name} size={26} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-60 rounded-lg border border-border bg-surface p-1 shadow-md animate-pop">
            <div className="px-2.5 py-2"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-fg-3">{session?.user.email}</p></div>
            <div className="my-1 h-px bg-border" />
            <Link to="/sair" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg"><LogOut className="size-4" />Sair</Link>
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Shell */
export function AppShell({ children }: { children?: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { toggle } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isMac = useMemo(() => /Mac|iPhone|iPad/.test(navigator.platform), []);

  return (
    <CrumbCtx.Provider value={setCrumbs}>
      <div className="flex h-dvh overflow-hidden">
        <aside className="hidden w-60 shrink-0 lg:block"><Sidebar /></aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-navy/50 animate-in" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 shadow-lg animate-in"><Sidebar onNavigate={() => setMobileOpen(false)} />
              <IconButton label="Fechar menu" className="absolute top-3 right-2 text-white/70 hover:bg-white/10" onClick={() => setMobileOpen(false)}><X className="size-4" /></IconButton>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur sm:px-5">
            <IconButton label="Abrir menu" className="lg:hidden" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></IconButton>
            <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1 text-sm">
              {crumbs.map((c, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-3" />}
                  {c.to && i < crumbs.length - 1
                    ? <Link to={c.to} className="truncate text-fg-3 hover:text-fg">{c.label}</Link>
                    : <span className="truncate font-medium">{c.label}</span>}
                </span>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setPaletteOpen(true)}
                className="hidden h-8 w-72 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface-2 px-2.5 text-xs text-fg-3 hover:border-border-strong md:flex">
                <Search className="size-3.5 shrink-0" /><span className="truncate">Buscar clientes, projetos, tarefas…</span>
                <kbd className="ml-auto rounded border border-border bg-surface px-1 font-mono text-[10px]">{isMac ? "⌘" : "Ctrl"} K</kbd>
              </button>
              <IconButton label="Buscar" className="md:hidden" onClick={() => setPaletteOpen(true)}><Search className="size-4" /></IconButton>
              <IconButton label="Alternar tema claro/escuro" onClick={toggle}>
                <Sun className="hidden size-4 dark:block" /><Moon className="size-4 dark:hidden" />
              </IconButton>
              <Notifications />
              <UserMenu />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children ?? <Outlet />}</div>
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </CrumbCtx.Provider>
  );
}
