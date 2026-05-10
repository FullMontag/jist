import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "@/db/client";

async function main() {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS credit_card_transactions (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          TEXT        NOT NULL,
      card_last4       TEXT        NOT NULL,
      statement_month  TEXT        NOT NULL,
      merchant         TEXT        NOT NULL,
      category         TEXT        NOT NULL,
      amount           NUMERIC     NOT NULL,
      currency         TEXT        NOT NULL DEFAULT 'ILS',
      date             DATE        NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, card_last4, date, merchant, amount)
    )
  `;

  console.log("✓ credit_card_transactions table ready");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
