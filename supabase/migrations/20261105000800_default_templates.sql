-- =============================================================================
-- NEXO Studio OS — 0008 Modelos padrão (projetos e contratos) por organização
-- São pontos de partida editáveis, não dados de negócio.
-- =============================================================================

create or replace function public.seed_default_templates(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tpl uuid; rec record;
begin
  for rec in
    select * from (values
      ('Branding completo', 'branding', array[
        'Briefing','Pesquisa de mercado','Diagnóstico','Estratégia','Naming','Painel semântico','Moodboard',
        'Conceituação','Desenvolvimento da identidade','Apresentação','Revisões','Aprovação','Manual da marca','Entrega final']),
      ('Social media mensal', 'social_media', array[
        'Reunião de planejamento','Definição de pilares e temas','Calendário editorial','Roteiros e legendas',
        'Criação das peças','Revisão interna','Aprovação do cliente','Agendamento','Relatório do mês']),
      ('Ensaio fotográfico', 'photography', array[
        'Briefing','Referências e moodboard','Planejamento e shot list','Produção (locação, equipe, equipamentos)',
        'Sessão fotográfica','Seleção','Tratamento','Revisão','Entrega da galeria']),
      ('Produção audiovisual', 'audiovisual', array[
        'Briefing','Roteiro','Decupagem e storyboard','Pré-produção','Gravação','Edição (1º corte)',
        'Revisão do cliente','Finalização, cor e som','Entrega']),
      ('Website institucional', 'website', array[
        'Briefing','Arquitetura de informação','Wireframes','Design de interface','Aprovação do layout',
        'Desenvolvimento','Conteúdo e SEO básico','Testes','Publicação','Treinamento']),
      ('Campanha', 'campaign', array[
        'Briefing','Pesquisa e insights','Conceito criativo','Plano de mídia','Peças-chave','Desdobramentos',
        'Aprovação','Veiculação','Relatório de resultados']),
      ('Design gráfico', 'graphic_design', array[
        'Briefing','Referências','Criação','Revisão interna','Apresentação','Ajustes','Arte-final','Entrega'])
    ) as t(name, category, steps)
  loop
    insert into public.project_templates (organization_id, name, category)
    values (p_org, rec.name, rec.category::public.project_category) returning id into v_tpl;
    insert into public.project_template_tasks (organization_id, template_id, position, title, offset_days, duration_days, optional_key, client_visible)
    select p_org, v_tpl, s.ord, s.step, (s.ord - 1) * 3, 3,
           case when rec.category = 'branding' and s.step = 'Naming' then 'naming' end, true
    from unnest(rec.steps) with ordinality as s(step, ord);
  end loop;

  insert into public.contract_templates (organization_id, name, category, body_html) values
  (p_org, 'Prestação de serviços — Branding', 'branding',
   '<h1>Contrato de prestação de serviços de branding</h1>'
   '<p><strong>CONTRATANTE:</strong> {{nome_cliente}}, inscrito(a) sob o nº {{cpf_cnpj}}, com endereço em {{endereco_cliente}}.</p>'
   '<p><strong>CONTRATADA:</strong> {{nome_estudio}}, inscrita sob o nº {{documento_estudio}}.</p>'
   '<h2>1. Objeto</h2><p>{{servico_contratado}}</p>'
   '<h2>2. Escopo e entregáveis</h2><p>{{escopo}}</p>'
   '<h2>3. Revisões</h2><p>Estão incluídas {{numero_revisoes}} rodadas de revisão por etapa.</p>'
   '<h2>4. Valor e pagamento</h2><p>Valor total de {{valor_total}}. Condições: {{condicoes_pagamento}}.</p>'
   '<h2>5. Prazo</h2><p>Início em {{data_inicio}} e entrega prevista para {{data_entrega}}.</p>'
   '<h2>6. Propriedade intelectual</h2><p>Após a quitação integral, os direitos patrimoniais sobre a identidade aprovada são cedidos à CONTRATANTE.</p>'
   '<h2>7. Naming</h2><p>Quando contratado, a CONTRATADA realiza pesquisa preliminar; a verificação de registrabilidade junto ao INPI é de responsabilidade da CONTRATANTE ou de assessoria jurídica.</p>'),
  (p_org, 'Prestação de serviços recorrentes — Social media', 'social_media',
   '<h1>Contrato de serviços recorrentes de social media</h1>'
   '<p><strong>CONTRATANTE:</strong> {{nome_cliente}} ({{cpf_cnpj}}), {{endereco_cliente}}.</p>'
   '<p><strong>CONTRATADA:</strong> {{nome_estudio}} ({{documento_estudio}}).</p>'
   '<h2>1. Objeto</h2><p>{{servico_contratado}}</p><h2>2. Escopo mensal</h2><p>{{escopo}}</p>'
   '<h2>3. Valor</h2><p>{{valor_total}} — {{condicoes_pagamento}}.</p>'
   '<h2>4. Vigência</h2><p>De {{data_inicio}} a {{data_entrega}}, renovável mediante aditivo.</p>'
   '<h2>5. Aprovações</h2><p>As publicações só são agendadas após aprovação registrada no portal.</p>'),
  (p_org, 'Prestação de serviços — Fotografia e audiovisual', 'audiovisual',
   '<h1>Contrato de produção fotográfica e audiovisual</h1>'
   '<p><strong>CONTRATANTE:</strong> {{nome_cliente}} ({{cpf_cnpj}}), {{endereco_cliente}}.</p>'
   '<p><strong>CONTRATADA:</strong> {{nome_estudio}} ({{documento_estudio}}).</p>'
   '<h2>1. Objeto</h2><p>{{servico_contratado}}</p><h2>2. Escopo</h2><p>{{escopo}}</p>'
   '<h2>3. Valor</h2><p>{{valor_total}} — {{condicoes_pagamento}}.</p>'
   '<h2>4. Datas</h2><p>Início {{data_inicio}}; entrega {{data_entrega}}. Revisões incluídas: {{numero_revisoes}}.</p>'
   '<h2>5. Uso de imagem</h2><p>Autorizações de uso de imagem de terceiros são obtidas antes da captação.</p>');
end $$;

create or replace function public.after_org_created_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_templates(new.id);
  return new;
end $$;
create trigger trg_org_seed_templates after insert on public.organizations
  for each row execute function public.after_org_created_templates();

-- Permissões de execução: nada para anon; equipe/cliente autenticados
-- executam as funções de autorização (usadas pelas políticas) e as RPCs;
-- funções internas ficam só para o servidor (service_role).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.mark_overdue(), public.seed_default_templates(uuid), public.seed_default_pipeline(uuid),
  public.seed_default_fin_categories(uuid), public.seed_default_role_permissions(uuid),
  public.notify(uuid, uuid, text, text, text, text) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
