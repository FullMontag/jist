-- Jist initial schema
-- Run this in the Supabase SQL editor to set up all tables.

-- Stores Gmail OAuth tokens per user (keyed by email address)
create table if not exists gmail_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         text unique not null,   -- email address
  email           text not null,
  access_token    text not null,
  refresh_token   text,
  expiry_date     bigint,                 -- unix ms
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per weekly digest run per user
create table if not exists digest_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null references gmail_tokens(user_id),
  ran_at          timestamptz not null default now(),
  emails_fetched  integer not null,
  status          text not null check (status in ('success', 'partial', 'failed')),
  error           text
);

-- Structured output from each analyzer, per digest run
create table if not exists analyzer_results (
  id                uuid primary key default gen_random_uuid(),
  digest_run_id     uuid not null references digest_runs(id),
  user_id           text not null,
  analyzer_id       text not null,       -- 'subscriptions' | 'renewals' | 'opportunities'
  emails_processed  integer not null,
  output            jsonb not null,
  created_at        timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists analyzer_results_user_analyzer
  on analyzer_results(user_id, analyzer_id, created_at desc);

create index if not exists digest_runs_user_id
  on digest_runs(user_id, ran_at desc);

-- Auto-update updated_at on gmail_tokens
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger gmail_tokens_updated_at
  before update on gmail_tokens
  for each row execute function set_updated_at();
