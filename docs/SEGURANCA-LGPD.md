# Segurança e LGPD

## Controles implementados

* **Isolamento por organização** em todas as tabelas (RLS + FKs compostas), testado com dois estúdios.
* **Menor privilégio:** permissões por papel e por pessoa; projetos por participação; financeiro só com `finance.read`.
* **Portal separado:** clientes leem apenas views com colunas seguras; nunca veem valores contratados, custos, comentários internos, outros clientes ou dados administrativos.
* **Links seguros:** token aleatório de 256 bits, guardado apenas como SHA-256; escopos, expiração e revogação; o token trafega no fragmento da URL e em header, não em query string nem em logs de servidor.
* **Segredos:** service role só em Edge Functions e no script de bootstrap; tokens de integrações (Fases 3–5) no Supabase Vault, referenciados por `integrations.vault_secret_id`.
* **Arquivos:** bucket privado; download só por URL assinada de curta duração e apenas se a pessoa pode ler o registro em `files`.
* **Auditoria:** `activity_logs` registra criação, alteração (campo a campo) e exclusão de entidades principais, além de login, logout e troca de senha.
* **Validação dupla:** Zod no formulário e constraints no banco (CPF/CNPJ, valores não negativos, datas coerentes, status válidos).
* **Senhas:** só no Supabase Auth (bcrypt); cadastro público desligado; recuperação com resposta neutra.

## LGPD

* **Bases legais:** dados de clientes tratados para execução de contrato (art. 7º, V) e legítimo interesse do estúdio no relacionamento comercial (art. 7º, IX).
* **Minimização:** só coletamos o necessário para proposta, contrato e cobrança. Documentos pessoais (CPF) ficam visíveis apenas para quem tem `clients.read`.
* **Direitos do titular (Fase 3):** exportação dos dados de um cliente em JSON/CSV e exclusão. Quando houver obrigação fiscal de guarda (notas e lançamentos), os registros financeiros serão mantidos e o restante anonimizado. Hoje a exclusão de cliente é bloqueada se houver projetos ou lançamentos vinculados.
* **Retenção (a definir pelo estúdio):** recomendação de manter logs de atividade por 5 anos e criar links do portal sempre com data de expiração. Hoje a expiração é escolhida na criação do link; a limpeza automática de logs antigos entra na Fase 3.
* **Encarregado (DPO):** indicar nome e e-mail na política de privacidade do estúdio antes de abrir o portal para clientes (campo dedicado em Configurações entra na Fase 3).
* **Incidentes:** em caso de vazamento, revogar links (`share_links.revoked_at`), girar chaves no Supabase e comunicar a ANPD e os titulares conforme o art. 48.
