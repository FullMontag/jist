-- Jist schema — run once against a fresh Postgres database.

create table if not exists gmail_tokens (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        unique not null,
  email         text        not null,
  access_token  text        not null,
  refresh_token text,
  expiry_date   bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists digest_runs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        text        not null references gmail_tokens(user_id),
  ran_at         timestamptz not null default now(),
  emails_fetched integer     not null,
  status         text        not null check (status in ('success', 'partial', 'failed')),
  error          text
);

create table if not exists analyzer_results (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  analyzer_id text        not null,
  run_date    timestamptz not null default now(),
  raw_output  jsonb       not null,
  created_at  timestamptz not null default now()
);

create table if not exists transactions (
  id          uuid           primary key default gen_random_uuid(),
  user_id     text           not null,
  service     text           not null,
  amount      numeric(12, 2) not null,
  currency    text           not null default 'ILS',
  date        date           not null,
  type        text           not null check (type in ('charge', 'renewal', 'refund')),
  analyzer_id text           not null,
  created_at  timestamptz    not null default now()
);

create table if not exists transportation_monthly (
  id            uuid           primary key default gen_random_uuid(),
  user_id       text           not null,
  month         date           not null,
  goto_spend    numeric(12, 2) not null default 0,
  rav_kav_spend numeric(12, 2) not null default 0,
  total         numeric(12, 2) not null default 0,
  created_at    timestamptz    not null default now(),
  unique(user_id, month)
);

create table if not exists user_config (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  unique(user_id, key)
);

create index if not exists analyzer_results_user_analyzer
  on analyzer_results(user_id, analyzer_id, created_at desc);

create index if not exists digest_runs_user_id
  on digest_runs(user_id, ran_at desc);

create index if not exists transactions_user_date
  on transactions(user_id, date desc);

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

create or replace trigger user_config_updated_at
  before update on user_config
  for each row execute function set_updated_at();
