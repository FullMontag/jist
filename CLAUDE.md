Project: Jist — Personal CFO Assistant
What it does: Reads Gmail, extracts financial insights via modular analyzers, delivers a weekly HTML email digest every Sunday. Users can also forward bills and invoices directly to Jist via a dedicated inbound email address or WhatsApp — both feed the same extraction pipeline and update the financial profile in real time. Israeli market first (ILS currency, Hebrew email support).

Tech stack:
- Next.js + TypeScript on Vercel
- Gmail API (OAuth2, Web application client, loopback redirect) for email ingestion
- Anthropic SDK (claude-sonnet-4-6) as LLM — model-agnostic abstraction layer; vision used for bill photos
- Zod v4 for output schema validation per analyzer (z.toJSONSchema() for tool use)
- Vercel Postgres (Neon, Frankfurt region) for storing extracted data over time
- Resend for digest email delivery + inbound email webhook
- Twilio for WhatsApp inbound/outbound (media download, reply) — not yet implemented
- Vercel Cron for Sunday digest trigger

Architecture:

Scheduled (weekly):
Gmail fetch → PDF enrichment → Analyzer Registry (+ user keywords) → LLM Router → Zod Validator → Postgres → Digest Renderer → Resend

On-demand inbound — two channels, same extraction core:
WhatsApp photo/PDF → /api/whatsapp/inbound → Media Fetcher → Document Extractor → LLM → Postgres → WhatsApp reply  [NOT YET BUILT]
Forwarded email      → /api/email/inbound   → Attachment Parser → PDF decrypt → LLM → Postgres → email reply

Analyzer registry pattern: Each analyzer is a config object with id, filter(), systemPrompt, buildPrompt(), and outputSchema (Zod). Adding a use case = adding one object.
LLM abstraction: Provider interface so any model can plug in. Currently Anthropic only.

Credentials (all in .env.local):
- ANTHROPIC_API_KEY ✓
- GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN ✓ (Web application OAuth client, loopback http://127.0.0.1:3000 redirect)
- POSTGRES_URL ✓ (Neon connection string, also set in Vercel)
- RESEND_API_KEY ✓ (must be Full Access — send-only keys can't fetch received email content)
- RESEND_WEBHOOK_SECRET ✓ (from Resend dashboard → Webhooks → signing secret)
- CRON_SECRET ✓
- NEXTAUTH_SECRET ✓
- DIGEST_FROM_EMAIL ✓
- PDF_PASSWORD_KEY ✓ (32-byte hex, AES-256-GCM key for encrypting stored PDF passwords)

IMPORTANT — Gmail OAuth:
- Must use Web application client type (NOT Desktop app). Desktop app silently drops gmail.readonly restricted scope from consent screen.
- Redirect URI: http://127.0.0.1:3000 (loopback) for local scripts. Production callback: https://jist-ashen.vercel.app/api/auth/gmail/callback (must be registered in Google Cloud Console).
- OAuth app is currently in "Testing" mode — refresh tokens auto-expire every 7 days. To re-auth: visit https://jist-ashen.vercel.app/api/auth/gmail (or run `npx next dev` locally and hit http://localhost:3000/api/auth/gmail).
- Token refresh persistence: createAuthenticatedClient() in src/gmail/oauth.ts listens to the `tokens` event and saves refreshed credentials back to the DB automatically. Pass userId as the second argument or refresh events will be silently dropped.
- Scripts use `tsx` in CJS mode — NEVER use top-level await. Always wrap in `async function main() {}` + `main().catch()`.
- Scripts load env via `import { config } from "dotenv"; config({ path: ".env.local" })` at the top — do NOT rely on shell export.

IMPORTANT — Vercel env vars (must match .env.local exactly):
- ANTHROPIC_API_KEY
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (no GOOGLE_REFRESH_TOKEN needed — tokens live in DB)
- POSTGRES_URL
- RESEND_API_KEY (Full Access — not send-only)
- DIGEST_FROM_EMAIL  ← CRITICAL: without this sender.ts throws. Once velir.dev is verified, change to jist@velir.dev
- RESEND_WEBHOOK_SECRET
- CRON_SECRET
- NEXTAUTH_SECRET
- NEXTAUTH_URL=https://jist-ashen.vercel.app
- PDF_PASSWORD_KEY  ← 32-byte hex AES-256 key for pdf_passwords table

Do not: install OpenAI SDK, use `any` types, hardcode credentials, write to Windows filesystem paths.

---

## Live Deployment

- **URL:** https://jist-ashen.vercel.app
- **Cron:** POST /api/cron/digest, Sundays 8am UTC (11am Israel time), Bearer auth via CRON_SECRET
- **Inbound email:** forward@istaakren.resend.app → Resend webhook → /api/email/inbound
- **velir.dev inbound:** MX records added to Porkbun, verification pending — once verified, add second Resend route forward@velir.dev → same webhook (no code changes)
- **Email sender:** Resend, currently from onboarding@resend.dev (sandbox — no custom domain yet)
- **DB:** Vercel Postgres / Neon, Frankfurt region

---

## What's Built and Working

### Gmail fetcher (src/gmail/fetcher.ts)
- Uses `newer_than:${sinceDays}d` query syntax
- Filters out social + promotions categories
- HTML stripping: removes `<style>`, `<script>`, tags, HTML entities, collapses whitespace
- Prefers text/plain, falls back to text/html, recurses into multipart parts
- Populates `pdfAttachmentIds` for emails that have PDF attachments (for downstream enrichment)

### Gmail PDF enrichment (src/gmail/attachments.ts)
- `enrichEmailsWithPdfText()`: for emails with body < 300 chars + PDF attachments, fetches bytes from Gmail API
- Decrypts encrypted PDFs using stored passwords (see pdf_passwords table)
- Appends extracted text to email body before filtering — weekly digest reads PDFs automatically

### PDF utilities (src/email/pdf-decrypt.ts)
- `isEncryptedPdf(buf)`: checks for `/Encrypt` marker in bytes — zero dependencies, instant
- `extractPdfText(buf, passwords[])`: uses `unpdf` (serverless-safe pdfjs wrapper) — no @napi-rs/canvas required
- `unpdf` and `pdfjs-dist` both in `serverExternalPackages` in next.config.ts

### PDF password storage (src/db/pdf-passwords.ts)
- `pdf_passwords` table: user_id, service label, AES-256-GCM encrypted password
- `src/crypto/pdf-passwords.ts`: encrypt/decrypt with PDF_PASSWORD_KEY env var
- Add passwords: `npx tsx scripts/add-pdf-password.ts <email> <service> <password>`
- All stored passwords are tried on every encrypted PDF (no service-name matching needed — just try all)

### LLM layer (src/llm/)
- AnthropicProvider.completeStructured() uses Anthropic tool use (NOT prompt-based JSON):
  - z.toJSONSchema(schema) as tool input_schema
  - tool_choice: { type: "tool", name: "structured_output" }
  - Extracts toolUse.input, parses with Zod schema
- Supports multimodal: ImageContentBlock (vision) and DocumentContentBlock (native PDF) alongside text
- Required: prompt-based JSON produced wrong field names and failed Zod validation

### Analyzers (src/analyzers/)
Three analyzers working end-to-end:

1. **subscriptions** — extracts charges/billing events
   - Filter: SUBSCRIPTION_KEYWORDS (Hebrew + English billing terms) OR sender domain in ISRAELI_SENDER_DOMAINS
   - ISRAELI_SENDER_DOMAINS (src/analyzers/israeli-senders.ts): ~350 .co.il domains covering telecom, banks, credit cards, insurance, pension, utilities, healthcare (4 kupot holim), gov, 20+ municipalities, transport, retail, pharma, media, food delivery, SaaS, universities, billing platforms
   - System prompt instructs Claude to extract each Apple invoice line item separately

2. **renewals** — upcoming renewals and expirations
   - Detects renewal/expiry signals, outputs renewalDate + status + urgency

3. **opportunities** — cashback, refunds, time-sensitive rewards
   - Three strict criteria: personally addressed, deadline within 30 days, known service

### Adaptive learning (src/db/known-services.ts)
- `user_known_services` table: service names from inbound emails become per-user filter keywords
- `serviceToKeywords()`: extracts full name + first meaningful word ("GOTO Global Mobility" → ["goto global mobility", "goto"])
- `runAnalyzer` accepts `userKeywords[]` — emails matching learned services included even if not in static list
- Inbound processor saves service names after each successful extraction
- Weekly pipeline loads user keywords before running analyzers

### Inbound email processor (src/email/inbound-processor.ts)
- Fetches full email from `GET /emails/receiving/{id}` (Resend API — Full Access key required)
- Resend attachment flow: metadata endpoint returns `download_url` → fetch that URL for actual bytes
- Handles: plain text, HTML bodies, inline base64 images (WhatsApp-via-Gmail), image MIME attachments, unencrypted PDFs (Claude document blocks), encrypted PDFs (unpdf decryption + text extraction)
- Always sends a reply: success → summary of extracted data; error → error message with details
- Saves extracted service names to user_known_services after success
- `runAnalyzerNoFilter` used — user explicitly forwarded, so keyword filter is bypassed

### Database (src/db/)
Tables: `gmail_tokens`, `digest_runs`, `analyzer_results`, `transactions`, `transportation_monthly`, `user_config`, `pdf_passwords`, `user_known_services`
Client: postgres.js (not Supabase)

### Pipeline (src/pipeline/index.ts)
- First-run detection: `hasDigestRuns()` → false → 90-day scan; subsequent runs → 7 days
- Enriches emails with PDF text before filtering
- Loads user-learned service keywords, passes to runAnalyzer
- Deduplication: normalize service name + date; prefer ILS over USD
- Transportation extraction: GoTo + Moovit/Rav Kav → transportation_monthly

### Digest renderer + cron
- Fully self-contained inline-styled HTML email (TABLE layout, web-safe fonts)
- Cron: POST /api/cron/digest, Sundays 8am UTC

---

## Priority list for next session

1. **WhatsApp/Twilio webhook** — inbound photo/PDF via WhatsApp → same extraction pipeline → reply
2. **Lightweight dashboard** — financial profile page at the app URL (transactions, recurring charges, renewals)
3. **Portfolio intelligence** — asset registry, vesting tracker, deal evaluation
4. **Custom domain** — needed for Resend branded sender + inbound forward@velir.dev (MX pending)
5. **Google OAuth verification** — removes 7-day refresh token expiry; requires Google app review
6. **Gmail pagination** — fetcher capped at 200 results; high-volume inboxes may miss emails
7. **velir.dev inbound** — once MX propagates, add second Resend route (no code changes, just Resend config)

---

## Known Issues / Gotchas

- tsx runs in CJS mode: never use top-level await in scripts
- Desktop app OAuth client silently drops gmail.readonly restricted scope — always use Web application client
- Apple invoices are HTML-only with massive CSS blocks — HTML stripping in fetcher is essential
- Same charge can appear in both subscriptions (USD) and renewals (ILS) — deduplication handles this, prefers ILS
- Anthropic API key must be from the correct workspace (console.anthropic.com)
- Postgres.js returns numeric(12,2) columns as strings — always parseFloat() before arithmetic
- Resend lazy-initializes its client inside sendDigest() (not module-level) — required to avoid build-time crash
- OAuth refresh tokens expire every 7 days while app is in Google "Testing" mode
- unpdf/pdfjs-dist must be in serverExternalPackages — bundling them causes DOMMatrix errors at init
- Resend inbound attachment API returns metadata JSON with download_url, not the file bytes directly
