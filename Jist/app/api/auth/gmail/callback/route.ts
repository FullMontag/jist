import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { exchangeCodeForTokens, createAuthenticatedClient } from "@/gmail/oauth";
import { saveGmailTokens } from "@/db/tokens";

// GET /api/auth/gmail/callback?code=...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code parameter" }, { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const auth = createAuthenticatedClient(tokens);

    // Fetch the user's email address to use as a stable user_id
    const oauth2 = google.oauth2({ version: "v2", auth });
    const { data: profile } = await oauth2.userinfo.get();
    const email = profile.email!;

    await saveGmailTokens(email, email, tokens);

    return NextResponse.redirect(new URL("/?connected=true", request.url));
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=oauth_failed", request.url));
  }
}
