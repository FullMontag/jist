import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { getDb } from "@/db/client";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: tsx scripts/set-display-name.ts <name>");
    process.exit(1);
  }

  const sql = getDb();

  // Get all user IDs
  const users = await sql<{ user_id: string }[]>`SELECT user_id FROM gmail_tokens`;
  if (users.length === 0) {
    console.error("No users found");
    process.exit(1);
  }

  for (const { user_id } of users) {
    await sql`
      INSERT INTO user_config (user_id, key, value)
      VALUES (${user_id}, 'display_name', ${JSON.stringify(name)})
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
    console.log(`Set display_name = "${name}" for ${user_id}`);
  }

  await sql.end();
}

main().catch(console.error);
