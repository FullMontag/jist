/**
 * Verifies the Postgres connection and schema, then inserts/reads/deletes a test transaction.
 * Usage: npx tsx scripts/test-schema.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getDb } from "@/db/client";

const TEST_USER = "test-user@jist.app";

async function main() {
  const sql = getDb();
  const tables = ["gmail_tokens", "digest_runs", "analyzer_results", "transactions", "transportation_monthly", "user_config"];

  console.log("\n1. Checking tables...\n");
  for (const table of tables) {
    await sql`SELECT id FROM ${sql(table)} LIMIT 1`;
    console.log(`   ✓ ${table}`);
  }

  console.log("\n2. Inserting dummy transaction...\n");
  await sql`
    INSERT INTO gmail_tokens (user_id, email, access_token)
    VALUES (${TEST_USER}, ${TEST_USER}, 'test')
    ON CONFLICT (user_id) DO NOTHING
  `;

  const inserted = await sql<{ id: string; service: string; amount: string; currency: string; date: string }[]>`
    INSERT INTO transactions (user_id, service, amount, currency, date, type, analyzer_id)
    VALUES (${TEST_USER}, 'Test Service', 9.99, 'USD', ${new Date().toISOString().split("T")[0]}, 'charge', 'subscriptions')
    RETURNING id, service, amount, currency, date
  `;
  const tx = inserted[0];
  console.log(`   Inserted id: ${tx.id}`);
  console.log(`   ${tx.service} · $${tx.amount} ${tx.currency} · ${tx.date}`);

  console.log("\n3. Reading it back...\n");
  const fetched = await sql<{ service: string; type: string }[]>`
    SELECT service, type FROM transactions WHERE id = ${tx.id}
  `;
  console.log(`   ✓ Verified: ${fetched[0].service} · ${fetched[0].type}`);

  console.log("\n4. Cleaning up...\n");
  await sql`DELETE FROM transactions WHERE id = ${tx.id}`;
  await sql`DELETE FROM gmail_tokens WHERE user_id = ${TEST_USER}`;
  console.log("   ✓ Deleted test rows");

  console.log("\nSchema test passed.\n");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
