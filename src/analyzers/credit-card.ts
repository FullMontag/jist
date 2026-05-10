import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { Analyzer } from "./types";

const CreditCardTransactionSchema = z.object({
  merchant: z.string().describe("Merchant / business name"),
  category: z.string().describe("English category (e.g. Restaurants, Food & Drink, Fashion, Transport, etc.)"),
  amount: z.number().describe("Transaction amount in native currency"),
  currency: z.string().default("ILS").describe("Currency code: ILS, USD, EUR, etc."),
  date: z.string().describe("Transaction date in YYYY-MM-DD format"),
  cardLast4: z.string().describe("Last 4 digits of the card used"),
});

const CreditCardOutputSchema = z.object({
  cardLast4: z.string().describe("Last 4 digits of the card"),
  statementMonth: z.string().describe("Statement period in YYYY-MM format (use the month of the statement end date)"),
  totalCharged: z.number().default(0).describe("Total amount charged this statement period"),
  transactions: z.array(CreditCardTransactionSchema).default([]),
});

export type CreditCardTransaction = z.infer<typeof CreditCardTransactionSchema>;
export type CreditCardOutput = z.infer<typeof CreditCardOutputSchema>;

export const creditCardAnalyzer: Analyzer<CreditCardOutput> = {
  id: "credit-card",
  name: "Credit Card Statement",
  description: "Extracts transactions from Cal (כאל) credit card statements",
  provider: "anthropic",
  maxTokens: 16000,

  filter(emails: RawEmail[]): RawEmail[] {
    return emails.filter((e) => {
      const from = e.from.toLowerCase();
      if (from.includes("@cal-online.co.il")) return true;
      const text = `${e.subject} ${e.snippet}`.toLowerCase();
      return text.includes("כאל") || (text.includes("cal") && text.includes("חיוב"));
    });
  },

  systemPrompt: `You are a financial data extraction assistant specializing in Israeli credit card statements.

Extract ALL real transactions from the provided Cal (כאל) credit card statement PDF or text.

CRITICAL — SKIP these rows entirely (do NOT include them as transactions):
- Rows where the merchant name IS exactly or starts with "חיוב תקציב" — these are corporate budget reimbursement offset rows that cancel out real charges. Do NOT skip rows just because a column or footnote mentions "חיוב תקציב"; only skip when the merchant/business column itself is "חיוב תקציב ...".
- Any summary or total rows (e.g. "סה״כ לחיוב", totals, subtotals)
- Do NOT skip regular merchant transactions even if they appear alongside "חיוב תקציב" offset rows

For each real transaction extract:
- merchant: the merchant/business name (transliterate or translate to English if in Hebrew)
- category: translate the Hebrew ענף (category) to English — examples:
    מסעדות → Restaurants
    מזון ומשקא → Food & Drink
    אופנה → Fashion
    תחבורה → Transport
    בריאות → Health
    בידור → Entertainment
    קניות → Shopping
    דלק → Fuel
    חינוך → Education
    טלקומוניקציה → Telecom
    If no category is given, use "Other"
- Always classify as Transport: Pango / פנגו, Gett, GOTO / GoTo, Moovit, and any public or shared transport service
- amount: the transaction amount (positive number, in native currency)
- currency: ILS unless another currency is shown
- date: transaction date in YYYY-MM-DD format
- cardLast4: last 4 digits of the card (from the statement header)

Also return:
- cardLast4: the card's last 4 digits
- statementMonth: the statement period end date formatted as YYYY-MM
- totalCharged: the total amount charged this statement period`,

  buildPrompt(emails: RawEmail[]): string {
    const formatted = emails
      .map(
        (e, i) =>
          `--- Document ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body.slice(0, 8000)}`
      )
      .join("\n\n");

    return `Extract all real credit card transactions from this Cal statement. Skip any "חיוב תקציב" reimbursement offset rows.\n\n${formatted}\n\nReturn JSON with: cardLast4, statementMonth (YYYY-MM), totalCharged, and transactions array.`;
  },

  outputSchema: CreditCardOutputSchema,
};
