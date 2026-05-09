import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
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

async function sendWhatsApp(to: string, body: string): Promise<void> {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const from = process.env.TWILIO_WHATSAPP_NUMBER!;
  await client.messages.create({
    from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    to,
    body,
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
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("This number isn't registered with Jist.");
    return new NextResponse(twiml.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const mediaItems = Array.from({ length: numMedia }, (_, i) => ({
    url: params[`MediaUrl${i}`] ?? "",
    contentType: params[`MediaContentType${i}`] ?? "",
  })).filter((m) => m.url);

  // Respond to Twilio immediately — processing happens after the response
  after(async () => {
    try {
      const reply = await processWhatsAppMessage(user.user_id, { from, body, mediaItems });
      await sendWhatsApp(from, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[whatsapp/inbound] Processing error:", err);
      await sendWhatsApp(from, `Something went wrong: ${message}`).catch(() => {});
    }
  });

  // Empty TwiML — actual reply sent via API above
  return new NextResponse("<Response/>", { headers: { "Content-Type": "text/xml" } });
}
