import { z } from "zod";
import type { RawEmail } from "@/gmail/fetcher";
import type { Analyzer } from "./types";

const SUBSCRIPTION_KEYWORDS = [
  // English billing terms
  "subscription",
  "billing",
  "receipt",
  "invoice",
  "payment",
  "charge",
  "renewed",
  "renewal",
  "plan",
  "monthly",
  "annual",
  "billed",
  "your order",
  "thank you for your purchase",
  // Hebrew billing terms
  "חשבונית",
  "חיוב",
  "קבלה",
  "תשלום",
  "חידוש",
  "חשבון",
  // Israeli telecom & utilities
  "pelephone.co.il",
  "bezeq.co.il",
  "hot.net.il",
  "hotmobile.co.il",
  "partner.co.il",
  "cellcom.co.il",
  "yes.co.il",
  "019mobile.co.il",
  "iec.co.il",
  "פלאפון",
  "בזק",
  "הוט",
  "פרטנר",
  "סלקום",
  "חברת חשמל",
  // Israeli insurance
  "migdal.co.il",
  "harel.co.il",
  "clal.co.il",
  "phoenix.co.il",
  "menora.co.il",
  "מגדל",
  "הראל",
  "כלל ביטוח",
  "הפניקס",
  "מנורה",
  "ביטוח",
  // Israeli banks & finance
  "leumi.co.il",
  "hapoalim.co.il",
  "mizrahi-tefahot.co.il",
  "discountbank.co.il",
  "max.co.il",
  "cal-online.co.il",
  "isracard.co.il",
  // Other Israeli billing senders
  "invoice4u.co.il",
  "gotoglobal.com",
  "cardcom.co.il",
  "apple.com",
  "gov.il",
  "arnona",
  "ארנונה",
  "ועד בית",
];

const SubscriptionSchema = z.object({
  subscriptions: z.array(
    z.object({
      service: z.string().describe("Name of the service or product"),
      amount: z.number().describe("Amount charged — use the native currency amount as-is"),
      currency: z.string().default("ILS").describe("Currency code: ILS, USD, EUR, etc."),
      billingCycle: z.enum(["monthly", "annual", "one-time", "unknown"]),
      date: z.string().describe("ISO date string of the charge"),
      category: z
        .enum(["software", "media", "utility", "finance", "shopping", "other"])
        .default("other"),
      isTrial: z.boolean().default(false),
    })
  ).default([]),
  totalSpend: z.number().default(0).describe("Sum of all charges in their native amounts (do not convert)"),
  summary: z.string().default("").describe("1-2 sentence plain English summary"),
});

export type SubscriptionOutput = z.infer<typeof SubscriptionSchema>;

export const subscriptionsAnalyzer: Analyzer<SubscriptionOutput> = {
  id: "subscriptions",
  name: "Subscriptions & Billing",
  description: "Extracts recurring subscription charges and one-time purchases",
  provider: "anthropic",

  filter(emails: RawEmail[]): RawEmail[] {
    const lower = (s: string) => s.toLowerCase();
    return emails.filter((e) => {
      const text = lower(`${e.subject} ${e.from} ${e.snippet}`);
      return SUBSCRIPTION_KEYWORDS.some((kw) => text.includes(kw));
    });
  },

  systemPrompt: `You are a financial data extraction assistant. Extract every subscription charge and billing event from the emails provided.

Key rules:
- Report amounts in their NATIVE currency (ILS, USD, EUR) — do not convert
- Apple invoices ("Your invoice from Apple") may contain multiple line items (e.g. "Claude by Anthropic ₪88", "iCloud+ ₪3.90") — extract EACH line item as a separate subscription entry
- For Apple invoices, look through the full body for individual app/service charges listed under the account
- If an email contains both a subtotal and individual items, extract the individual items (not the total)
- Omit any item where the amount cannot be determined`,

  buildPrompt(emails: RawEmail[]): string {
    const formatted = emails
      .map(
        (e, i) =>
          `--- Email ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nSnippet: ${e.snippet}\nBody:\n${e.body.slice(0, 3000)}`
      )
      .join("\n\n");

    return `Extract all subscription charges and billing events from these emails:\n\n${formatted}\n\nReturn JSON with: subscriptions array, totalSpend, and summary.`;
  },

  outputSchema: SubscriptionSchema,
};
