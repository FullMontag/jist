-- Jist extended schema
-- Run this in the Supabase SQL editor after 0001_initial_schema.sql.

-- Replace analyzer_results with a simpler schema (no digest_run_id dependency)
drop table if exists analyzer_results cascade;

create table analyzer_results (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  analyzer_id text        not null,
  run_date    timestamptz not null default now(),
  raw_output  jsonb       not null,
  created_at  timestamptz not null default now()
);

create index analyzer_results_user_analyzer
  on analyzer_results(user_id, analyzer_id, created_at desc);

-- Normalized financial transactions extracted from analyzer output
create table if not exists transactions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  service     text        not null,
  amount      numeric(12, 2) not null,
  currency    text        not null default 'ILS',
  date        date        not null,
  type        text        not null check (type in ('charge', 'renewal', 'refund')),
  analyzer_id text        not null,
  created_at  timestamptz not null default now()
);

create index transactions_user_date
  on transactions(user_id, date desc);

-- Monthly transportation spend summary (GoTo, Rav Kav, etc.)
create table if not exists transportation_monthly (
  id            uuid           primary key default gen_random_uuid(),
  user_id       text           not null,
  month         date           not null,  -- always the 1st of the month
  goto_spend    numeric(12, 2) not null default 0,
  rav_kav_spend numeric(12, 2) not null default 0,
  total         numeric(12, 2) not null default 0,
  created_at    timestamptz    not null default now(),
  unique(user_id, month)
);

-- User preferences and configuration (key-value)
create table if not exists user_config (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  unique(user_id, key)
);

create or replace trigger user_config_updated_at
  before update on user_config
  for each row execute function set_updated_at();
