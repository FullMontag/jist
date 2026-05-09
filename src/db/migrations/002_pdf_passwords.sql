create table if not exists pdf_passwords (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  service      text not null,           -- human label, e.g. "GOTO"
  password_enc text not null,           -- AES-256-GCM: "iv:authTag:ciphertext" (hex)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, service)
);

create trigger pdf_passwords_updated_at
  before update on pdf_passwords
  for each row execute procedure update_updated_at();
