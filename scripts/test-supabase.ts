/**
 * Verifies the Postgres connection and that all tables exist.
 * Usage: npx tsx scripts/test-supabase.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getDb } from "@/db/client";

const TABLES = ["gmail_tokens", "digest_runs", "analyzer_results", "transactions", "transportation_monthly", "user_config"];

async function main() {
  const sql = getDb();
  console.log("\nChecking Postgres connection...\n");

  for (const table of TABLES) {
    await sql`SELECT id FROM ${sql(table)} LIMIT 1`;
    console.log(`  ✓ ${table}`);
  }

  console.log("\nPostgres connection works.\n");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
