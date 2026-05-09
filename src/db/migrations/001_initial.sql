-- Run this in the Supabase SQL editor to set up the schema

create extension if not exists "pgcrypto";

-- Gmail OAuth tokens per user
create table if not exists gmail_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null unique,
  access_token text not null,
  refresh_token text,
  expiry_date bigint,
  email       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Each weekly digest run
create table if not exists digest_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  ran_at        timestamptz not null default now(),
  emails_fetched int not null default 0,
  status        text not null check (status in ('success', 'partial', 'failed')),
  error         text
);

-- Per-analyzer outputs stored for trend tracking
create table if not exists analyzer_results (
  id              uuid primary key default gen_random_uuid(),
  digest_run_id   uuid not null references digest_runs(id) on delete cascade,
  user_id         text not null,
  analyzer_id     text not null,
  emails_processed int not null default 0,
  output          jsonb not null,
  created_at      timestamptz not null default now()
);

create index on analyzer_results (user_id, analyzer_id, created_at desc);
create index on digest_runs (user_id, ran_at desc);

-- Auto-update updated_at on gmail_tokens
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger gmail_tokens_updated_at
  before update on gmail_tokens
  for each row execute procedure update_updated_at();
