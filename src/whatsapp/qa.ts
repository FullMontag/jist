/**
 * Q&A layer: answers the user's natural-language questions about their
 * financial data by loading their transactions from the DB and asking Claude.
 */

import { createProvider } from "@/llm";
import { getLatestTransactions, getLatestTransportMonth } from "@/db/results";

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
  const [transactions, transport] = await Promise.all([
    getLatestTransactions(userId),
    getLatestTransportMonth(userId),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const txContext = formatTransactions(transactions);
  const transportContext = transport
    ? `TRANSPORT (${transport.month.slice(0, 7)}): GoTo ₪${transport.goto_spend}, Rav-Kav ₪${transport.rav_kav_spend}`
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
  ].filter(Boolean).join("\n");

  const provider = createProvider("anthropic");
  return provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: question }],
    temperature: 0.3,
    maxTokens: 512,
  });
}
