import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { Analyzer } from "./types";

const OPPORTUNITY_KEYWORDS = [
  "cashback",
  "cash back",
  "reward",
  "bonus",
  "refund",
  "credit",
  "earn",
  "points",
  "miles",
  "referral",
];

// Signals that indicate an existing account relationship (transactional email)
const TRANSACTIONAL_SIGNALS = [
  "invoice",
  "receipt",
  "order",
  "billing",
  "subscription",
  "payment",
  "account",
  "confirmation",
  "your purchase",
  "your subscription",
  "charge",
  "renewal",
  // Hebrew billing terms
  "חשבונית",
  "קבלה",
  "תשלום",
  "חיוב",
];

function extractRootDomain(from: string): string {
  const match = from.match(/@([\w.-]+)/);
  if (!match) return "";
  const parts = match[1].split(".");
  return parts.slice(-2).join(".");
}

function buildTrustedDomains(allEmails: RawEmail[]): Set<string> {
  const trusted = new Set<string>();
  for (const email of allEmails) {
    const text = `${email.subject} ${email.snippet}`.toLowerCase();
    if (TRANSACTIONAL_SIGNALS.some((s) => text.includes(s))) {
      const domain = extractRootDomain(email.from);
      if (domain) trusted.add(domain);
    }
  }
  return trusted;
}

const OpportunitiesSchema = z.object({
  opportunities: z.array(
    z.object({
      title: z.string().describe("Short title of the opportunity"),
      source: z.string().describe("Company or sender"),
      type: z.enum(["cashback", "discount", "referral", "refund", "upgrade", "bonus", "other"]),
      estimatedValue: z.number().nullable().describe("Estimated value in the email's currency"),
      currency: z.string().default("ILS").describe("Currency of the estimated value"),
      expiryDate: z.string().nullable().describe("ISO date string of the deadline"),
      description: z.string().describe("1-2 sentence description"),
      actionUrl: z.string().nullable().describe("Link to claim if mentioned in email"),
    })
  ).default([]),
  totalPotentialValue: z.number().default(0).describe("Sum of all estimatedValues"),
  summary: z.string().default(""),
});

export type OpportunitiesOutput = z.infer<typeof OpportunitiesSchema>;

export const opportunitiesAnalyzer: Analyzer<OpportunitiesOutput> = {
  id: "opportunities",
  name: "Financial Opportunities",
  description: "Identifies cashback offers, refunds, and time-sensitive personal rewards",
  provider: "anthropic",

  filter(emails: RawEmail[]): RawEmail[] {
    const trusted = buildTrustedDomains(emails);
    const lower = (s: string) => s.toLowerCase();
    return emails.filter((e) => {
      const text = lower(`${e.subject} ${e.from} ${e.snippet}`);
      const hasKeyword = OPPORTUNITY_KEYWORDS.some((kw) => text.includes(kw));
      if (!hasKeyword) return false;
      const domain = extractRootDomain(e.from);
      return trusted.has(domain);
    });
  },

  systemPrompt: `You are a personal finance assistant identifying actionable financial opportunities.

Apply ALL THREE criteria — reject anything that fails even one:
1. PERSONALLY ADDRESSED: the email mentions the recipient by name, or refers to their specific account, balance, or transaction history. Generic "member" or "subscriber" does NOT count.
2. DEADLINE WITHIN 30 DAYS: there is an explicit expiry or claim-by date within 30 days of today's date (provided in the prompt). Vague "limited time" without a date does NOT count.
3. KNOWN SERVICE: the sender is a service the recipient actively uses — a bank, telecom, utility, or subscription they already pay for. Newsletter deal roundups, affiliate promotions, and third-party deal sites do NOT count regardless of value.

Automatically reject:
- Newsletter digests promoting third-party software deals (F6S, AppSumo, etc.)
- Generic upgrade or referral offers without personalization and a hard deadline
- Educational course discounts from newsletters
- Promotional emails from services the user has never interacted with`,

  buildPrompt(emails: RawEmail[]): string {
    const today = new Date().toISOString().split("T")[0];
    const formatted = emails
      .map(
        (e, i) =>
          `--- Email ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body.slice(0, 1500)}`
      )
      .join("\n\n");

    return `Today is ${today}. Find personally relevant, time-sensitive financial opportunities in these emails — apply the three strict criteria from your instructions:\n\n${formatted}\n\nReturn JSON with opportunities, totalPotentialValue, and summary.`;
  },

  outputSchema: OpportunitiesSchema,
};
