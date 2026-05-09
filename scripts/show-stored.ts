import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { getDb } from "@/db/client";

async function main() {
  const sql = getDb();
  const tables = ["gmail_tokens", "digest_runs", "analyzer_results", "transactions", "transportation_monthly", "user_config"] as const;

  console.log("\n── Table counts ─────────────────────────────");
  for (const t of tables) {
    const rows = await sql`SELECT count(*)::int AS n FROM ${sql(t)}`;
    console.log(`  ${t.padEnd(28)} ${String(rows[0].n).padStart(4)} row(s)`);
  }

  const results = await sql<{ analyzer_id: string; created_at: string }[]>`
    SELECT analyzer_id, created_at FROM analyzer_results ORDER BY created_at DESC
  `;

  console.log("\n── Analyzer runs ────────────────────────────");
  if (!results.length) {
    console.log("  No analyzer results found.");
  } else {
    const byAnalyzer = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.analyzer_id] = (acc[r.analyzer_id] ?? 0) + 1;
      return acc;
    }, {});
    for (const [id, count] of Object.entries(byAnalyzer)) {
      console.log(`  ${id.padEnd(24)} ${count} run(s)`);
    }
    console.log(`  Last run: ${results[0].created_at}`);
  }

  const txs = await sql<{ type: string; amount: string; currency: string; service: string; date: string }[]>`
    SELECT type, amount, currency, service, date FROM transactions ORDER BY amount DESC
  `;

  console.log("\n── Transactions stored ──────────────────────");
  if (!txs.length) {
    console.log("  No transactions found.");
  } else {
    const byType = txs.reduce<Record<string, number>>((acc, t) => {
      acc[t.type] = (acc[t.type] ?? 0) + 1;
      return acc;
    }, {});
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type.padEnd(12)} ${count} transaction(s)`);
    }
    const total = txs.reduce((s, t) => s + Number(t.amount), 0);
    console.log(`  Total spend stored: $${total.toFixed(2)} USD-equivalent`);

    console.log("\n── Top charges by amount ────────────────────");
    for (const t of txs.slice(0, 5)) {
      console.log(`  ${String(t.amount).padStart(8)} ${t.currency.padEnd(5)}  ${t.service}`);
    }
    const largest = txs[0];
    console.log("\n── Most interesting finding ─────────────────");
    console.log(`  Largest charge: ${largest.service}`);
    console.log(`  Amount: ${largest.amount} ${largest.currency}`);
    console.log(`  Date: ${largest.date} · Type: ${largest.type}`);
  }

  console.log("\n─────────────────────────────────────────────\n");
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
