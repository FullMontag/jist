import { Resend } from "resend";

export async function sendDigest(to: string, html: string, weekOf: Date): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM_ADDRESS = process.env.DIGEST_FROM_EMAIL;
  if (!FROM_ADDRESS) {
    throw new Error("DIGEST_FROM_EMAIL env var is not set — add it to Vercel dashboard and .env.local");
  }
  const label = weekOf.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your Jist — week of ${label}`,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
