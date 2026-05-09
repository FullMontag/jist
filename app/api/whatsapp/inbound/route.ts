import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getUserByWhatsAppNumber } from "@/db/user-phones";
import { processWhatsAppMessage } from "@/whatsapp/processor";

function verifySignature(req: NextRequest, params: Record<string, string>): boolean {
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = `${process.env.NEXTAUTH_URL}/api/whatsapp/inbound`;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params
  );
}

function twimlReply(text: string): NextResponse {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(text);
  return new NextResponse(twiml.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  if (!verifySignature(req, params)) {
    console.warn("[whatsapp/inbound] Invalid Twilio signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = params.From ?? "";
  const body = params.Body ?? "";
  const numMedia = parseInt(params.NumMedia ?? "0", 10);

  console.log(`[whatsapp/inbound] Message from ${from}: "${body.slice(0, 80)}"`);

  const user = await getUserByWhatsAppNumber(from);
  if (!user) {
    console.warn(`[whatsapp/inbound] Unknown sender: ${from}`);
    return twimlReply("This number isn't registered with Jist. Ask your Jist admin to add it.");
  }

  const mediaItems = Array.from({ length: numMedia }, (_, i) => ({
    url: params[`MediaUrl${i}`] ?? "",
    contentType: params[`MediaContentType${i}`] ?? "",
  })).filter((m) => m.url);

  try {
    const reply = await processWhatsAppMessage(user.user_id, { from, body, mediaItems });
    return twimlReply(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp/inbound] Processing error:", err);
    return twimlReply(`Something went wrong: ${message}`);
  }
}
