/**
 * Add or update a PDF password for a user.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/add-pdf-password.ts <email> <service> <password>
 *
 * Example:
 *   npx tsx scripts/add-pdf-password.ts nirmontag@gmail.com GOTO 038750493
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { getAllUsersWithTokens } from "@/db/tokens";
import { addPdfPassword } from "@/db/pdf-passwords";
import { getDb } from "@/db/client";

async function main() {
  const [, , email, service, password] = process.argv;

  if (!email || !service || !password) {
    console.error("Usage: npx tsx scripts/add-pdf-password.ts <email> <service> <password>");
    process.exit(1);
  }

  const users = await getAllUsersWithTokens();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No registered user found for email: ${email}`);
    process.exit(1);
  }

  await addPdfPassword(user.user_id, service, password);
  console.log(`✓ Password stored for ${service} (user: ${email})`);
  await getDb().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
