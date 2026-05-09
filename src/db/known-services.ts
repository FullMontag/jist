import { getDb } from "./client";

// Extract a short, matchable keyword from a verbose service name.
// "GOTO Global Mobility - 'DRIVE' Membership" → ["goto global mobility - 'drive' membership", "goto"]
function serviceToKeywords(serviceName: string): string[] {
  const normalized = serviceName.toLowerCase().trim();
  const keywords = [normalized];
  const firstWord = normalized.split(/[\s\-_'".]+/).find((w) => w.length >= 4);
  if (firstWord && !keywords.includes(firstWord)) keywords.push(firstWord);
  return keywords;
}

export async function addKnownServices(
  userId: string,
  serviceNames: string[]
): Promise<void> {
  if (serviceNames.length === 0) return;
  const sql = getDb();
  const keywords = [...new Set(serviceNames.flatMap(serviceToKeywords))];
  for (const kw of keywords) {
    await sql`
      insert into user_known_services (user_id, keyword)
      values (${userId}, ${kw})
      on conflict do nothing
    `;
  }
}

export async function getKnownServiceKeywords(userId: string): Promise<string[]> {
  const sql = getDb();
  const rows = await sql<{ keyword: string }[]>`
    select keyword from user_known_services where user_id = ${userId}
  `;
  return rows.map((r) => r.keyword);
}
