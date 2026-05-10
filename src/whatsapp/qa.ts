/**
 * Q&A layer: answers the user's natural-language questions about their
 * financial data by loading their transactions from the DB and asking Claude.
 */

import { createProvider } from "@/llm";
import { getLatestTransactions, getLatestTransportMonth } from "@/db/results";
import { getCreditCardTransactions, getCreditCardSummary } from "@/db/credit-card";
import type { CreditCardTransactionRow } from "@/db/credit-card";

function formatCreditCardTransactions(rows: CreditCardTransactionRow[]): string {
  if (rows.length === 0) return "";

  // Group by card + month
  const groups = new Map<string, CreditCardTransactionRow[]>();
  for (const row of rows) {
    const key = `${row.card_last4}|${row.statement_month}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  const parts: string[] = [];
  for (const [key, txns] of groups) {
    const [card, month] = key.split("|") as [string, string];

    // Category totals for this group
    const categoryTotals = new Map<string, number>();
    for (const t of txns) {
      categoryTotals.set(t.category, (categoryTotals.get(t.category) ?? 0) + Number(t.amount));
    }
    const sortedCategories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);

    const lines: string[] = [
      `Card …${card} | ${month}`,
      `  Category breakdown:`,
      ...sortedCategories.map(([cat, total]) => `    ${cat}: ₪${total.toFixed(2)}`),
      `  Transactions:`,
      ...txns.map((t) => {
        const sym = t.currency === "ILS" ? "₪" : t.currency === "USD" ? "$" : t.currency;
        return `    ${String(t.date).slice(0, 10)} ${t.merchant} ${sym}${t.amount} [${t.category}]`;
      }),
    ];
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

function formatTransactions(rows: Awaited<ReturnType<typeof getLatestTransactions>>): string {
  if (rows.length === 0) return "No transactions on record yet.";

  const charges = rows.filter((r) => r.type === "charge");
  const renewals = rows.filter((r) => r.type === "renewal");
  const refunds = rows.filter((r) => r.type === "refund");

  const fmt = (r: (typeof rows)[0]) => {
    const sym = r.currency === "ILS" ? "₪" : r.currency === "USD" ? "$" : r.currency;
    return `  • ${r.service} — ${sym}${r.amount} (${r.date})`;
  };

  const parts: string[] = [];
  if (charges.length) parts.push("CHARGES:\n" + charges.map(fmt).join("\n"));
  if (renewals.length) parts.push("UPCOMING RENEWALS:\n" + renewals.map(fmt).join("\n"));
  if (refunds.length) parts.push("REFUNDS:\n" + refunds.map(fmt).join("\n"));
  return parts.join("\n\n");
}

export async function answerQuestion(userId: string, question: string): Promise<string> {
  const [transactions, transport, creditCardRows] = await Promise.all([
    getLatestTransactions(userId),
    getLatestTransportMonth(userId),
    getCreditCardTransactions(userId, 6),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const txContext = formatTransactions(transactions);
  const transportContext = transport
    ? `TRANSPORT (${String(transport.month).slice(0, 7)}): GoTo ₪${transport.goto_spend}, Rav-Kav ₪${transport.rav_kav_spend}`
    : "";
  const creditCardContext = creditCardRows.length > 0
    ? `CREDIT CARD TRANSACTIONS:\n${formatCreditCardTransactions(creditCardRows)}`
    : "";

  const systemPrompt = [
    `You are Jist, a personal CFO assistant. Today is ${today}.`,
    `Answer the user's question based only on their financial data below.`,
    `Be concise — this is a WhatsApp reply. No markdown, no bullet symbols, plain text only.`,
    `Reply in the same language as the user (Hebrew or English).`,
    `If the data doesn't contain enough information to answer, say so briefly.`,
    ``,
    `FINANCIAL DATA:`,
    txContext,
    transportContext,
    creditCardContext,
  ].filter(Boolean).join("\n");

  const provider = createProvider("anthropic");
  return provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: question }],
    temperature: 0.3,
    maxTokens: 512,
  });
}
