/**
 * Runs all analyzers against 90 days of real Gmail, saves results to Supabase,
 * and prints a summary of everything stored.
 *
 * Usage: npx tsx scripts/run-analyzers.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { google } from "googleapis";
import { runPipeline, extractTransportation } from "@/pipeline";
import type { TransactionRow } from "@/db";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { OpportunitiesOutput } from "@/analyzers/opportunities";

// ── Formatting helpers ────────────────────────────────────────────────────────

const divider = "─".repeat(88);
const col = (s: string, w: number) => (s ?? "").slice(0, w).padEnd(w);

function printSection(title: string) {
  console.log(`\n${"━".repeat(88)}`);
  console.log(`  ${title}`);
  console.log(`${"━".repeat(88)}`);
}

function printTransactions(rows: TransactionRow[]) {
  if (rows.length === 0) { console.log("  No transactions extracted."); return; }
  console.log(`  ${"Service".padEnd(34)} ${"Amount".padStart(8)}  ${"Curr".padEnd(5)} ${"Date".padEnd(12)} Type`);
  console.log(`  ${divider}`);
  for (const r of rows) {
    console.log(`  ${col(r.service, 34)} ${r.amount.toFixed(2).padStart(8)}  ${col(r.currency, 5)} ${col(r.date, 12)} ${r.type}`);
  }
  console.log(`  ${divider}`);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  console.log(`  ${"TOTAL".padEnd(34)} ${total.toFixed(2).padStart(8)}`);
}

function printRenewals(output: RenewalsOutput) {
  if (output.renewals.length === 0) { console.log("  None found."); return; }
  if (output.urgent.length) console.log(`  ⚠  Urgent: ${output.urgent.join(", ")}\n`);
  for (const r of output.renewals) {
    const amt = r.amount != null ? `${r.currency} ${r.amount.toFixed(2)}` : "amount unknown";
    console.log(`  • ${r.service} — ${r.renewalDate} — ${amt} — ${r.status}`);
    if (r.actionRequired && r.actionDescription) console.log(`    → ${r.actionDescription}`);
  }
}

function printOpportunities(output: OpportunitiesOutput) {
  if (output.opportunities.length === 0) { console.log("  None found."); return; }
  for (const o of output.opportunities) {
    const val = o.estimatedValue != null ? `~$${o.estimatedValue.toFixed(0)}` : "value unknown";
    console.log(`  • [${o.type}] ${o.title} — ${val}`);
    console.log(`    ${o.description}`);
  }
  console.log(`\n  Total potential value: $${output.totalPotentialValue.toFixed(0)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data: me } = await oauth2.userinfo.get();
  const userId = me.email!;

  console.log(`\nUser: ${userId}`);
  console.log("Fetching emails (last 90 days) and running analyzers...\n");

  const { results, transactions, emailsFetched } = await runPipeline(userId, auth, 90, 500);
  const transport = extractTransportation(userId, transactions);

  printSection("CHARGES & SUBSCRIPTIONS");
  const subResult = results.find((r) => r.analyzerId === "subscriptions");
  if (subResult) {
    printTransactions(transactions.filter((t) => t.analyzerId === "subscriptions"));
  } else {
    console.log("  No matching emails.");
  }

  printSection("UPCOMING RENEWALS & EXPIRATIONS");
  const renResult = results.find((r) => r.analyzerId === "renewals");
  if (renResult) {
    printRenewals(renResult.output as RenewalsOutput);
  } else {
    console.log("  No matching emails.");
  }

  printSection("FINANCIAL OPPORTUNITIES");
  const oppResult = results.find((r) => r.analyzerId === "opportunities");
  if (oppResult) {
    printOpportunities(oppResult.output as OpportunitiesOutput);
  } else {
    console.log("  No matching emails.");
  }

  printSection("STORED TRANSACTIONS");
  printTransactions(transactions);

  if (transport.length > 0) {
    console.log("\n  Transportation monthly:");
    for (const t of transport) {
      console.log(`  ${t.month}  GoTo: ${t.gotoSpend.toFixed(2)}  Moovit/Rav Kav: ${t.ravKavSpend.toFixed(2)}`);
    }
  }

  console.log(`\n${"━".repeat(88)}\n`);
  console.log(`Done. ${emailsFetched} emails · ${results.length} analyzer results · ${transactions.length} transactions · ${transport.length} transport month(s) saved.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
