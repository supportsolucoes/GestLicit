-- ============================================================
-- GestLicit — Schema relacional v1
-- Execute completo no SQL Editor do Supabase
-- Uso interno único (um único workspace) — sem multi-tenant
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- FUNÇÃO AUXILIAR sem dependência de tabela
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- TABELA: app_profiles
-- Perfis de acesso vinculados ao Supabase Auth
-- (precisa existir antes de get_user_role(), que é uma função
-- "language sql" e tem o corpo resolvido na criação)
-- ============================================================
create table if not exists public.app_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  nome        text not null,
  role        text not null default 'consulta'
              check (role in ('administrador', 'comercial', 'financeiro', 'consulta')),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.get_user_role()
returns text
language sql
security definer
stable
as $$
  select role from public.app_profiles where id = auth.uid() limit 1;
$$;

-- cria automaticamente um perfil (role 'consulta') quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.app_profiles (id, email, nome, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', new.email), 'consulta')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- promove um usuário existente a administrador (usar uma única vez na configuração inicial)
create or replace function public.promover_administrador(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.app_profiles set role = 'administrador', updated_at = now() where id = p_user_id;
end;
$$;

-- ============================================================
-- TABELA: orgaos
-- ============================================================
create table if not exists public.orgaos (
  id          bigserial primary key,
  nome        text not null,
  cnpj        text,
  uf          text,
  cidade      text,
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- TABELA: concorrentes
-- ============================================================
create table if not exists public.concorrentes (
  id          bigserial primary key,
  nome        text not null,
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- TABELA: parceiros (distribuidoras/revendas que representam a empresa)
-- ============================================================
create table if not exists public.parceiros (
  id                      bigserial primary key,
  razao_social            text not null,
  cnpj                    text,
  contato                 text,
  telefone                text,
  email                   text,
  prazo_entrega           text,
  prazo_entrega_uteis     boolean not null default false,
  prazo_pagamento         text,
  prazo_pagamento_uteis   boolean not null default false,
  observacoes             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- TABELA: produtos (catálogo)
-- ============================================================
create table if not exists public.produtos (
  id            bigserial primary key,
  nome          text not null,
  fabricante    text,
  preco_custo   numeric(14,2),
  codigo_sinc   text,
  sinonimos     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- TABELA: licitacoes (editais disputados)
-- ============================================================
create table if not exists public.licitacoes (
  id                    bigserial primary key,
  numero_pregao         text not null,
  numero_processo       text,
  orgao_id              bigint references public.orgaos(id) on delete set null,
  uf                    text,
  modalidade            text not null default 'Pregão Eletrônico'
                        check (modalidade in ('Pregão Eletrônico', 'Pregão Presencial', 'Concorrência', 'Concurso', 'Leilão', 'Dispensa', 'Inexigibilidade')),
  data_sessao           date,
  objeto                text,
  elaborado_por         uuid references auth.users(id) on delete set null,
  recurso_contrarrazao  boolean not null default false,
  motivo_rc             text,
  descricao_motivo      text,
  deferido_indeferido   text check (deferido_indeferido in ('Deferido', 'Indeferido') or deferido_indeferido is null),
  observacoes           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================
-- TABELA: licitacao_itens
-- ============================================================
create table if not exists public.licitacao_itens (
  id                          bigserial primary key,
  licitacao_id                bigint not null references public.licitacoes(id) on delete cascade,
  item_numero                 integer not null default 1,
  produto_id                  bigint references public.produtos(id) on delete set null,
  produto_descricao           text,
  quantidade                  numeric(14,2),
  valor_inicial               numeric(14,2),
  valor_minimo                numeric(14,2),
  valor_final                 numeric(14,2),
  status                      text not null default 'Em disputa'
                              check (status in ('Em disputa', 'Ganhou', 'Declinou', 'Desclassificado', 'Fracassado', 'Revogado')),
  motivo_perda                text,
  empresa_vencedora_id        bigint references public.concorrentes(id) on delete set null,
  produto_vencedor_descricao  text,
  parceiro_id                 bigint references public.parceiros(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ============================================================
-- TABELA: atas (atas de registro de preço e empenhos diretos)
-- ============================================================
create table if not exists public.atas (
  id                bigserial primary key,
  numero_ata        text not null,
  licitacao_id      bigint references public.licitacoes(id) on delete set null,
  tipo              text not null default 'ATA' check (tipo in ('ATA', 'EMPENHO')),
  orgao_id          bigint references public.orgaos(id) on delete set null,
  data_assinatura   date,
  vigencia_inicio   date,
  vigencia_fim      date,
  valor_total       numeric(14,2),
  situacao          text not null default 'Vigente' check (situacao in ('Vigente', 'Encerrada', 'Cancelada')),
  observacoes       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- TABELA: ata_itens
-- ============================================================
create table if not exists public.ata_itens (
  id                  bigserial primary key,
  ata_id              bigint not null references public.atas(id) on delete cascade,
  licitacao_item_id   bigint references public.licitacao_itens(id) on delete set null,
  produto_id          bigint references public.produtos(id) on delete set null,
  produto_descricao   text,
  quantidade_total    numeric(14,2) not null default 0,
  valor_unitario      numeric(14,2) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================
-- TABELA: ata_consumos (movimentos de compra/empenho por item de ata)
-- ============================================================
create table if not exists public.ata_consumos (
  id              bigserial primary key,
  ata_item_id     bigint not null references public.ata_itens(id) on delete cascade,
  data_compra     date not null default current_date,
  quantidade      numeric(14,2) not null default 0,
  numero_empenho  text,
  observacao      text,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- TABELA: certidoes (documentos de regularidade da própria empresa)
-- ============================================================
create table if not exists public.certidoes (
  id            bigserial primary key,
  tipo          text not null check (tipo in ('CND Federal', 'FGTS', 'Trabalhista', 'Estadual', 'Municipal')),
  numero        text,
  data_emissao  date,
  data_validade date,
  arquivo_url   text,
  observacoes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- TABELA: documentos (repositório central)
-- ============================================================
create table if not exists public.documentos (
  id                bigserial primary key,
  categoria         text not null check (categoria in ('Edital', 'Proposta', 'Ata', 'Contrato', 'Parecer', 'Certidão', 'Relatório', 'Outro')),
  referencia_tipo   text,
  referencia_id     bigint,
  nome_arquivo      text not null,
  arquivo_url       text not null,
  versao            integer not null default 1,
  uploaded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- TABELA: agenda_eventos
-- ============================================================
create table if not exists public.agenda_eventos (
  id              bigserial primary key,
  titulo          text not null,
  tipo            text not null default 'Outro'
                  check (tipo in ('Sessão Pública', 'Prazo de Recurso', 'Vencimento de Ata', 'Vencimento de Certidão', 'Outro')),
  data            date not null,
  referencia_tipo text,
  referencia_id   bigint,
  lembrete        boolean not null default true,
  observacoes     text,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ALTERAÇÕES v1.1 — Bloco "Recebimento da Licitação + Precificação"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================

-- licitacoes: dados completos do edital (cabeçalho)
alter table public.licitacoes add column if not exists registro_preco boolean not null default false;
alter table public.licitacoes add column if not exists valor_total_estimado numeric(14,2);
alter table public.licitacoes add column if not exists modo_disputa text
  check (modo_disputa in ('Aberto', 'Fechado', 'Aberto-Fechado') or modo_disputa is null);
alter table public.licitacoes add column if not exists data_abertura timestamptz;
alter table public.licitacoes add column if not exists hora_sessao time;
alter table public.licitacoes add column if not exists prazo_entrega text;
alter table public.licitacoes add column if not exists prazo_pagamento text;
alter table public.licitacoes add column if not exists validade_proposta text;
alter table public.licitacoes add column if not exists nome_pregoeiro text;
alter table public.licitacoes add column if not exists telefone_pregoeiro text;
alter table public.licitacoes add column if not exists email_pregoeiro text;
alter table public.licitacoes add column if not exists enderecos text;

-- licitacao_itens: precificação (custo do produto + margem -> valor mínimo) e dados do item do edital
alter table public.licitacao_itens add column if not exists marca_fabricante text;
alter table public.licitacao_itens add column if not exists modelo_versao text;
alter table public.licitacao_itens add column if not exists valor_referencia numeric(14,2);
alter table public.licitacao_itens add column if not exists custo_unitario numeric(14,2);
alter table public.licitacao_itens add column if not exists margem_percentual numeric(6,2);

-- ============================================================
-- ALTERAÇÕES v1.2 — Bloco "Visão geral, Agenda vinculada, Pós-Disputa e Tags"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================

-- licitacao_itens: valor pelo qual o item foi arrematado (nosso ou do concorrente vencedor)
alter table public.licitacao_itens add column if not exists valor_arrematado numeric(14,2);

-- TABELA: tags (rótulos livres atribuíveis a licitações)
create table if not exists public.tags (
  id          bigserial primary key,
  nome        text not null unique,
  cor         text not null default '#2563EB',
  created_at  timestamptz not null default now()
);

-- TABELA: licitacao_tags (associação N:N entre licitacoes e tags)
create table if not exists public.licitacao_tags (
  licitacao_id  bigint not null references public.licitacoes(id) on delete cascade,
  tag_id        bigint not null references public.tags(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (licitacao_id, tag_id)
);

alter table public.tags           enable row level security;
alter table public.licitacao_tags enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['tags', 'licitacao_tags']
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''))
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''));', t);
  end loop;
end;
$$;

-- tags do sistema (referência visual do Licitei) — o usuário pode criar outras pela UI
insert into public.tags (nome, cor) values
  ('Precificado', '#2563EB'),
  ('Cadastrado no portal', '#16A34A'),
  ('Ganha', '#15803D'),
  ('Recurso', '#D97706'),
  ('Perdida', '#DC2626'),
  ('Suspenso', '#CA8A04'),
  ('Cancelada', '#64748B')
on conflict (nome) do nothing;

-- ============================================================
-- ALTERAÇÕES v1.3 — Bloco "Contratos"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================

-- TABELA: contratos (vinculado obrigatoriamente à licitação ganha que o originou)
create table if not exists public.contratos (
  id                      bigserial primary key,
  numero_contrato         text not null,
  licitacao_id            bigint not null references public.licitacoes(id) on delete cascade,
  orgao_id                bigint references public.orgaos(id) on delete set null,
  data_contrato           date,
  data_assinatura         date,
  vigencia_inicio         date,
  vigencia_fim            date,
  viabilidade             text check (viabilidade in ('Viável', 'Inviável', 'Em análise') or viabilidade is null),
  arquivo_url             text,
  prazo_entrega           text,
  prazo_entrega_uteis     boolean not null default false,
  prazo_pagamento         text,
  prazo_pagamento_uteis   boolean not null default false,
  telefone_contato        text,
  email_contato           text,
  situacao                text not null default 'Vigente' check (situacao in ('Vigente', 'Encerrada', 'Cancelada')),
  observacoes             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- TABELA: contrato_itens (sem controle de saldo/consumo — quantidade e valor fixos)
create table if not exists public.contrato_itens (
  id                  bigserial primary key,
  contrato_id         bigint not null references public.contratos(id) on delete cascade,
  item_numero         integer not null default 1,
  produto_id          bigint not null references public.produtos(id) on delete restrict,
  produto_descricao   text,
  marca_fabricante    text,
  modelo_versao       text,
  unidade             text default '1 UN',
  quantidade_total    numeric(14,2) not null default 0,
  valor_unitario      numeric(14,2) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.contratos      enable row level security;
alter table public.contrato_itens enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['contratos', 'contrato_itens']
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''))
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated
                     using (public.get_user_role() = ''administrador'');', t);

    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format('create trigger set_updated_at before update on public.%I
                     for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;

-- depois de rodar este bloco, force o PostgREST a recarregar o schema:
notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.4 — Valor do contrato (assinado)
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================
alter table public.contratos add column if not exists valor_contrato numeric(14,2);

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.5 — Bloco "Empenhos"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Empenho é a etapa de execução financeira que vem depois de uma Ata e/ou de
-- um Contrato (ou pode ser "direto", sem nenhum dos dois). O saldo da Ata
-- passa a ser calculado a partir dos Empenhos vinculados a ela, substituindo
-- o ledger ata_consumos (que continua existindo no banco, mas não é mais
-- usado pela UI para esse cálculo).
-- ============================================================

create table if not exists public.empenhos (
  id                bigserial primary key,
  numero_empenho    text not null,
  ata_id            bigint references public.atas(id) on delete set null,
  contrato_id       bigint references public.contratos(id) on delete set null,
  orgao_id          bigint references public.orgaos(id) on delete set null,
  data_empenho      date,
  valor_empenhado   numeric(14,2),
  situacao          text not null default 'Vigente' check (situacao in ('Vigente', 'Liquidado', 'Anulado')),
  observacoes       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.empenho_itens (
  id                    bigserial primary key,
  empenho_id            bigint not null references public.empenhos(id) on delete cascade,
  item_numero           integer not null default 1,
  produto_id            bigint not null references public.produtos(id) on delete restrict,
  produto_descricao     text,
  quantidade_empenhada  numeric(14,2) not null default 0,
  valor_unitario        numeric(14,2) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.empenhos     enable row level security;
alter table public.empenho_itens enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['empenhos', 'empenho_itens']
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''))
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated
                     using (public.get_user_role() = ''administrador'');', t);

    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format('create trigger set_updated_at before update on public.%I
                     for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.6 — Bloco "Análise de Concorrente"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- As informações da análise (Receita Federal, PNCP, Portal da Transparência)
-- NÃO são armazenadas — são sempre consultadas em tempo real. Só o CNPJ do
-- concorrente (opcional) é persistido, para permitir o atalho "Analisar".
-- ============================================================
alter table public.concorrentes add column if not exists cnpj text;

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.7 — Bloco "Configurações: chave de API e dados de demonstração"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================

-- app_settings: configurações de sistema (ex.: chave da API do Portal da
-- Transparência), editáveis pela tela de Configurações em vez de config.js.
create table if not exists public.app_settings (
  chave       text primary key,
  valor       text,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings for select to authenticated using (true);

drop policy if exists "app_settings_upsert" on public.app_settings;
create policy "app_settings_upsert" on public.app_settings for insert to authenticated
  with check (public.get_user_role() = 'administrador');

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings for update to authenticated
  using (public.get_user_role() = 'administrador')
  with check (public.get_user_role() = 'administrador');

drop trigger if exists set_updated_at on public.app_settings;
create trigger set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- demo_seed_log: rastreia os registros criados pelo gerador de "Dados de
-- demonstração" (Configurações), para permitir remover tudo de uma vez depois.
create table if not exists public.demo_seed_log (
  id            bigserial primary key,
  tabela        text not null,
  registro_id   bigint not null,
  created_at    timestamptz not null default now()
);

alter table public.demo_seed_log enable row level security;

drop policy if exists "demo_seed_log_select" on public.demo_seed_log;
create policy "demo_seed_log_select" on public.demo_seed_log for select to authenticated
  using (public.get_user_role() = 'administrador');

drop policy if exists "demo_seed_log_insert" on public.demo_seed_log;
create policy "demo_seed_log_insert" on public.demo_seed_log for insert to authenticated
  with check (public.get_user_role() = 'administrador');

drop policy if exists "demo_seed_log_delete" on public.demo_seed_log;
create policy "demo_seed_log_delete" on public.demo_seed_log for delete to authenticated
  using (public.get_user_role() = 'administrador');

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.8 — Bloco "Entregas do Empenho" + ajuste de acesso a Configurações
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Próxima etapa do fluxo Ata/Contrato → Empenho → Entregas → Faturamento →
-- Recebimentos. Saldo do item do empenho = quantidade_empenhada menos a soma
-- das entregas já lançadas (nunca armazenado, sempre calculado).
-- ============================================================

-- A página Configurações deixou de ser só-administrador (Usuários virou página
-- própria, admin-only). A chave de API (app_settings) agora pode ser definida
-- por qualquer perfil que não seja "consulta" — mesma regra das demais tabelas
-- operacionais. "Dados de demonstração" continua admin-only (a remoção depende
-- de excluir licitações/contratos/atas/empenhos, e isso é admin-only em todo o
-- sistema), então demo_seed_log não muda.
drop policy if exists "app_settings_upsert" on public.app_settings;
create policy "app_settings_upsert" on public.app_settings for insert to authenticated
  with check (public.get_user_role() in ('administrador', 'usuario'));

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings for update to authenticated
  using (public.get_user_role() in ('administrador', 'usuario'))
  with check (public.get_user_role() in ('administrador', 'usuario'));

create table if not exists public.empenho_entregas (
  id                  bigserial primary key,
  empenho_item_id     bigint not null references public.empenho_itens(id) on delete cascade,
  data_entrega        date not null default current_date,
  quantidade          numeric(14,2) not null default 0,
  numero_nota_fiscal  text,
  observacao          text,
  created_at          timestamptz not null default now()
);

alter table public.empenho_entregas enable row level security;

drop policy if exists "empenho_entregas_select" on public.empenho_entregas;
create policy "empenho_entregas_select" on public.empenho_entregas for select to authenticated using (true);

drop policy if exists "empenho_entregas_insert" on public.empenho_entregas;
create policy "empenho_entregas_insert" on public.empenho_entregas for insert to authenticated
  with check (public.get_user_role() in ('administrador', 'usuario'));

drop policy if exists "empenho_entregas_delete" on public.empenho_entregas;
create policy "empenho_entregas_delete" on public.empenho_entregas for delete to authenticated
  using (public.get_user_role() in ('administrador', 'usuario'));

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.9 — Simplificação de perfis (Administrador/Usuário) +
-- cadastro de usuário pelo próprio app + anexo do Empenho
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Decisão do usuário: só 2 perfis (antes eram 4 — administrador, comercial,
-- financeiro, consulta), com o Administrador liberando, por usuário, quais
-- páginas o Usuário pode acessar. A aplicação dessa permissão é só em
-- nível de UI (menu/navegação), não reescreve RLS por tabela.
-- ============================================================

alter table public.app_profiles add column if not exists paginas_permitidas text[] not null default '{}';

update public.app_profiles set role = 'usuario' where role in ('comercial', 'financeiro', 'consulta');

alter table public.app_profiles drop constraint if exists app_profiles_role_check;
alter table public.app_profiles add constraint app_profiles_role_check check (role in ('administrador', 'usuario'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.app_profiles (id, email, nome, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', new.email), 'usuario')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Cadastro de novo usuário deixou de depender do painel do Supabase: a página
-- "Usuários" do app chama a Edge Function `admin-create-user` (cria o login via
-- auth.admin.createUser usando a service_role key — nunca exposta no cliente —
-- e já grava role/paginas_permitidas em app_profiles). Função publicada via
-- `supabase functions deploy admin-create-user`; código em
-- supabase/functions/admin-create-user/index.ts (ver histórico do projeto).

-- Empenho ganhou upload de arquivo, mesmo padrão do Contrato (bucket
-- "documentos", pasta "Empenho/").
alter table public.empenhos add column if not exists arquivo_url text;

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.10 — "Marcar como lido" no sininho de notificações
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Cada usuário dispensa os alertas (Ata/Contrato/Certidão vencendo, lembrete
-- de Agenda) só para si mesmo — dispensar não afeta o que os outros usuários
-- veem. A chave (tipo, registro_id, data_ref) é amarrada à data do alerta:
-- se o registro for editado com uma nova data, o alerta "renasce" mesmo já
-- tendo sido dispensado antes. Alertas já vencidos ("vencido") sempre voltam
-- a aparecer, mesmo que tenham sido marcados como lidos — não dá pra silenciar
-- de vez algo que já passou do prazo.
-- ============================================================

create table if not exists public.notificacoes_lidas (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null,
  registro_id bigint not null,
  data_ref    date,
  created_at  timestamptz not null default now(),
  unique (user_id, tipo, registro_id, data_ref)
);

alter table public.notificacoes_lidas enable row level security;

drop policy if exists "notificacoes_lidas_select" on public.notificacoes_lidas;
create policy "notificacoes_lidas_select" on public.notificacoes_lidas for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notificacoes_lidas_insert" on public.notificacoes_lidas;
create policy "notificacoes_lidas_insert" on public.notificacoes_lidas for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "notificacoes_lidas_update" on public.notificacoes_lidas;
create policy "notificacoes_lidas_update" on public.notificacoes_lidas for update to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notificacoes_lidas_delete" on public.notificacoes_lidas;
create policy "notificacoes_lidas_delete" on public.notificacoes_lidas for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['app_profiles','orgaos','concorrentes','parceiros','produtos',
                            'licitacoes','licitacao_itens','atas','ata_itens','certidoes']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format('create trigger set_updated_at before update on public.%I
                     for each row execute function public.set_updated_at();', t);
  end loop;
end;
$$;

-- ============================================================
-- RLS — habilitar em todas as tabelas
-- ============================================================
alter table public.app_profiles    enable row level security;
alter table public.orgaos          enable row level security;
alter table public.concorrentes    enable row level security;
alter table public.parceiros       enable row level security;
alter table public.produtos        enable row level security;
alter table public.licitacoes      enable row level security;
alter table public.licitacao_itens enable row level security;
alter table public.atas            enable row level security;
alter table public.ata_itens       enable row level security;
alter table public.ata_consumos    enable row level security;
alter table public.certidoes       enable row level security;
alter table public.documentos      enable row level security;
alter table public.agenda_eventos  enable row level security;

-- app_profiles: todo autenticado vê todos os perfis (equipe interna);
-- só o próprio usuário ou um administrador edita
drop policy if exists "profiles_select" on public.app_profiles;
create policy "profiles_select" on public.app_profiles for select to authenticated using (true);

drop policy if exists "profiles_update" on public.app_profiles;
create policy "profiles_update" on public.app_profiles for update to authenticated
  using (id = auth.uid() or public.get_user_role() = 'administrador')
  with check (id = auth.uid() or public.get_user_role() = 'administrador');

drop policy if exists "profiles_delete" on public.app_profiles;
create policy "profiles_delete" on public.app_profiles for delete to authenticated
  using (public.get_user_role() = 'administrador');

-- ============================================================
-- MACRO de políticas para as tabelas operacionais:
-- select: qualquer autenticado
-- insert/update: qualquer autenticado (administrador ou usuario)
-- delete: apenas 'administrador'
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['orgaos','concorrentes','parceiros','produtos','licitacoes',
                            'licitacao_itens','atas','ata_itens','ata_consumos','certidoes',
                            'documentos','agenda_eventos']
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''))
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated
                     using (public.get_user_role() = ''administrador'');', t);
  end loop;
end;
$$;

-- ============================================================
-- STORAGE: bucket de documentos
-- Execute manualmente em Storage > Create bucket "documentos" (privado),
-- ou via SQL abaixo se a extensão storage já estiver disponível.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists "documentos_storage_select" on storage.objects;
create policy "documentos_storage_select" on storage.objects for select to authenticated
  using (bucket_id = 'documentos');

drop policy if exists "documentos_storage_insert" on storage.objects;
create policy "documentos_storage_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.get_user_role() in ('administrador', 'usuario'));

drop policy if exists "documentos_storage_delete" on storage.objects;
create policy "documentos_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and public.get_user_role() = 'administrador');

-- ============================================================
-- ALTERAÇÕES v1.11 — Bloco "Faturamento e Recebimentos"
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Próxima camada do fluxo financeiro: Ata/Contrato → Empenho → Entregas →
-- Faturamento → Recebimentos. Uma Fatura agrupa uma ou mais Entregas já
-- lançadas (cada Entrega só pode estar em uma Fatura por vez — marcada via
-- empenho_entregas.faturamento_id). Situação "Paga"/"Paga parcialmente" NUNCA
-- é armazenada — é sempre calculada a partir da soma de faturamento_recebimentos
-- contra valor_fatura, mesmo padrão usado no saldo de Ata e de Entrega do
-- Empenho. A coluna "situacao" aqui só guarda o estado manual "Aberta"/"Cancelada".
-- ============================================================

create table if not exists public.faturamentos (
  id              bigserial primary key,
  empenho_id      bigint not null references public.empenhos(id) on delete cascade,
  numero_fatura   text not null,
  data_emissao    date,
  valor_fatura    numeric(14,2) not null default 0,
  situacao        text not null default 'Aberta' check (situacao in ('Aberta', 'Cancelada')),
  observacoes     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.empenho_entregas
  add column if not exists faturamento_id bigint references public.faturamentos(id) on delete set null;

create table if not exists public.faturamento_recebimentos (
  id                  bigserial primary key,
  faturamento_id      bigint not null references public.faturamentos(id) on delete cascade,
  data_recebimento    date not null default current_date,
  valor               numeric(14,2) not null default 0,
  forma_recebimento   text,
  observacao          text,
  created_at          timestamptz not null default now()
);

alter table public.faturamentos              enable row level security;
alter table public.faturamento_recebimentos  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['faturamentos', 'faturamento_recebimentos']
  loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I;', t);
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true);', t);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() in (''administrador'', ''usuario''))
                     with check (public.get_user_role() in (''administrador'', ''usuario''));', t);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated
                     using (public.get_user_role() = ''administrador'');', t);
  end loop;
end;
$$;

drop trigger if exists set_updated_at on public.faturamentos;
create trigger set_updated_at before update on public.faturamentos
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.12 — Anexo da Nota Fiscal no Faturamento
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- Mesmo padrão de anexo já usado em Contrato e Empenho (bucket "documentos",
-- pasta própria, signed URL).
-- ============================================================
alter table public.faturamentos add column if not exists arquivo_url text;

-- ============================================================
-- ALTERAÇÕES v1.13 — Gerador de Atestado de Capacidade Técnica
-- Adiciona campos de endereço e dados do responsável ao órgão
-- (necessários para compor o corpo do atestado automaticamente).
-- Os dados da "Minha Empresa" (fornecedor) são armazenados em
-- app_settings com prefixo "empresa_" — sem nova tabela.
-- ============================================================
alter table public.orgaos
  add column if not exists logradouro        text,
  add column if not exists numero            text,
  add column if not exists complemento       text,
  add column if not exists bairro            text,
  add column if not exists cep               text,
  add column if not exists responsavel_nome  text,
  add column if not exists responsavel_cpf   text,
  add column if not exists responsavel_cargo text;

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.14 — Acervo Técnico por Produto
-- Cria tabela produto_atestados para armazenar atestados de
-- capacidade técnica por produto. Adiciona flags na licitação
-- para indicar se exige acervo e o percentual mínimo requerido.
-- ============================================================

create table if not exists public.produto_atestados (
  id                  bigserial primary key,
  produto_id          bigint not null references public.produtos(id) on delete cascade,
  orgao_emissor       text,
  data_emissao        date,
  quantidade_atestada numeric(14,3) not null,
  numero_empenho      text,
  arquivo_url         text,
  observacoes         text,
  created_at          timestamptz default now()
);

alter table public.produto_atestados enable row level security;

create policy "autenticado pode ler produto_atestados"
  on public.produto_atestados for select to authenticated using (true);

create policy "escritor pode inserir produto_atestados"
  on public.produto_atestados for insert to authenticated with check (true);

create policy "escritor pode atualizar produto_atestados"
  on public.produto_atestados for update to authenticated using (true);

create policy "admin pode excluir produto_atestados"
  on public.produto_atestados for delete to authenticated
  using (public.get_user_role() = 'administrador');

alter table public.licitacoes
  add column if not exists exige_atestado      boolean default false,
  add column if not exists percentual_atestado numeric(5,2) default 50;

-- ALTERAÇÕES v1.13 — Campos de embalagem e fator caixa em produtos
alter table public.produtos
  add column if not exists qtd_embalagem  numeric(14,2),
  add column if not exists unidade_medida text,
  add column if not exists fator_caixa    numeric(14,4);

notify pgrst, 'reload schema';

-- ============================================================
-- ALTERAÇÕES v1.16 — Segurança: impedir escalada de privilégio via self-update
-- Qualquer usuário autenticado podia alterar sua própria coluna `role` em
-- app_profiles via PATCH direto na API REST, passando pela RLS (que só verifica
-- id = auth.uid(), sem restringir colunas). O trigger abaixo bloqueia no banco.
-- Aditivo e idempotente: seguro rodar de novo sobre o banco já em produção.
-- ============================================================

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if (select role from public.app_profiles where id = auth.uid()) <> 'administrador' then
      raise exception 'Somente administradores podem alterar o campo role.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_role_before_update on public.app_profiles;
create trigger protect_role_before_update
  before update on public.app_profiles
  for each row execute function public.protect_profile_role();

-- ============================================================
-- ALTERAÇÕES v1.18 — Habilitação e Monitoramento de Licitações
-- ============================================================

alter table public.licitacoes
  add column if not exists habilitacao_status text default 'Aguardando'
    check (habilitacao_status in ('Aguardando', 'Habilitado', 'Inabilitado')),
  add column if not exists habilitacao_data date,
  add column if not exists habilitacao_impugnacao boolean default false,
  add column if not exists habilitacao_impugnacao_obs text,
  add column if not exists habilitacao_recurso boolean default false,
  add column if not exists habilitacao_recurso_obs text,
  add column if not exists habilitacao_observacoes text,
  add column if not exists monitoramento_status text default 'Em andamento'
    check (monitoramento_status in ('Em andamento', 'Encerrado', 'Suspenso'));

create table if not exists public.habilitacao_documentos (
  id           bigint generated always as identity primary key,
  licitacao_id bigint not null references public.licitacoes(id) on delete cascade,
  nome         text not null,
  status       text not null default 'Pendente'
    check (status in ('Pendente', 'Entregue', 'Dispensado')),
  observacao   text,
  created_at   timestamptz default now()
);

alter table public.habilitacao_documentos enable row level security;
create policy "hab_docs_select" on public.habilitacao_documentos for select to authenticated using (true);
create policy "hab_docs_insert" on public.habilitacao_documentos for insert to authenticated with check (public.get_user_role() in ('administrador', 'usuario'));
create policy "hab_docs_update" on public.habilitacao_documentos for update to authenticated using (public.get_user_role() in ('administrador', 'usuario')) with check (public.get_user_role() in ('administrador', 'usuario'));
create policy "hab_docs_delete" on public.habilitacao_documentos for delete to authenticated using (public.get_user_role() in ('administrador', 'usuario'));

create table if not exists public.monitoramento_tarefas (
  id           bigint generated always as identity primary key,
  licitacao_id bigint not null references public.licitacoes(id) on delete cascade,
  descricao    text not null,
  concluida    boolean not null default false,
  ordem        int default 0,
  created_at   timestamptz default now()
);

alter table public.monitoramento_tarefas enable row level security;
create policy "mon_tarefas_select" on public.monitoramento_tarefas for select to authenticated using (true);
create policy "mon_tarefas_insert" on public.monitoramento_tarefas for insert to authenticated with check (public.get_user_role() in ('administrador', 'usuario'));
create policy "mon_tarefas_update" on public.monitoramento_tarefas for update to authenticated using (public.get_user_role() in ('administrador', 'usuario')) with check (public.get_user_role() in ('administrador', 'usuario'));
create policy "mon_tarefas_delete" on public.monitoramento_tarefas for delete to authenticated using (public.get_user_role() in ('administrador', 'usuario'));

create table if not exists public.monitoramento_historico (
  id             bigint generated always as identity primary key,
  licitacao_id   bigint not null references public.licitacoes(id) on delete cascade,
  data_registro  date not null default current_date,
  descricao      text not null,
  created_at     timestamptz default now()
);

alter table public.monitoramento_historico enable row level security;
create policy "mon_hist_select" on public.monitoramento_historico for select to authenticated using (true);
create policy "mon_hist_insert" on public.monitoramento_historico for insert to authenticated with check (public.get_user_role() in ('administrador', 'usuario'));
create policy "mon_hist_delete" on public.monitoramento_historico for delete to authenticated using (public.get_user_role() in ('administrador', 'usuario'));

notify pgrst, 'reload schema';
