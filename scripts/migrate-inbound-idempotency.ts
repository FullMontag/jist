import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "../src/db/client";

async function main() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS processed_inbound_emails (
      email_id   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("✓ processed_inbound_emails table ready");
}
main().catch(console.error);
