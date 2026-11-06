-- =============================================================================
-- NEXO Studio OS — 0017 "O que precisamos de você" (pedidos ao cliente)
-- Tudo que depende do cliente num só lugar do link do projeto: referências,
-- conteúdos, documentos, acessos e informações (pedidos), além dos briefings,
-- aprovações e seleção de fotos que já existem. O estúdio cria os pedidos
-- (ou usa a sugestão por tipo de projeto); o cliente responde pelo link.
-- =============================================================================

create type public.client_request_kind as enum ('reference', 'content', 'document', 'access', 'information', 'other');
create type public.client_request_status as enum ('open', 'answered', 'done', 'cancelled');

create table public.client_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid not null,
  kind            public.client_request_kind not null default 'other',
  title           text not null check (length(trim(title)) between 2 and 200),
  description     text check (length(description) <= 4000),
  due_date        date,
  is_required     boolean not null default true,
  status          public.client_request_status not null default 'open',
  response_text   text check (length(response_text) <= 10000),
  response_links  text[] not null default '{}' check (cardinality(response_links) <= 20),
  responded_label text,
  responded_at    timestamptz,
  position        int not null default 0,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, project_id) references public.projects(organization_id, id) on delete cascade
);
create index idx_client_requests_project on public.client_requests(project_id, status, position);
create trigger trg_client_requests_updated before update on public.client_requests for each row execute function public.set_updated_at();
create trigger trg_client_requests_log after insert or update or delete on public.client_requests for each row execute function public.log_activity();

-- Arquivos enviados pelo cliente ficam ligados ao pedido e ao link usado.
alter table public.files
  add column client_request_id uuid,
  add column uploaded_via_share_link uuid references public.share_links(id) on delete set null,
  add constraint files_client_request_fk foreign key (organization_id, client_request_id)
    references public.client_requests(organization_id, id) on delete set null (client_request_id);
create index idx_files_client_request on public.files(client_request_id) where client_request_id is not null;

alter table public.client_requests enable row level security;
create policy creq_select on public.client_requests for select using (
  public.can_access_project(project_id) or public.client_can_see_project(project_id));
create policy creq_insert on public.client_requests for insert with check (public.can_edit_project(project_id));
create policy creq_update on public.client_requests for update using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy creq_delete on public.client_requests for delete using (public.can_edit_project(project_id));

-- Novo escopo do link: "requests" (o que precisamos de você).
alter table public.share_links drop constraint if exists share_links_scopes_check;
alter table public.share_links add constraint share_links_scopes_check
  check (scopes <@ array['progress','tasks','files','approvals','moodboards','proposals','contracts','calendar','social','requests']::text[]);

-- Sugestões de pedidos conforme o tipo de projeto (não duplica títulos já criados).
create or replace function public.suggest_client_requests(p_project uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare p public.projects; n int; v_cat text;
begin
  select * into p from public.projects where id = p_project;
  if not found or not public.can_edit_project(p_project) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Categorias parecidas usam a mesma lista; as demais caem em "other".
  v_cat := case p.category::text
    when 'landing_page' then 'website' when 'digital_marketing' then 'campaign' when 'naming' then 'branding'
    when 'art_direction' then 'graphic_design' when 'institutional' then 'audiovisual' else p.category::text end;
  if v_cat not in ('branding', 'social_media', 'photography', 'audiovisual', 'website', 'campaign', 'graphic_design') then v_cat := 'other'; end if;
  insert into public.client_requests (organization_id, project_id, kind, title, description, is_required, position)
  select p.organization_id, p.id, s.kind::public.client_request_kind, s.title, s.description, s.req,
         coalesce((select max(position) from public.client_requests where project_id = p.id), 0) + s.ord
  from (values
    ('branding', 1, 'reference', 'Referências visuais', 'Marcas, logos, cores ou estilos de que você gosta (e o que gosta em cada um). Pode enviar links ou imagens.', true),
    ('branding', 2, 'information', 'Concorrentes', 'Nomes, sites ou perfis dos principais concorrentes diretos e indiretos.', true),
    ('branding', 3, 'document', 'Logo e materiais atuais', 'Se já existe uma marca: arquivos do logo (de preferência em vetor: AI, PDF, SVG), cartões, embalagens e fotos de aplicações.', false),
    ('branding', 4, 'information', 'Produtos e serviços', 'Lista do que a empresa vende, com uma frase sobre cada item.', false),
    ('social_media', 1, 'access', 'Acesso às redes sociais', 'Adicione o estúdio como parceiro no Meta Business Suite (Instagram/Facebook) e nas demais redes. Não envie senhas por aqui: escreva apenas quando o convite foi enviado.', true),
    ('social_media', 2, 'document', 'Logo, fontes e manual da marca', 'Arquivos da identidade visual para criarmos os posts.', true),
    ('social_media', 3, 'content', 'Fotos e vídeos', 'Fotos de produtos, equipe, ambiente e bastidores que podemos usar nos posts.', true),
    ('social_media', 4, 'information', 'Datas e promoções do mês', 'Lançamentos, promoções, eventos e datas importantes para o calendário.', true),
    ('social_media', 5, 'reference', 'Perfis de referência', 'Perfis que você admira e o que gosta neles.', false),
    ('photography', 1, 'reference', 'Referências de fotos', 'Fotos ou perfis com o estilo que você imagina (luz, enquadramento, clima).', true),
    ('photography', 2, 'information', 'Lista do que fotografar', 'Produtos, pessoas e ambientes, com quantidades e prioridades.', true),
    ('photography', 3, 'information', 'Local e horários', 'Endereço, horários de acesso, contato no local e regras do espaço.', true),
    ('audiovisual', 1, 'reference', 'Referências de vídeos', 'Links de vídeos com o estilo, ritmo ou linguagem desejados.', true),
    ('audiovisual', 2, 'content', 'Mensagens principais e roteiro', 'O que o vídeo precisa dizer, falas obrigatórias e textos legais.', true),
    ('audiovisual', 3, 'document', 'Autorizações de locação e de imagem', 'Autorização do local de gravação e termos de uso de imagem das pessoas que vão aparecer.', true),
    ('audiovisual', 4, 'information', 'Pessoas que vão participar', 'Nomes, funções e disponibilidade de quem aparece no vídeo.', false),
    ('website', 1, 'content', 'Textos das páginas', 'Textos de apresentação, serviços, sobre, contato e perguntas frequentes.', true),
    ('website', 2, 'content', 'Fotos e imagens', 'Fotos da empresa, produtos e equipe em boa resolução.', true),
    ('website', 3, 'access', 'Domínio e hospedagem', 'Informe onde o domínio está registrado e convide o estúdio como usuário técnico. Não envie senhas por aqui.', true),
    ('website', 4, 'reference', 'Sites de referência', 'Sites de que você gosta e o que gosta em cada um.', false),
    ('website', 5, 'document', 'Logo em vetor', 'Arquivo do logo em AI, PDF ou SVG.', true),
    ('campaign', 1, 'information', 'Objetivo, verba e período', 'Meta da campanha, investimento previsto em mídia e datas de início e fim.', true),
    ('campaign', 2, 'reference', 'Referências de campanhas', 'Campanhas que você admira e o motivo.', false),
    ('campaign', 3, 'document', 'Logo e manual da marca', 'Arquivos da identidade visual.', true),
    ('campaign', 4, 'access', 'Contas de anúncio', 'Convide o estúdio como parceiro nas contas de anúncio (Meta, Google). Não envie senhas por aqui.', false),
    ('graphic_design', 1, 'content', 'Textos e informações das peças', 'Todo o texto que deve aparecer em cada peça, revisado.', true),
    ('graphic_design', 2, 'information', 'Formatos e uso', 'Medidas, onde será impresso ou publicado e quantidade.', true),
    ('graphic_design', 3, 'reference', 'Referências', 'Peças de que você gosta e o estilo desejado.', false),
    ('graphic_design', 4, 'document', 'Logo em vetor', 'Arquivo do logo em AI, PDF ou SVG.', true),
    ('other', 1, 'reference', 'Referências', 'Exemplos do que você imagina para este projeto.', false),
    ('other', 2, 'information', 'Informações do projeto', 'Tudo que precisamos saber para começar.', true)
  ) as s(category, ord, kind, title, description, req)
  where s.category = v_cat
    and not exists (select 1 from public.client_requests r where r.project_id = p.id and lower(r.title) = lower(s.title));
  get diagnostics n = row_count;
  return n;
end $$;

-- Resposta do cliente (Edge Function `portal`, service role) — avisa o responsável.
create or replace function public.answer_client_request(p_request uuid, p_text text, p_links text[], p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.client_requests; v_owner uuid;
begin
  select * into r from public.client_requests where id = p_request for update;
  if not found or r.status in ('done', 'cancelled') then raise exception 'request_closed'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;
  if coalesce(trim(p_text), '') = '' and coalesce(cardinality(p_links), 0) = 0
     and not exists (select 1 from public.files f where f.client_request_id = r.id) then
    raise exception 'response_empty';
  end if;
  if exists (select 1 from unnest(coalesce(p_links, '{}')) l where l !~* '^https?://' or length(l) > 2000) then raise exception 'invalid_link'; end if;
  update public.client_requests set status = 'answered', response_text = nullif(trim(p_text), ''),
    response_links = coalesce(p_links, '{}'), responded_label = trim(p_name), responded_at = now()
  where id = r.id;
  select owner_id into v_owner from public.projects where id = r.project_id;
  perform public.notify(r.organization_id, coalesce(v_owner, r.created_by), 'client_request_answered',
    'Cliente respondeu: ' || r.title, trim(p_name), '/projetos/' || r.project_id);
end $$;

-- Respostas de briefing sem token (vindas do link do projeto, já validado pela Edge Function).
create or replace function public.save_briefing_answers(p_briefing uuid, p_answers jsonb, p_final boolean, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.briefings;
begin
  select * into b from public.briefings where id = p_briefing for update;
  if not found or b.status not in ('sent', 'in_progress') then raise exception 'briefing_not_open'; end if;
  if jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 100000 then raise exception 'invalid_answers'; end if;
  if p_final and length(trim(coalesce(p_name, ''))) < 3 then raise exception 'name_required'; end if;
  update public.briefings set answers = answers || p_answers,
    status = case when p_final then 'answered'::public.briefing_status else 'in_progress'::public.briefing_status end,
    submitted_at = case when p_final then now() else submitted_at end,
    respondent_name = coalesce(nullif(trim(p_name), ''), respondent_name),
    token_hash = case when p_final then null else token_hash end
  where id = b.id;
  if p_final then
    perform public.notify(b.organization_id, b.created_by, 'briefing_answered', 'Briefing respondido: ' || b.title, trim(p_name), '/briefings/' || b.id);
  end if;
end $$;

-- Disponibiliza o briefing para o cliente responder pelo link do projeto (sem gerar token avulso).
create or replace function public.share_briefing_in_portal(p_briefing uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare b public.briefings;
begin
  select * into b from public.briefings where id = p_briefing;
  if not found or not (public.has_perm(b.organization_id, 'creative.write') or public.has_perm(b.organization_id, 'crm.write')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if b.project_id is null then raise exception 'briefing_without_project'; end if;
  if b.status in ('answered', 'reviewed') then raise exception 'briefing_already_answered'; end if;
  update public.briefings set status = case when status = 'draft' then 'sent'::public.briefing_status else status end, sent_at = coalesce(sent_at, now())
  where id = b.id;
end $$;

grant execute on function public.suggest_client_requests(uuid), public.share_briefing_in_portal(uuid) to authenticated;
revoke execute on function public.suggest_client_requests(uuid), public.share_briefing_in_portal(uuid),
  public.answer_client_request(uuid, text, text[], text), public.save_briefing_answers(uuid, jsonb, boolean, text) from public, anon;
revoke execute on function public.answer_client_request(uuid, text, text[], text), public.save_briefing_answers(uuid, jsonb, boolean, text) from authenticated;
grant execute on function public.answer_client_request(uuid, text, text[], text), public.save_briefing_answers(uuid, jsonb, boolean, text) to service_role;
