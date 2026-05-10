import { getDb } from "./client";
import type { AnalyzerResult } from "@/analyzers/types";
import type { TransactionDbRow, TransportationMonthlyRow, AnalyzerResultRow } from "./schema";

export async function saveDigestRun(
  userId: string,
  emailsFetched: number,
  status: "success" | "partial" | "failed",
  error?: string
): Promise<string> {
  const sql = getDb();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO digest_runs (user_id, emails_fetched, status, error)
    VALUES (${userId}, ${emailsFetched}, ${status}, ${error ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function saveAnalyzerResults(userId: string, results: AnalyzerResult[]) {
  if (results.length === 0) return;
  const sql = getDb();
  await Promise.all(
    results.map((r) => sql`
      INSERT INTO analyzer_results (user_id, analyzer_id, raw_output)
      VALUES (${userId}, ${r.analyzerId}, ${JSON.stringify(r.output)})
    `)
  );
}

export interface TransactionRow {
  service: string;
  amount: number;
  currency: string;
  date: string;
  type: "charge" | "renewal" | "refund";
  analyzerId: string;
}

export async function saveTransactions(userId: string, rows: TransactionRow[]) {
  if (rows.length === 0) return;
  const sql = getDb();
  await Promise.all(
    rows.map((r) => sql`
      INSERT INTO transactions (user_id, service, amount, currency, date, type, analyzer_id)
      VALUES (${userId}, ${r.service}, ${r.amount}, ${r.currency}, ${r.date}, ${r.type}, ${r.analyzerId})
      ON CONFLICT (user_id, service, date, type) DO NOTHING
    `)
  );
}

export async function clearUserTransactions(userId: string) {
  const sql = getDb();
  await sql`DELETE FROM transactions WHERE user_id = ${userId}`;
}

export async function saveTransportationMonthly(
  userId: string,
  month: string,
  gotoSpend: number,
  ravKavSpend: number
) {
  const sql = getDb();
  const total = gotoSpend + ravKavSpend;
  await sql`
    INSERT INTO transportation_monthly (user_id, month, goto_spend, rav_kav_spend, total)
    VALUES (${userId}, ${month}, ${gotoSpend}, ${ravKavSpend}, ${total})
    ON CONFLICT (user_id, month) DO UPDATE SET
      goto_spend    = EXCLUDED.goto_spend,
      rav_kav_spend = EXCLUDED.rav_kav_spend,
      total         = EXCLUDED.total
  `;
}

export async function getLatestTransactions(userId: string): Promise<TransactionDbRow[]> {
  const sql = getDb();
  return sql<TransactionDbRow[]>`
    SELECT * FROM transactions
    WHERE user_id = ${userId}
    ORDER BY date DESC
  `;
}

export async function getLatestTransportMonth(userId: string): Promise<TransportationMonthlyRow | null> {
  const sql = getDb();
  const rows = await sql<TransportationMonthlyRow[]>`
    SELECT * FROM transportation_monthly
    WHERE user_id = ${userId}
    ORDER BY month DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function hasDigestRuns(userId: string): Promise<boolean> {
  const sql = getDb();
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM digest_runs WHERE user_id = ${userId} LIMIT 1
  `;
  return (rows[0]?.n ?? 0) > 0;
}

export async function getAnalyzerHistory(userId: string, analyzerId: string, limit = 12): Promise<Pick<AnalyzerResultRow, "raw_output" | "created_at">[]> {
  const sql = getDb();
  return sql<Pick<AnalyzerResultRow, "raw_output" | "created_at">[]>`
    SELECT raw_output, created_at FROM analyzer_results
    WHERE user_id = ${userId} AND analyzer_id = ${analyzerId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
