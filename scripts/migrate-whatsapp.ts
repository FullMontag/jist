import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "@/db/client";

async function main() {
  const sql = getDb();
  await sql`
    ALTER TABLE gmail_tokens
    ADD COLUMN IF NOT EXISTS whatsapp_number text
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS gmail_tokens_whatsapp_number_idx
    ON gmail_tokens (whatsapp_number)
    WHERE whatsapp_number IS NOT NULL
  `;
  console.log("✓ whatsapp_number column added to gmail_tokens");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
