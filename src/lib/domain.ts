// Tipos de domínio e rótulos em português, espelhando os enums do banco.
export type OrgRole = "admin" | "manager" | "member" | "finance" | "external";
export type ProjectStatus = "planning" | "active" | "on_hold" | "review" | "completed" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "review" | "blocked" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";
export type ClientStatus = "lead" | "active" | "inactive";
export type ProjectCategory =
  | "branding" | "naming" | "graphic_design" | "art_direction" | "photography" | "audiovisual"
  | "social_media" | "digital_marketing" | "campaign" | "website" | "landing_page"
  | "institutional" | "consulting" | "other";

export const roleLabel: Record<OrgRole, string> = {
  admin: "Administrador", manager: "Gestor", member: "Colaborador", finance: "Financeiro", external: "Colaborador externo",
};
export const jobTitles = ["Diretor(a) criativo(a)", "Designer", "Fotógrafo(a)", "Videomaker", "Social media", "Redator(a)", "Atendimento", "Financeiro", "Desenvolvedor(a)"];

export const projectStatusLabel: Record<ProjectStatus, string> = {
  planning: "Planejamento", active: "Em andamento", on_hold: "Pausado", review: "Em revisão", completed: "Concluído", cancelled: "Cancelado",
};
export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: "A fazer", in_progress: "Fazendo", review: "Revisão", blocked: "Bloqueada", done: "Concluída",
};
export const taskStatusOrder: TaskStatus[] = ["todo", "in_progress", "review", "blocked", "done"];
export const priorityLabel: Record<Priority, string> = { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" };
export const clientStatusLabel: Record<ClientStatus, string> = { lead: "Lead", active: "Ativo", inactive: "Inativo" };
export const categoryLabel: Record<ProjectCategory, string> = {
  branding: "Branding", naming: "Naming", graphic_design: "Design gráfico", art_direction: "Direção de arte",
  photography: "Fotografia", audiovisual: "Audiovisual", social_media: "Social media", digital_marketing: "Marketing digital",
  campaign: "Campanha", website: "Website", landing_page: "Landing page", institutional: "Materiais institucionais",
  consulting: "Consultoria", other: "Outro",
};

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export const projectStatusTone: Record<ProjectStatus, Tone> = {
  planning: "neutral", active: "accent", on_hold: "warning", review: "info", completed: "success", cancelled: "neutral",
};
export const taskStatusTone: Record<TaskStatus, Tone> = { todo: "neutral", in_progress: "accent", review: "info", blocked: "danger", done: "success" };
export const priorityTone: Record<Priority, Tone> = { low: "neutral", medium: "info", high: "warning", urgent: "danger" };

/** Permissões conhecidas (as mesmas da tabela public.permissions). */
export type Permission =
  | "dashboard.view" | "clients.read" | "clients.write" | "crm.read" | "crm.write" | "projects.read_all" | "projects.write"
  | "tasks.assign" | "templates.manage" | "proposals.read" | "proposals.write" | "contracts.read" | "contracts.write"
  | "finance.read" | "finance.write" | "reports.read" | "team.read" | "users.manage" | "settings.manage" | "portal.share"
  | "creative.write" | "ai.use";

export interface Membership {
  organization_id: string;
  organization_name: string;
  slug: string;
  role: OrgRole;
  job_title: string | null;
  permissions: Permission[];
}
export interface ClientAccount { client_id: string; organization_id: string; client_name: string; studio_name: string }
export interface SessionContext {
  user_id: string;
  memberships: Membership[];
  client_accounts: ClientAccount[];
  pending_invites: boolean;
}

export interface Client {
  id: string; organization_id: string; status: ClientStatus; legal_name: string; trade_name: string | null; document: string | null;
  email: string | null; phone: string | null; whatsapp: string | null; website: string | null; segment: string | null;
  address: Record<string, string>; social_links: Record<string, string>; notes: string | null; owner_id: string | null;
  created_at: string; updated_at: string;
}
export interface Project {
  id: string; organization_id: string; client_id: string; name: string; code: string | null; category: ProjectCategory;
  description: string | null; objectives: string | null; scope: string | null; owner_id: string | null;
  start_date: string | null; due_date: string | null; contracted_amount: number; status: ProjectStatus; priority: Priority;
  template_id: string | null; proposal_id: string | null; contract_id: string | null; created_at: string; updated_at: string;
  clients?: { legal_name: string; trade_name: string | null } | null;
}
export interface Task {
  id: string; organization_id: string; project_id: string; parent_id: string | null; title: string; description: string | null;
  status: TaskStatus; priority: Priority; assignee_id: string | null; start_date: string | null; due_date: string | null;
  estimated_hours: number | null; position: number; client_visible: boolean; completed_at: string | null; created_by: string | null;
  created_at: string;
}
export interface Profile { id: string; full_name: string; avatar_path: string | null }

/** Rótulo amigável para códigos de erro do banco/Edge Functions. */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string })?.message ?? "";
  const map: Record<string, string> = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Confirme seu e-mail antes de entrar.",
    forbidden: "Você não tem permissão para esta ação.",
    already_member: "Sua conta já pertence a um estúdio.",
    client_account: "Contas de cliente acessam apenas o portal.",
    last_admin: "O estúdio precisa ter pelo menos um administrador ativo.",
    only_admin_invites_admin: "Só administradores podem convidar outro administrador.",
    only_admin_creates_users: "Somente o administrador cadastra usuários.",
    not_bootstrap_admin: "Somente o administrador inicial pode configurar o estúdio.",
    org_creation_closed: "Esta instalação já tem um estúdio configurado. Peça um convite ao administrador.",
    email_belongs_to_team_member: "Este e-mail pertence a um membro da equipe.",
    invalid_input: "Confira os dados informados.",
    clients_document_digits: "CPF/CNPJ inválido.",
    uq_clients_document: "Já existe um cliente com este CPF/CNPJ.",
    parent_task_other_project: "A subtarefa precisa estar no mesmo projeto.",
    "new row violates row-level security": "Você não tem permissão para esta ação.",
    "duplicate key value violates unique constraint \"organizations_slug_key\"": "Este endereço já está em uso.",
    "Failed to fetch": "Sem conexão com o servidor. Verifique sua internet.",
    file_too_large: "Arquivo maior que 50 MB. Envie um link (Drive, WeTransfer) no campo de links.",
    file_type_not_allowed: "Tipo de arquivo não aceito. Envie imagens, PDF, vídeos, AI/EPS/SVG, ZIP ou documentos.",
    response_empty: "Escreva uma resposta, cole um link ou anexe um arquivo.",
    invalid_link: "Os links precisam começar com http:// ou https://.",
    name_required: "Informe seu nome completo.",
    request_closed: "Este pedido já foi concluído pelo estúdio.",
    briefing_not_open: "Este briefing não está aberto para respostas.",
    briefing_already_answered: "Este briefing já foi respondido.",
    briefing_without_project: "Vincule o briefing a um projeto para mostrá-lo no link do cliente.",
    approval_already_pending: "Já existe uma aprovação pendente para este item.",
    requests_not_allowed: "Este link não permite enviar respostas. Peça um novo link ao estúdio.",
    invalid_days: "Escolha uma validade entre 1 e 60 dias.",
    ai_busy: "A IA gratuita do Google está sobrecarregada agora. Tente de novo em instantes.",
    ai_rate_limited: "O limite gratuito da IA foi atingido. Tente de novo em alguns minutos.",
    ai_provider_error: "A IA não respondeu agora. Tente de novo; se continuar, confira a chave cadastrada no Supabase.",
  };
  for (const [k, v] of Object.entries(map)) if (raw.includes(k)) return v;
  return raw || "Algo deu errado. Tente novamente.";
}
