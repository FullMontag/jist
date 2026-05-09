import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "@/db/client";

async function main() {
  const sql = getDb();
  await sql`
    create table if not exists user_known_services (
      user_id text not null,
      keyword  text not null,
      primary key (user_id, keyword)
    )
  `;
  console.log("✓ user_known_services table ready");
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
