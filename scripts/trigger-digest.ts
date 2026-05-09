/**
 * scripts/trigger-digest.ts
 *
 * Manually fire the digest pipeline for all users — useful after re-authing
 * or to verify the pipeline is working without waiting for Sunday's cron.
 *
 * Usage (run from project root):
 *   set -a && source .env.local && set +a && npx tsx scripts/trigger-digest.ts
 *
 * Or with Node 20.6+:
 *   node --env-file=.env.local --import=tsx/esm scripts/trigger-digest.ts
 *
 * Note: `dotenv/config` and `config({ path: ".env.local" })` both work, but ESM
 * import hoisting means the shell-export approach above is most reliable.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createAuthenticatedClient } from "../src/gmail/oauth";
import { renderDigest } from "../src/email/renderer";
import { sendDigest } from "../src/email/sender";
import {
  getAllUsersWithTokens,
  getGmailTokens,
  saveDigestRun,
  hasDigestRuns,
} from "../src/db";
import { runPipeline } from "../src/pipeline";

// tsx runs in CJS mode — never use top-level await
async function main() {
  const users = await getAllUsersWithTokens();

  if (users.length === 0) {
    console.log("No users with tokens found. Complete the OAuth flow first:");
    console.log("  npx next dev → open http://localhost:3000/api/auth/gmail");
    process.exit(0);
  }

  console.log(`Found ${users.length} user(s): ${users.map((u) => u.email).join(", ")}\n`);

  for (const { user_id, email } of users) {
    console.log(`── Processing ${email} ──`);

    const tokenRow = await getGmailTokens(user_id);
    if (!tokenRow) {
      console.error(`  ✗ No token row in DB for ${email}`);
      continue;
    }

    if (!tokenRow.refresh_token) {
      console.error(`  ✗ Missing refresh_token for ${email}`);
      console.error(`    → Re-authenticate: open http://localhost:3000/api/auth/gmail`);
      continue;
    }

    const expiry = tokenRow.expiry_date;
    const isExpired = expiry ? Date.now() > expiry : false;
    const hoursLeft = expiry ? Math.round((expiry - Date.now()) / 36e5) : null;
    if (isExpired) {
      console.warn(`  ⚠ Access token expired — will auto-refresh via refresh_token`);
    } else if (hoursLeft !== null) {
      console.log(`  Access token valid for ~${hoursLeft}h`);
    }

    try {
      const auth = createAuthenticatedClient(
        {
          access_token: tokenRow.access_token,
          refresh_token: tokenRow.refresh_token,
          expiry_date: tokenRow.expiry_date,
        },
        user_id
      );

      const isFirstRun = !(await hasDigestRuns(user_id));
      const daysBack = isFirstRun ? 90 : 7;
      console.log(`  Scanning last ${daysBack} days of email (isFirstRun=${isFirstRun})...`);

      const { emailsFetched, results } = await runPipeline(user_id, auth, daysBack);
      console.log(`  Fetched ${emailsFetched} emails → ${results.length} analyzer results`);

      const status = results.length > 0 ? "success" : "partial";
      await saveDigestRun(user_id, emailsFetched, status);

      console.log(`  Rendering digest...`);
      const html = await renderDigest(user_id);

      console.log(`  Sending to ${email}...`);
      await sendDigest(email, html, new Date());

      console.log(`  ✓ Digest sent!\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTokenErr = msg.includes("invalid_grant") || msg.includes("Token has been expired");

      console.error(`  ✗ Failed: ${msg}`);
      if (isTokenErr) {
        console.error(`    → Refresh token expired (Google Testing mode = 7-day limit).`);
        console.error(`    → Re-authenticate: open http://localhost:3000/api/auth/gmail`);
      }

      await saveDigestRun(user_id, 0, "failed", msg).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
