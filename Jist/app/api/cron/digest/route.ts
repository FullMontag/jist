import { NextRequest, NextResponse } from "next/server";
import { fetchEmailsSince } from "@/gmail/fetcher";
import { createAuthenticatedClient } from "@/gmail/oauth";
import { ANALYZERS, runAnalyzer } from "@/analyzers";
import { createProvider } from "@/llm";
import { renderDigestHtml } from "@/digest";
import { getAllUsersWithTokens, getGmailTokens, saveDigestRun, saveAnalyzerResults } from "@/db";
import type { AnalyzerResult } from "@/analyzers/types";

// POST /api/cron/digest — called by Vercel Cron every Sunday
export async function POST(request: NextRequest) {
  // Validate the cron secret so only Vercel can trigger this
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await getAllUsersWithTokens();

  const processed: string[] = [];
  const errors: string[] = [];

  for (const { user_id, email } of users) {
    try {
      const tokenRow = await getGmailTokens(user_id);
      if (!tokenRow) continue;

      const auth = createAuthenticatedClient({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      const emails = await fetchEmailsSince(auth, 7);

      const results: AnalyzerResult[] = [];

      for (const analyzer of ANALYZERS) {
        const provider = createProvider(analyzer.provider);
        const result = await runAnalyzer(analyzer, emails, provider);
        if (result) results.push(result as AnalyzerResult);
      }

      const status = results.length > 0 ? "success" : "partial";
      const runId = await saveDigestRun(user_id, emails.length, status);
      await saveAnalyzerResults(runId, user_id, results);

      const html = renderDigestHtml({
        userEmail: email,
        weekOf: new Date(),
        emailsFetched: emails.length,
        results,
      });

      // TODO: send HTML via email provider (Resend, SendGrid, etc.)
      console.log(`Digest rendered for ${email} (${html.length} bytes)`);

      processed.push(email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${email}: ${msg}`);
      await saveDigestRun(user_id, 0, "failed", msg).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    errors,
  });
}
