import { createRootRoute, createRoute, createRouter, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { FirstAccessPage, ForgotPasswordPage, LoginPage, SetPasswordPage, SignedOutPage } from "@/features/auth/AuthPages";
import { ClientDetailPage, ClientsPage } from "@/features/clients/ClientsPages";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { PortalHome, PortalLinkPage } from "@/features/portal/PortalPages";
import { ProjectDetailPage } from "@/features/projects/ProjectDetailPage";
import { ProjectsPage } from "@/features/projects/ProjectsPages";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { MyTasksPage } from "@/features/tasks/MyTasksPage";
import { TeamPage } from "@/features/team/TeamPage";
import type { Permission } from "@/lib/domain";

function FullScreenLoading() {
  return <div className="flex h-dvh items-center justify-center"><Spinner label="Carregando sua sessão" /></div>;
}

/** Área interna: exige sessão e associação ativa a um estúdio. */
function ProtectedLayout() {
  const { status, session, membership, isClient } = useAuth();
  // Só o pathname da rota pedida (nunca o href atual, que já pode conter ?redirect=… e gerar laço).
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (status === "loading") return <FullScreenLoading />;
  if (!session) return <Navigate to="/login" search={{ redirect: path === "/" || path.startsWith("/login") ? undefined : path }} replace />;
  if (isClient) return <Navigate to="/portal" replace />;
  if (!membership) return <Navigate to="/primeiro-acesso" replace />;
  return <AppShell><Outlet /></AppShell>;
}

/** Bloqueio por permissão (a proteção real está no banco; isto evita telas vazias). */
function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState icon={<Lock className="size-5" />} title="Sem acesso a este módulo" description="Peça a um administrador para liberar esta permissão." />;
  return <>{children}</>;
}

function PortalGuard() {
  const { status, session, isClient, membership } = useAuth();
  if (status === "loading") return <FullScreenLoading />;
  if (!session) return <Navigate to="/login" search={{ redirect: "/portal" }} replace />;
  if (!isClient) return <Navigate to={membership ? "/" : "/primeiro-acesso"} replace />;
  return <PortalHome />;
}

function FirstAccessGuard() {
  const { status, session, membership, isClient } = useAuth();
  if (status === "loading") return <FullScreenLoading />;
  if (!session) return <Navigate to="/login" replace />;
  if (membership) return <Navigate to="/" replace />;
  if (isClient) return <Navigate to="/portal" replace />;
  return <FirstAccessPage />;
}

const root = createRootRoute({ component: () => <Outlet />, notFoundComponent: () => (
  <div className="flex h-dvh items-center justify-center p-6"><EmptyState title="Página não encontrada" description="O endereço não existe ou foi movido." /></div>) });

const login = createRoute({ getParentRoute: () => root, path: "/login", validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
  component: function Login() { const { redirect } = login.useSearch(); return <LoginPage redirect={redirect} />; } });
const forgot = createRoute({ getParentRoute: () => root, path: "/recuperar-senha", component: ForgotPasswordPage });
const reset = createRoute({ getParentRoute: () => root, path: "/redefinir-senha", component: () => <SetPasswordPage mode="reset" /> });
const invite = createRoute({ getParentRoute: () => root, path: "/convite", component: () => <SetPasswordPage mode="invite" /> });
const signout = createRoute({ getParentRoute: () => root, path: "/sair", component: SignedOutPage });
const firstAccess = createRoute({ getParentRoute: () => root, path: "/primeiro-acesso", component: FirstAccessGuard });
const portal = createRoute({ getParentRoute: () => root, path: "/portal", component: PortalGuard });
const portalLink = createRoute({ getParentRoute: () => root, path: "/p", component: PortalLinkPage });

const app = createRoute({ getParentRoute: () => root, id: "app", component: ProtectedLayout });
const dashboard = createRoute({ getParentRoute: () => app, path: "/", component: () => <RequirePerm perm="dashboard.view"><DashboardPage /></RequirePerm> });
const myTasks = createRoute({ getParentRoute: () => app, path: "/tarefas", component: MyTasksPage });
const clients = createRoute({ getParentRoute: () => app, path: "/clientes", component: () => <RequirePerm perm="clients.read"><ClientsPage /></RequirePerm> });
const client = createRoute({ getParentRoute: () => app, path: "/clientes/$clientId",
  component: function C() { const { clientId } = client.useParams(); return <RequirePerm perm="clients.read"><ClientDetailPage key={clientId} clientId={clientId} /></RequirePerm>; } });
const projects = createRoute({ getParentRoute: () => app, path: "/projetos", component: ProjectsPage });
const project = createRoute({ getParentRoute: () => app, path: "/projetos/$projectId",
  component: function P() { const { projectId } = project.useParams(); return <ProjectDetailPage key={projectId} projectId={projectId} />; } });
const team = createRoute({ getParentRoute: () => app, path: "/equipe", component: () => <RequirePerm perm="team.read"><TeamPage /></RequirePerm> });
const settings = createRoute({ getParentRoute: () => app, path: "/configuracoes", component: () => <RequirePerm perm="settings.manage"><SettingsPage /></RequirePerm> });

const routeTree = root.addChildren([
  login, forgot, reset, invite, signout, firstAccess, portal, portalLink,
  app.addChildren([dashboard, myTasks, clients, client, projects, project, team, settings]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });
