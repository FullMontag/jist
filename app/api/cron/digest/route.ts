import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedClient } from "@/gmail/oauth";
import { renderDigest } from "@/email/renderer";
import { sendDigest } from "@/email/sender";
import { getAllUsersWithTokens, getGmailTokens, saveDigestRun, hasDigestRuns } from "@/db";
import { getDb } from "@/db/client";
import { runPipeline } from "@/pipeline";

// POST /api/cron/digest — called by Vercel Cron every Sunday
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await getAllUsersWithTokens();
  const processed: string[] = [];
  const errors: string[] = [];

  for (const { user_id, email } of users) {
    console.log(`[cron] Starting digest for ${email}`);
    try {
      const tokenRow = await getGmailTokens(user_id);
      if (!tokenRow) {
        console.warn(`[cron] No token row found for ${email} — skipping`);
        continue;
      }

      // Warn if refresh token is missing (re-auth required)
      if (!tokenRow.refresh_token) {
        console.error(`[cron] No refresh_token for ${email} — user must re-authenticate`);
        errors.push(`${email}: missing refresh_token — re-auth required`);
        await saveDigestRun(user_id, 0, "failed", "missing refresh_token").catch(() => {});
        continue;
      }

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
      console.log(`[cron] ${email}: isFirstRun=${isFirstRun}, daysBack=${daysBack}`);

      const { emailsFetched, results } = await runPipeline(user_id, auth, daysBack);
      console.log(`[cron] ${email}: fetched ${emailsFetched} emails, ${results.length} analyzer results`);

      const status = results.length > 0 ? "success" : "partial";
      await saveDigestRun(user_id, emailsFetched, status);

      const html = await renderDigest(user_id);
      await sendDigest(email, html, new Date());

      console.log(`[cron] ${email}: digest sent ✓`);
      processed.push(email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface token expiry clearly — this is the most common failure mode
      const isTokenExpiry = msg.includes("invalid_grant") || msg.includes("Token has been expired");
      const fullMsg = isTokenExpiry
        ? `OAuth token expired — user must re-authenticate at /api/auth/gmail: ${msg}`
        : msg;
      console.error(`[cron] FAILED for ${email}:`, fullMsg);
      errors.push(`${email}: ${fullMsg}`);
      await saveDigestRun(user_id, 0, "failed", fullMsg).catch(() => {});
    }
  }

  if (errors.length > 0) {
    console.error("[cron] Completed with errors:", errors);
  }

  return NextResponse.json({ ok: true, processed, errors });
}

// GET /api/cron/digest — returns recent digest run history (auth required)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const rows = await sql<{
    id: string;
    user_id: string;
    emails_fetched: number;
    status: string;
    error: string | null;
    created_at: string;
  }[]>`
    SELECT id, user_id, emails_fetched, status, error, created_at
    FROM digest_runs
    ORDER BY created_at DESC
    LIMIT 20
  `;

  return NextResponse.json({ runs: rows });
}
