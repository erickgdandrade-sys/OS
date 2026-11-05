/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Spinner } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { FirstAccessPage, ForgotPasswordPage, LoginPage, SetPasswordPage, SignedOutPage } from "@/features/auth/AuthPages";
// Páginas carregadas sob demanda (divisão do bundle por rota).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const ClientsPage = page(() => import("@/features/clients/ClientsPages"), "ClientsPage");
const ClientDetailPage = page(() => import("@/features/clients/ClientsPages"), "ClientDetailPage");
const DashboardPage = page(() => import("@/features/dashboard/DashboardPage"), "DashboardPage");
const PortalHome = page(() => import("@/features/portal/PortalPages"), "PortalHome");
const PortalLinkPage = page(() => import("@/features/portal/PortalPages"), "PortalLinkPage");
const ProjectDetailPage = page(() => import("@/features/projects/ProjectDetailPage"), "ProjectDetailPage");
const ProjectsPage = page(() => import("@/features/projects/ProjectsPages"), "ProjectsPage");
const SettingsPage = page(() => import("@/features/settings/SettingsPage"), "SettingsPage");
const MyTasksPage = page(() => import("@/features/tasks/MyTasksPage"), "MyTasksPage");
const TeamPage = page(() => import("@/features/team/TeamPage"), "TeamPage");
const PublicProposalPage = page(() => import("@/features/commercial/PublicProposalPage"), "PublicProposalPage");
const CrmPage = page(() => import("@/features/crm/CrmPage"), "CrmPage");
const ProposalsPage = page(() => import("@/features/commercial/ProposalsPages"), "ProposalsPage");
const ProposalEditorPage = page(() => import("@/features/commercial/ProposalsPages"), "ProposalEditorPage");
const ProposalPrintPage = page(() => import("@/features/commercial/ProposalsPages"), "ProposalPrintPage");
const ContractsPage = page(() => import("@/features/commercial/ContractsPages"), "ContractsPage");
const ContractDetailPage = page(() => import("@/features/commercial/ContractsPages"), "ContractDetailPage");
const ContractPrintPage = page(() => import("@/features/commercial/ContractsPages"), "ContractPrintPage");
const FinancePage = page(() => import("@/features/finance/FinancePage"), "FinancePage");
const CalendarPage = page(() => import("@/features/calendar/CalendarPage"), "CalendarPage");
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
  return <AppShell><Suspense fallback={<Spinner />}><Outlet /></Suspense></AppShell>;
}

/** Bloqueio por permissão (a proteção real está no banco; isto evita telas vazias). */
function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState icon={<Lock className="size-5" />} title="Sem acesso a este módulo" description="Peça a um administrador para liberar esta permissão." />;
  return <>{children}</>;
}

/** Páginas internas sem o shell (impressão/PDF). */
function BareProtected() {
  const { status, session, membership } = useAuth();
  if (status === "loading") return <FullScreenLoading />;
  if (!session || !membership) return <Navigate to="/login" replace />;
  return <Suspense fallback={<Spinner />}><Outlet /></Suspense>;
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

const root = createRootRoute({ component: () => <Suspense fallback={<FullScreenLoading />}><Outlet /></Suspense>, notFoundComponent: () => (
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
const publicProposal = createRoute({ getParentRoute: () => root, path: "/proposta", component: PublicProposalPage });

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

const crm = createRoute({ getParentRoute: () => app, path: "/crm", component: () => <RequirePerm perm="crm.read"><CrmPage /></RequirePerm> });
const proposals = createRoute({ getParentRoute: () => app, path: "/propostas",
  validateSearch: (s: Record<string, unknown>) => ({ nova: typeof s.nova === "string" ? s.nova : undefined, oportunidade: typeof s.oportunidade === "string" ? s.oportunidade : undefined }),
  component: function Pr() { const s = proposals.useSearch(); return <RequirePerm perm="proposals.read"><ProposalsPage newFor={s.nova} opportunity={s.oportunidade} /></RequirePerm>; } });
const proposal = createRoute({ getParentRoute: () => app, path: "/propostas/$proposalId",
  component: function P1() { const { proposalId } = proposal.useParams(); return <RequirePerm perm="proposals.read"><ProposalEditorPage key={proposalId} proposalId={proposalId} /></RequirePerm>; } });
const contracts = createRoute({ getParentRoute: () => app, path: "/contratos", component: () => <RequirePerm perm="contracts.read"><ContractsPage /></RequirePerm> });
const contract = createRoute({ getParentRoute: () => app, path: "/contratos/$contractId",
  component: function C1() { const { contractId } = contract.useParams(); return <RequirePerm perm="contracts.read"><ContractDetailPage key={contractId} contractId={contractId} /></RequirePerm>; } });
const bare = createRoute({ getParentRoute: () => root, id: "bare", component: BareProtected });
const proposalPrint = createRoute({ getParentRoute: () => bare, path: "/propostas/$proposalId/imprimir",
  component: function PP() { const { proposalId } = proposalPrint.useParams(); return <ProposalPrintPage proposalId={proposalId} />; } });
const contractPrint = createRoute({ getParentRoute: () => bare, path: "/contratos/$contractId/imprimir",
  validateSearch: (s: Record<string, unknown>) => ({ v: s.v ? Number(s.v) : undefined }),
  component: function CP() { const { contractId } = contractPrint.useParams(); const { v } = contractPrint.useSearch(); return <ContractPrintPage contractId={contractId} version={v} />; } });

const finance = createRoute({ getParentRoute: () => app, path: "/financeiro", component: () => <RequirePerm perm="finance.read"><FinancePage /></RequirePerm> });
const calendar = createRoute({ getParentRoute: () => app, path: "/calendario", component: CalendarPage });

const routeTree = root.addChildren([
  login, forgot, reset, invite, signout, firstAccess, portal, portalLink, publicProposal,
  app.addChildren([dashboard, myTasks, clients, client, projects, project, team, settings, crm, proposals, proposal, contracts, contract, finance, calendar]),
  bare.addChildren([proposalPrint, contractPrint]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });
