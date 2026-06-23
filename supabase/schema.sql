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
-- insert/update: qualquer autenticado, exceto role 'consulta'
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
                     with check (public.get_user_role() <> ''consulta'');', t);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated
                     using (public.get_user_role() <> ''consulta'')
                     with check (public.get_user_role() <> ''consulta'');', t);

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
  with check (bucket_id = 'documentos' and public.get_user_role() <> 'consulta');

drop policy if exists "documentos_storage_delete" on storage.objects;
create policy "documentos_storage_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and public.get_user_role() = 'administrador');
