import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { google } from "googleapis";
import { fetchEmailsSince } from "@/gmail/fetcher";
import { subscriptionsAnalyzer } from "@/analyzers/subscriptions";
import { runAnalyzer } from "@/analyzers/types";
import { createProvider } from "@/llm";
import type { SubscriptionOutput } from "@/analyzers/subscriptions";

async function main() {
  console.log("\nFetching emails (last 90 days)...");
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const emails = await fetchEmailsSince(auth, 90, 500);
  console.log(`${emails.length} emails fetched, running subscriptions analyzer...\n`);

  const result = await runAnalyzer(subscriptionsAnalyzer, emails, createProvider("anthropic"));

  if (!result) {
    console.log("No subscription-related emails found in the last 30 days.");
    return;
  }

  const output = result.output as SubscriptionOutput;

  if (output.subscriptions.length === 0) {
    console.log("No subscriptions or charges extracted.");
  } else {
    const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
    const header = `${"Service".padEnd(32)} ${"Amount".padStart(8)}  ${"Currency".padEnd(8)} ${"Cycle".padEnd(10)} ${"Date".padEnd(12)} ${"Category".padEnd(12)} Trial`;
    const divider = "─".repeat(header.length);

    console.log(divider);
    console.log(header);
    console.log(divider);

    for (const s of output.subscriptions) {
      const trial = s.isTrial ? "yes" : "";
      console.log(
        `${col(s.service, 32)} ${String(s.amount.toFixed(2)).padStart(8)}  ${col(s.currency, 8)} ${col(s.billingCycle, 10)} ${col(s.date, 12)} ${col(s.category, 12)} ${trial}`
      );
    }

    console.log(divider);
    console.log(`${"TOTAL".padEnd(32)} ${String(output.totalSpend.toFixed(2)).padStart(8)}`);
    console.log(divider);
  }

  console.log(`\nSummary: ${output.summary}`);
  console.log(`\n${result.emailsProcessed} emails matched the subscriptions filter.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
