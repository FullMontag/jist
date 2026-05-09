import { NextResponse } from "next/server";
import { getAuthUrl } from "@/gmail/oauth";

// GET /api/auth/gmail — redirect to Google consent screen
export async function GET() {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
