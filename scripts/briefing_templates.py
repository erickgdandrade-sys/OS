#!/usr/bin/env python3
"""Fonte dos modelos padrão de briefing (um por serviço do estúdio).

Gera supabase/migrations/20261109000200_briefing_templates.sql:
    python3 scripts/briefing_templates.py

Cada pergunta: id (único no modelo), label, type (text | textarea | choice |
multi | date | url | number), options (choice/multi), required, help.
Depois de aplicado, cada estúdio pode editar os seus modelos na tela Briefings.
"""
import json
from pathlib import Path

def q(id, label, type="textarea", options=None, required=False, help=None):
    d = {"id": id, "label": label, "type": type, "required": required}
    if options: d["options"] = options
    if help: d["help"] = help
    return d

COMPANY = {"title": "Sobre a empresa", "questions": [
    q("empresa_nome", "Nome da empresa ou marca", "text", required=True),
    q("responsavel", "Seu nome e cargo", "text", required=True),
    q("segmento", "Segmento de atuação", "text", required=True),
    q("negocio", "Descreva o negócio em poucas linhas: o que vende, para quem e como", required=True),
    q("historia", "Como a empresa começou? Algum fato marcante da história?"),
    q("publico", "Quem é o seu cliente ideal? (idade, perfil, região, hábitos)", required=True),
    q("concorrentes", "Principais concorrentes (nomes, sites ou perfis)"),
    q("diferenciais", "Por que os clientes escolhem você e não a concorrência?"),
]}
CLOSING = {"title": "Prazos, investimento e referências", "questions": [
    q("prazo", "Existe uma data limite? Por quê?", "text", help="Ex.: lançamento, evento, campanha sazonal."),
    q("investimento", "Faixa de investimento prevista", "choice", ["Até R$ 3 mil", "R$ 3 mil a R$ 10 mil", "R$ 10 mil a R$ 30 mil", "Acima de R$ 30 mil", "Prefiro conversar"]),
    q("referencias", "Referências de que você gosta (links, perfis, marcas) e o que gosta nelas"),
    q("nao_quer", "O que você definitivamente NÃO quer?"),
    q("aprovador", "Quem participa das aprovações?", "text"),
    q("observacoes", "Algo mais que devemos saber?"),
]}

TEMPLATES = [
  ("branding", "Briefing — Branding e identidade visual", "Construção ou reposicionamento de marca.", [
    {"title": "Essência da marca", "questions": [
      q("proposito", "Propósito: por que a empresa existe além de ganhar dinheiro?"),
      q("missao", "Missão"), q("visao", "Visão: onde quer estar em 5 anos?"),
      q("valores", "Valores que guiam as decisões da empresa"),
      q("posicionamento", "Como quer ser percebida no mercado?", required=True),
    ]},
    {"title": "Personalidade e comunicação", "questions": [
      q("personalidade", "Se a marca fosse uma pessoa, ela seria…", "multi", ["Sofisticada", "Acessível", "Divertida", "Séria", "Acolhedora", "Ousada", "Técnica", "Artesanal", "Minimalista", "Tradicional", "Inovadora", "Jovem"]),
      q("tom_voz", "Como a marca fala? (ex.: próxima e bem-humorada, formal e técnica)"),
      q("personas", "Descreva 1 a 3 perfis de clientes (personas)"),
    ]},
    {"title": "Identidade visual", "questions": [
      q("situacao", "Situação atual", "choice", ["Não tenho marca", "Tenho e quero renovar", "Tenho e quero só organizar/atualizar"], required=True),
      q("o_que_manter", "Se já existe marca: o que deve ser mantido?"),
      q("cores_gosta", "Cores que combinam com a marca", "text"), q("cores_evitar", "Cores a evitar", "text"),
      q("aplicacoes", "Onde a marca será mais usada?", "multi", ["Redes sociais", "Site", "Embalagens", "Fachada/sinalização", "Uniformes", "Papelaria", "Veículos", "Eventos", "Produtos"]),
      q("objetivos", "O que a nova marca precisa resolver?", required=True),
    ]}]),
  ("naming", "Briefing — Naming", "Criação de nome para empresa, produto, serviço ou evento.", [
    {"title": "O que vamos nomear", "questions": [
      q("objeto", "O que será nomeado?", "choice", ["Empresa", "Produto", "Linha de produtos", "Serviço", "Evento", "Projeto"], required=True),
      q("descricao", "Descreva o que está sendo nomeado e o que o torna único", required=True),
      q("sensacao", "Que sensação o nome deve transmitir?"),
      q("temas", "Palavras, temas ou ideias que gostaria de explorar"),
      q("evitar", "Palavras, sons ou ideias a evitar"),
      q("idiomas", "Idiomas aceitos", "multi", ["Português", "Inglês", "Espanhol", "Palavra inventada", "Indiferente"]),
      q("tamanho", "Preferência de tamanho", "choice", ["Curto (1 palavra)", "Até 2 palavras", "Indiferente"]),
      q("ja_pensou", "Nomes que você já considerou (e por que não seguiu)"),
      q("dominio", "Precisa de domínio .com.br/.com e @ nas redes disponíveis?", "choice", ["Sim, obrigatório", "Desejável", "Não é necessário"]),
      q("registro", "Pretende registrar a marca no INPI? Em quais atividades?", help="A pesquisa de disponibilidade é preliminar; o registro é feito por você ou por assessoria jurídica."),
    ]}]),
  ("graphic_design", "Briefing — Design gráfico", "Peças impressas e digitais.", [
    {"title": "As peças", "questions": [
      q("pecas", "Quais peças?", "multi", ["Cartaz", "Folder/flyer", "Catálogo", "Embalagem", "Rótulo", "Cardápio", "Sinalização", "Papelaria", "Apresentação", "Banner", "Outro"], required=True),
      q("objetivo", "Qual o objetivo das peças?", required=True),
      q("meio", "Uso", "choice", ["Impresso", "Digital", "Ambos"], required=True),
      q("formatos", "Formatos e tamanhos (se souber)", "text"),
      q("quantidade", "Quantidades/tiragens previstas", "text"),
      q("conteudo", "Textos e fotos já estão prontos?", "choice", ["Sim, tudo pronto", "Parcialmente", "Não, preciso de ajuda"]),
      q("manual", "Existe manual de marca ou identidade a seguir?", "choice", ["Sim", "Não", "Não sei"]),
      q("grafica", "Já tem gráfica/fornecedor definido? Acabamentos especiais?"),
    ]}]),
  ("art_direction", "Briefing — Direção de arte", "Conceito visual para campanhas, ensaios, filmes ou lançamentos.", [
    {"title": "Direção", "questions": [
      q("projeto", "Para qual projeto é a direção de arte?", required=True),
      q("mensagem", "Qual mensagem ou sentimento o público deve ter?", required=True),
      q("estetica", "Estética desejada", "multi", ["Clean/minimalista", "Colorida", "Editorial", "Natural/orgânica", "Urbana", "Luxo", "Retrô", "Futurista", "Brasilidade"]),
      q("paleta", "Paleta de cores desejada ou a evitar", "text"),
      q("pecas", "Peças e entregas envolvidas"),
      q("equipe", "Quem mais participa (fotógrafo, produtora, agência)?"),
      q("restricoes", "Restrições de marca, legais ou de orçamento"),
    ]}]),
  ("photography", "Briefing — Fotografia", "Ensaios de produto, retrato, gastronomia, eventos e campanhas.", [
    {"title": "A sessão", "questions": [
      q("tipo", "Tipo de fotografia", "multi", ["Produto", "Retrato/corporativo", "Gastronomia", "Evento", "Campanha/moda", "Arquitetura/ambientes", "Lifestyle"], required=True),
      q("uso", "Onde as fotos serão usadas?", "multi", ["Redes sociais", "Site/e-commerce", "Impressos", "Mídia paga", "Imprensa", "Ponto de venda"]),
      q("quantidade", "Quantas fotos finais você precisa?", "number"),
      q("data", "Data desejada", "date"), q("local", "Local (estúdio, empresa, locação externa)?", "text"),
      q("itens", "O que/quem será fotografado? (produtos, pessoas, quantidade)"),
      q("estilo", "Estilo", "multi", ["Fundo branco/infinito", "Luz natural", "Contraste dramático", "Colorido", "Preto e branco", "Editorial"]),
      q("modelos", "Haverá modelos ou colaboradores? Autorização de uso de imagem já está combinada?"),
      q("producao", "Precisa de produção (cenário, figurino, maquiagem, food styling)?", "choice", ["Sim", "Não", "A combinar"]),
    ]}]),
  ("audiovisual", "Briefing — Produção audiovisual", "Filmes institucionais, comerciais, reels, eventos e depoimentos.", [
    {"title": "O vídeo", "questions": [
      q("tipo", "Tipo de vídeo", "multi", ["Institucional", "Comercial", "Reels/curtos", "Evento", "Depoimentos", "Tutorial", "Animação/motion"], required=True),
      q("mensagem", "Qual a mensagem principal?", required=True),
      q("duracao", "Duração aproximada", "choice", ["Até 30s", "30s a 1min", "1 a 3min", "Acima de 3min", "Vários cortes"]),
      q("formatos", "Formatos", "multi", ["Horizontal 16:9", "Vertical 9:16", "Quadrado 1:1"]),
      q("plataformas", "Onde será exibido? (Instagram, YouTube, TV, evento, site)", "text"),
      q("roteiro", "Já existe roteiro?", "choice", ["Sim", "Tenho ideias", "Não, preciso de roteiro"]),
      q("locacoes", "Locações e datas possíveis de gravação"),
      q("elenco", "Quem aparece? (equipe, entrevistados, atores)"),
      q("audio", "Trilha, locução e legendas", "multi", ["Trilha licenciada", "Locução profissional", "Legendas", "Tradução"]),
    ]}]),
  ("social_media", "Briefing — Social media", "Gestão e criação de conteúdo para redes sociais.", [
    {"title": "Redes e objetivos", "questions": [
      q("redes", "Quais redes?", "multi", ["Instagram", "TikTok", "Facebook", "LinkedIn", "YouTube", "Pinterest", "X"], required=True),
      q("perfis", "@ dos perfis atuais", "text"),
      q("objetivos", "Principais objetivos", "multi", ["Crescer seguidores", "Engajamento", "Vender", "Autoridade/marca", "Levar tráfego ao site", "Atendimento"], required=True),
      q("frequencia", "Frequência desejada", "choice", ["3 posts/semana", "5 posts/semana", "Diário", "A definir"]),
      q("formatos", "Formatos preferidos", "multi", ["Post estático", "Carrossel", "Reels", "Stories", "Vídeos longos", "Lives"]),
    ]},
    {"title": "Conteúdo", "questions": [
      q("pilares", "Temas e assuntos que a marca domina (pilares de conteúdo)"),
      q("tom", "Tom de voz desejado"),
      q("datas", "Datas importantes do ano para o negócio"),
      q("proibido", "Assuntos ou tipos de post que NÃO devem ser feitos"),
      q("materiais", "Você envia fotos/vídeos ou precisamos produzir?", "choice", ["Eu envio", "Vocês produzem", "Misto"]),
      q("anuncios", "Investe ou pretende investir em anúncios? Quanto por mês?", "text"),
      q("atendimento", "Responderemos comentários e mensagens?", "choice", ["Sim", "Não", "Só comentários"]),
    ]}]),
  ("digital_marketing", "Briefing — Marketing digital", "Tráfego pago, SEO, e-mail e estratégia de aquisição.", [
    {"title": "Estratégia", "questions": [
      q("objetivo", "Objetivo principal", "choice", ["Gerar leads", "Vender online", "Agendamentos", "Reconhecimento de marca", "Downloads/cadastros"], required=True),
      q("oferta", "O que vamos anunciar? (produto, serviço, oferta)", required=True),
      q("canais", "Canais", "multi", ["Google Ads", "Meta Ads (Instagram/Facebook)", "TikTok Ads", "LinkedIn Ads", "SEO", "E-mail marketing", "WhatsApp"]),
      q("verba", "Verba mensal de mídia", "text"),
      q("destino", "Para onde o anúncio leva? (site, landing page, WhatsApp)", "url"),
      q("metricas", "Números atuais (visitas, leads, vendas, custo por lead), se tiver"),
      q("ferramentas", "Ferramentas instaladas", "multi", ["Google Analytics", "Pixel da Meta", "Tag Manager", "CRM", "Nenhuma", "Não sei"]),
    ]}]),
  ("campaign", "Briefing — Campanha", "Campanhas de lançamento, sazonais ou institucionais.", [
    {"title": "A campanha", "questions": [
      q("tema", "Nome ou tema da campanha", "text"),
      q("objetivo", "Objetivo da campanha", required=True),
      q("periodo", "Período de veiculação", "text"),
      q("mensagem", "Mensagem principal (o que o público precisa lembrar)", required=True),
      q("oferta", "Existe oferta, promoção ou condição especial?"),
      q("canais", "Canais", "multi", ["Redes sociais", "Mídia paga digital", "TV/rádio", "Mídia externa", "Ponto de venda", "E-mail", "Eventos", "Imprensa"]),
      q("pecas", "Peças que você já sabe que precisa"),
      q("kpis", "Como vamos medir o sucesso?"),
    ]}]),
  ("website", "Briefing — Website", "Sites institucionais, portfólios, blogs e lojas virtuais.", [
    {"title": "O site", "questions": [
      q("tipo", "Tipo de site", "choice", ["Institucional", "Portfólio", "Blog/conteúdo", "Loja virtual", "Outro"], required=True),
      q("objetivo", "Principal objetivo do site", required=True),
      q("paginas", "Páginas necessárias (ex.: início, sobre, serviços, contato)"),
      q("funcionalidades", "Funcionalidades", "multi", ["Formulário de contato", "Botão de WhatsApp", "Blog", "Agendamento", "Loja/pagamentos", "Área do cliente", "Multilíngue", "Integração com Instagram", "Newsletter"]),
      q("site_atual", "Site atual (se houver)", "url"),
      q("dominio", "Já tem domínio e hospedagem?", "choice", ["Tenho os dois", "Só domínio", "Não tenho"]),
      q("conteudo", "Textos e imagens estão prontos?", "choice", ["Sim", "Parcialmente", "Não"]),
      q("atualizacao", "Quem vai atualizar o site depois?", "choice", ["Nossa equipe", "O estúdio", "Raramente será atualizado"]),
      q("sites_ref", "Sites que admira (e por quê)"),
    ]}]),
  ("landing_page", "Briefing — Landing page", "Página de conversão para campanha, lançamento ou captação.", [
    {"title": "A página", "questions": [
      q("objetivo", "Qual ação o visitante deve fazer?", "choice", ["Preencher formulário", "Comprar", "Chamar no WhatsApp", "Agendar", "Baixar material", "Inscrever-se em evento"], required=True),
      q("oferta", "Qual a oferta e por que é irresistível?", required=True),
      q("publico", "Para quem é esta página especificamente?"),
      q("trafego", "De onde vêm os visitantes?", "multi", ["Anúncios Meta", "Google Ads", "Redes sociais", "E-mail", "QR code/impressos"]),
      q("provas", "Depoimentos, números, cases ou selos que podemos usar"),
      q("objecoes", "Principais dúvidas ou objeções do cliente"),
      q("integracoes", "Para onde vão os contatos? (CRM, planilha, e-mail, RD Station…)", "text"),
    ]}]),
  ("institutional", "Briefing — Materiais institucionais", "Apresentações, portfólios, relatórios e kits.", [
    {"title": "Os materiais", "questions": [
      q("materiais", "Quais materiais?", "multi", ["Apresentação institucional", "Portfólio", "Relatório anual", "Mídia kit", "Proposta comercial padrão", "Manual do colaborador", "Catálogo de serviços"], required=True),
      q("publico", "Para quem são os materiais? (clientes, investidores, imprensa, equipe)"),
      q("conteudo", "O conteúdo já existe?", "choice", ["Sim", "Em partes", "Não, precisamos escrever"]),
      q("idiomas", "Idiomas", "multi", ["Português", "Inglês", "Espanhol"]),
      q("formato", "Formato final", "multi", ["PDF", "Impresso", "Apresentação editável (PowerPoint/Keynote/Google)", "Página web"]),
    ]}]),
  ("consulting", "Briefing — Consultoria criativa e estratégica", "Diagnóstico, posicionamento e planejamento.", [
    {"title": "O desafio", "questions": [
      q("desafio", "Qual o principal desafio hoje?", required=True),
      q("objetivos", "Onde você quer chegar com a consultoria?", required=True),
      q("tentativas", "O que já foi tentado e qual foi o resultado?"),
      q("equipe", "Equipe e recursos disponíveis internamente"),
      q("dados", "Que dados ou relatórios podemos acessar?"),
      q("sucesso", "Como saberemos que a consultoria deu certo?"),
      q("formato", "Formato preferido", "choice", ["Encontros presenciais", "Encontros online", "Imersão de um dia", "Acompanhamento mensal"]),
    ]}]),
]

def sql_literal(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"

def build() -> str:
    rows = []
    for cat, name, desc, specific in TEMPLATES:
        sections = [COMPANY, *specific, CLOSING]
        ids = [qq["id"] for sec in sections for qq in sec["questions"]]
        # ids repetidos entre seções comuns e específicas recebem prefixo
        seen, fixed = set(), []
        for sec in sections:
            qs = []
            for qq in sec["questions"]:
                qq = dict(qq)
                if qq["id"] in seen: qq["id"] = f'{cat}_{qq["id"]}'
                seen.add(qq["id"]); qs.append(qq)
            fixed.append({"title": sec["title"], "questions": qs})
        assert len(ids) == len(seen)
        rows.append(f"({sql_literal(name)}, {sql_literal(cat)}, {sql_literal(desc)}, {sql_literal(json.dumps(fixed, ensure_ascii=False))}::jsonb)")
    return f"""-- =============================================================================
-- NEXO Studio OS — 0016 Modelos padrão de briefing (um por serviço)
-- GERADO por scripts/briefing_templates.py — edite o script e gere de novo.
-- =============================================================================
create or replace function public.seed_briefing_templates(p_org uuid)
returns void language sql security definer set search_path = public as $seed$
  insert into public.briefing_templates (organization_id, name, category, description, sections, is_default)
  select p_org, t.name, t.category::public.project_category, t.description, t.sections, true
  from (values
    {(','+chr(10)+'    ').join(rows)}
  ) as t(name, category, description, sections)
  where not exists (select 1 from public.briefing_templates b where b.organization_id = p_org and b.name = t.name);
$seed$;

do $$ begin perform public.seed_briefing_templates(id) from public.organizations; end $$;

create or replace function public.after_org_created_briefings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_briefing_templates(new.id);
  return new;
end $$;
create trigger trg_org_seed_briefings after insert on public.organizations
  for each row execute function public.after_org_created_briefings();

revoke execute on function public.seed_briefing_templates(uuid) from public, anon, authenticated;
"""

if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "supabase/migrations/20261109000200_briefing_templates.sql"
    out.write_text(build(), encoding="utf-8")
    n = sum(len(s["questions"]) for _, _, _, sp in TEMPLATES for s in [COMPANY, *sp, CLOSING])
    print(f"{out.name}: {len(TEMPLATES)} modelos, {n} perguntas")
