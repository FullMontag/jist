/**
 * End-to-end test: fetch real Gmail → run subscriptions analyzer → save to Postgres.
 * Usage: npx tsx scripts/test-analyzer.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { google } from "googleapis";
import { fetchEmailsSince } from "@/gmail/fetcher";
import { subscriptionsAnalyzer } from "@/analyzers/subscriptions";
import { runAnalyzer } from "@/analyzers/types";
import { createProvider } from "@/llm";
import { saveGmailTokens, saveDigestRun, saveAnalyzerResults } from "@/db";
import { getDb } from "@/db/client";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, ANTHROPIC_API_KEY } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error("Missing Google credentials in .env.local"); process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env.local"); process.exit(1);
}

async function main() {
  const USER_ID = "test-user";

  console.log("\n1. Fetching emails from Gmail (last 30 days)...");
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const emails = await fetchEmailsSince(auth, 30);
  console.log(`   Fetched ${emails.length} emails.`);

  console.log("\n2. Running subscriptions analyzer...");
  const llm = createProvider("anthropic");
  const result = await runAnalyzer(subscriptionsAnalyzer, emails, llm);

  if (!result) {
    console.log("   No subscription-related emails found."); return;
  }
  console.log(`   Processed ${result.emailsProcessed} relevant emails.`);
  console.log("\n   Output:");
  console.log(JSON.stringify(result.output, null, 2));

  console.log("\n3. Saving to Postgres...");
  await saveGmailTokens(USER_ID, USER_ID, { access_token: "test" });
  const runId = await saveDigestRun(USER_ID, emails.length, "success");
  await saveAnalyzerResults(USER_ID, [result]);
  console.log(`   Saved. digest_run id: ${runId}`);

  console.log("\nEnd-to-end test passed.\n");
  await getDb().end();
}

main().catch((err) => { console.error(err); process.exit(1); });
