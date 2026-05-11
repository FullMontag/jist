import { getDb } from "./client";
import type { CreditCardTransaction } from "@/analyzers/credit-card";

export interface CreditCardTransactionRow {
  id: string;
  user_id: string;
  card_last4: string;
  statement_month: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  date: string;
  created_at: string;
}

export async function saveCreditCardTransactions(
  userId: string,
  cardLast4: string,
  statementMonth: string,
  transactions: CreditCardTransaction[]
): Promise<void> {
  if (transactions.length === 0) return;
  const sql = getDb();
  await Promise.all(
    transactions.map((t) => sql`
      INSERT INTO credit_card_transactions
        (user_id, card_last4, statement_month, merchant, category, amount, currency, date)
      VALUES
        (${userId}, ${cardLast4}, ${statementMonth}, ${t.merchant}, ${t.category}, ${t.amount}, ${t.currency}, ${t.date})
      ON CONFLICT (user_id, card_last4, date, merchant, amount) DO NOTHING
    `)
  );
}

export async function getCreditCardTransactions(
  userId: string,
  limitMonths?: number
): Promise<CreditCardTransactionRow[]> {
  const sql = getDb();
  if (limitMonths != null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - limitMonths);
    const cutoffStr = cutoff.toISOString().split("T")[0]!;
    return sql<CreditCardTransactionRow[]>`
      SELECT * FROM credit_card_transactions
      WHERE user_id = ${userId}
        AND date >= ${cutoffStr}
      ORDER BY date DESC
    `;
  }
  return sql<CreditCardTransactionRow[]>`
    SELECT * FROM credit_card_transactions
    WHERE user_id = ${userId}
    ORDER BY date DESC
  `;
}

export async function getCategoryTrends(userId: string): Promise<{
  current: { category: string; total: number; count: number }[];
  previous: { category: string; total: number; count: number }[];
  currentMonth: string;
  previousMonth: string;
}> {
  const sql = getDb();
  const months = await sql<{ statement_month: string }[]>`
    SELECT DISTINCT statement_month
    FROM credit_card_transactions
    WHERE user_id = ${userId}
    ORDER BY statement_month DESC
    LIMIT 2
  `;
  const [cur, prev] = months;
  if (!cur) return { current: [], previous: [], currentMonth: "", previousMonth: "" };
  const [current, previous] = await Promise.all([
    getCreditCardSummary(userId, cur.statement_month),
    prev ? getCreditCardSummary(userId, prev.statement_month) : Promise.resolve([]),
  ]);
  return {
    current,
    previous,
    currentMonth: cur.statement_month,
    previousMonth: prev?.statement_month ?? "",
  };
}

export async function getCreditCardSummary(
  userId: string,
  month: string
): Promise<{ category: string; total: number; count: number }[]> {
  const sql = getDb();
  return sql<{ category: string; total: number; count: number }[]>`
    SELECT
      category,
      SUM(amount)::numeric  AS total,
      COUNT(*)::int         AS count
    FROM credit_card_transactions
    WHERE user_id = ${userId}
      AND statement_month = ${month}
    GROUP BY category
    ORDER BY total DESC
  `;
}
