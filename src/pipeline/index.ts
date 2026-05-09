import type { OAuth2Client } from "google-auth-library";
import { fetchEmailsSince } from "@/gmail/fetcher";
import { ANALYZERS, runAnalyzer } from "@/analyzers";
import { createProvider } from "@/llm";
import {
  saveAnalyzerResults,
  saveTransactions,
  clearUserTransactions,
  saveTransportationMonthly,
} from "@/db";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";
import type { RenewalsOutput } from "@/analyzers/renewals";
import type { OpportunitiesOutput } from "@/analyzers/opportunities";
import type { AnalyzerResult } from "@/analyzers/types";
import type { TransactionRow } from "@/db";

// ── Transaction extractors ────────────────────────────────────────────────────

export function fromSubscriptions(output: SubscriptionOutput): TransactionRow[] {
  return (output.subscriptions ?? [])
    .filter((s) => s.amount > 0 && s.date)
    .map((s) => ({
      service: s.service,
      amount: s.amount,
      currency: s.currency,
      date: s.date,
      type: "charge" as const,
      analyzerId: "subscriptions",
    }));
}

export function fromRenewals(output: RenewalsOutput): TransactionRow[] {
  return (output.renewals ?? [])
    .filter((r) => r.amount != null && r.amount > 0 && r.renewalDate)
    .map((r) => ({
      service: r.service,
      amount: r.amount!,
      currency: r.currency,
      date: r.renewalDate,
      type: "renewal" as const,
      analyzerId: "renewals",
    }));
}

export function fromOpportunities(output: OpportunitiesOutput): TransactionRow[] {
  return (output.opportunities ?? [])
    .filter((o) => o.type === "refund" && o.estimatedValue != null && o.estimatedValue > 0)
    .map((o) => ({
      service: o.source,
      amount: o.estimatedValue!,
      currency: "USD",
      date: new Date().toISOString().split("T")[0]!,
      type: "refund" as const,
      analyzerId: "opportunities",
    }));
}

// ── Deduplication ─────────────────────────────────────────────────────────────
// Same service + same date from two analyzers → keep ILS, drop the USD duplicate.

function normalizeService(s: string): string {
  return s.toLowerCase().replace(/\s*\(.*?\)/g, "").trim().slice(0, 24);
}

export function deduplicateTransactions(rows: TransactionRow[]): TransactionRow[] {
  const map = new Map<string, TransactionRow>();
  for (const row of rows) {
    const key = `${normalizeService(row.service)}|${row.date}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
    } else if (row.currency === "ILS" && existing.currency !== "ILS") {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

// ── Transportation extraction ─────────────────────────────────────────────────

const GOTO_PATTERNS = ["goto", "go-to", "gotoglobal", "גו-טו"];
const RAVKAV_PATTERNS = ["moovit", "pango", "rav kav", "רב-קו", "רב קו"];

export function extractTransportation(
  userId: string,
  rows: TransactionRow[]
): { userId: string; month: string; gotoSpend: number; ravKavSpend: number }[] {
  const monthly = new Map<string, { goto: number; ravKav: number }>();

  for (const row of rows) {
    const svc = row.service.toLowerCase();
    const month = row.date.slice(0, 7) + "-01";

    const isGoto = GOTO_PATTERNS.some((p) => svc.includes(p));
    const isRavKav = RAVKAV_PATTERNS.some((p) => svc.includes(p));
    if (!isGoto && !isRavKav) continue;

    if (!monthly.has(month)) monthly.set(month, { goto: 0, ravKav: 0 });
    const entry = monthly.get(month)!;
    if (isGoto) entry.goto += row.amount;
    if (isRavKav) entry.ravKav += row.amount;
  }

  return Array.from(monthly.entries()).map(([month, v]) => ({
    userId,
    month,
    gotoSpend: v.goto,
    ravKavSpend: v.ravKav,
  }));
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  results: AnalyzerResult[];
  transactions: TransactionRow[];
  emailsFetched: number;
}

export async function runPipeline(
  userId: string,
  auth: OAuth2Client,
  daysBack: number,
  maxResults = 200
): Promise<PipelineResult> {
  const emails = await fetchEmailsSince(auth, daysBack, maxResults);
  const allResults: AnalyzerResult[] = [];
  const allTransactions: TransactionRow[] = [];

  for (const analyzer of ANALYZERS) {
    const provider = createProvider(analyzer.provider);
    const result = await runAnalyzer(analyzer, emails, provider);
    if (!result) continue;

    allResults.push(result as AnalyzerResult);

    switch (result.analyzerId) {
      case "subscriptions":
        allTransactions.push(...fromSubscriptions(result.output as SubscriptionOutput));
        break;
      case "renewals":
        allTransactions.push(...fromRenewals(result.output as RenewalsOutput));
        break;
      case "opportunities":
        allTransactions.push(...fromOpportunities(result.output as OpportunitiesOutput));
        break;
    }
  }

  const transactions = deduplicateTransactions(allTransactions);
  const transport = extractTransportation(userId, transactions);

  await clearUserTransactions(userId);
  await saveAnalyzerResults(userId, allResults);
  await saveTransactions(userId, transactions);
  for (const t of transport) {
    await saveTransportationMonthly(t.userId, t.month, t.gotoSpend, t.ravKavSpend);
  }

  return { results: allResults, transactions, emailsFetched: emails.length };
}
