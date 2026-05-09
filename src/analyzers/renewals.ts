import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { Analyzer } from "./types";

const RENEWAL_KEYWORDS = [
  "renew",
  "renewal",
  "expires",
  "expiring",
  "expiration",
  "auto-renew",
  "auto renew",
  "upcoming charge",
  "will be charged",
  "cancellation",
  "cancel",
  "trial ending",
  "trial expires",
  "membership",
];

const RenewalsSchema = z.object({
  renewals: z.array(
    z.object({
      service: z.string(),
      renewalDate: z.string().describe("ISO date string"),
      amount: z.number().nullable(),
      currency: z.string().default("USD"),
      status: z.enum(["upcoming", "cancelled", "failed", "trial-ending"]),
      actionRequired: z.boolean().describe("True if user needs to act"),
      actionDescription: z.string().nullable().describe("What action is needed, if any"),
    })
  ).default([]),
  urgent: z.array(z.string()).default([]).describe("Service names requiring immediate attention"),
  summary: z.string().default(""),
});

export type RenewalsOutput = z.infer<typeof RenewalsSchema>;

export const renewalsAnalyzer: Analyzer<RenewalsOutput> = {
  id: "renewals",
  name: "Renewals & Expirations",
  description: "Tracks upcoming renewals, cancellations, and expiring trials",
  provider: "anthropic",

  filter(emails: RawEmail[]): RawEmail[] {
    const lower = (s: string) => s.toLowerCase();
    return emails.filter((e) => {
      const text = lower(`${e.subject} ${e.from} ${e.snippet} ${e.body.slice(0, 500)}`);
      return RENEWAL_KEYWORDS.some((kw) => text.includes(kw));
    });
  },

  systemPrompt: `You are a financial assistant that tracks subscription renewals and expirations.
Focus on upcoming dates, cancelled services, failed payments, and trials about to end.
Flag anything the user needs to act on. Always respond with valid JSON.`,

  buildPrompt(emails: RawEmail[]): string {
    const formatted = emails
      .map(
        (e, i) =>
          `--- Email ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body.slice(0, 1500)}`
      )
      .join("\n\n");

    return `Identify all renewal notices, expiring trials, and cancellation confirmations:\n\n${formatted}\n\nToday's date is ${new Date().toISOString().split("T")[0]}. Return JSON with renewals, urgent list, and summary.`;
  },

  outputSchema: RenewalsSchema,
};
