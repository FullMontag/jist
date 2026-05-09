import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "@/db/client";

async function main() {
  const sql = getDb();

  await sql`
    create table if not exists pdf_passwords (
      id           uuid primary key default gen_random_uuid(),
      user_id      text not null,
      service      text not null,
      password_enc text not null,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now(),
      unique (user_id, service)
    )
  `;

  // Create the shared trigger function if it doesn't already exist
  await sql`
    create or replace function update_updated_at()
    returns trigger language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$
  `;

  await sql`
    create or replace trigger pdf_passwords_updated_at
      before update on pdf_passwords
      for each row execute procedure update_updated_at()
  `;

  console.log("✓ pdf_passwords table ready");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
