Project: Jist — Personal CFO Assistant
What it does: Reads Gmail, extracts financial insights via modular analyzers, delivers a weekly HTML email digest every Sunday. Users can also forward bills and invoices directly to Jist via WhatsApp (photos, PDFs) or a dedicated inbound email address — both feed the same extraction pipeline and update the financial profile in real time. Israeli market first (ILS currency, Hebrew email support).

Tech stack:
- Next.js + TypeScript on Vercel
- Gmail API (OAuth2, Web application client, loopback redirect) for email ingestion
- Anthropic SDK (claude-sonnet-4-6) as LLM — model-agnostic abstraction layer; vision used for bill photos
- Zod v4 for output schema validation per analyzer (z.toJSONSchema() for tool use)
- Vercel Postgres (Neon, Frankfurt region) for storing extracted data over time
- Resend for digest email delivery + inbound email webhook
- Twilio for WhatsApp inbound/outbound (media download, reply)
- Vercel Cron for Sunday digest trigger

Architecture:

Scheduled (weekly):
Gmail fetch → Email Normalizer → Analyzer Registry → LLM Router → Zod Validator → Postgres → Digest Renderer → Resend

On-demand inbound — two channels, same extraction core:
WhatsApp photo/PDF → /api/whatsapp/inbound → Media Fetcher → Document Extractor → LLM → Postgres → WhatsApp reply
Forwarded email      → /api/email/inbound   → Attachment Parser → Document Extractor → LLM → Postgres → (optional reply)

Analyzer registry pattern: Each analyzer is a config object with id, filter(), systemPrompt, buildPrompt(), and outputSchema (Zod). Adding a use case = adding one object.
LLM abstraction: Provider interface so any model can plug in. Currently Anthropic only.

Credentials (all in .env.local):
- ANTHROPIC_API_KEY ✓
- GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN ✓ (Web application OAuth client, loopback http://127.0.0.1:3000 redirect)
- POSTGRES_URL ✓ (Neon connection string, also set in Vercel)
- RESEND_API_KEY ✓
- CRON_SECRET ✓
- NEXTAUTH_SECRET ✓

IMPORTANT — Gmail OAuth:
- Must use Web application client type (NOT Desktop app). Desktop app silently drops gmail.readonly restricted scope from consent screen.
- Redirect URI: http://127.0.0.1:3000 (loopback) for local scripts. Production callback: https://jist-ashen.vercel.app/api/auth/gmail/callback (must be registered in Google Cloud Console).
- OAuth app is currently in "Testing" mode — refresh tokens auto-expire every 7 days. To re-auth: visit https://jist-ashen.vercel.app/api/auth/gmail (or run `npx next dev` locally and hit http://localhost:3000/api/auth/gmail).
- Token refresh persistence: createAuthenticatedClient() in src/gmail/oauth.ts listens to the `tokens` event and saves refreshed credentials back to the DB automatically. Pass userId as the second argument or refresh events will be silently dropped.
- Scripts use `tsx` in CJS mode — NEVER use top-level await. Always wrap in `async function main() {}` + `main().catch()`.

IMPORTANT — Vercel env vars (must match .env.local exactly):
- ANTHROPIC_API_KEY
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (no GOOGLE_REFRESH_TOKEN needed — tokens live in DB)
- POSTGRES_URL
- RESEND_API_KEY
- DIGEST_FROM_EMAIL=onboarding@resend.dev  ← CRITICAL: without this, sender falls back to digest@jist.app (unverified domain → Resend rejects). Once velir.dev is verified, change to jist@velir.dev
- RESEND_WEBHOOK_SECRET  ← from Resend dashboard → Webhooks → signing secret for the inbound endpoint
- CRON_SECRET
- NEXTAUTH_SECRET
- NEXTAUTH_URL=https://jist-ashen.vercel.app

Do not: install OpenAI SDK, use `any` types, hardcode credentials, write to Windows filesystem paths.

---

## Live Deployment

- **URL:** https://jist-ashen.vercel.app
- **Cron:** POST /api/cron/digest, Sundays 8am UTC (11am Israel time), Bearer auth via CRON_SECRET
- **Email sender:** Resend, currently from onboarding@resend.dev (sandbox — no custom domain yet)
- **DB:** Vercel Postgres / Neon, Frankfurt region
- **Migration:** src/db/migrations/001_schema.sql (single consolidated file, applied)

---

## What's Built and Working

### Gmail fetcher (src/gmail/fetcher.ts)
- Uses `newer_than:${sinceDays}d` query syntax
- Filters out social + promotions categories
- HTML stripping: removes `<style>`, `<script>`, tags, HTML entities, collapses whitespace — critical for Apple invoices that have 10K+ chars of CSS before the actual content
- Prefers text/plain, falls back to text/html, recurses into multipart parts
- PDF parsing removed (pdf-parse crashed on Vercel serverless due to @napi-rs/canvas dependency)

### LLM layer (src/llm/)
- AnthropicProvider.completeStructured() uses Anthropic tool use (NOT prompt-based JSON):
  - z.toJSONSchema(schema) as tool input_schema
  - tool_choice: { type: "tool", name: "structured_output" }
  - Extracts toolUse.input, parses with Zod schema
- Required: prompt-based JSON produced wrong field names and failed Zod validation

### Analyzers (src/analyzers/)
Three analyzers working end-to-end:

1. **subscriptions** — extracts charges/billing events
   - Keywords include Hebrew terms + Israeli sender domains (Pelephone, Bezeq, Hot, Partner, Cellcom, Migdal, Harel, IEC, etc.)
   - System prompt instructs Claude to extract each Apple invoice line item separately (not the total)
   - Body slice: 3000 chars

2. **renewals** — upcoming renewals and expirations
   - Detects renewal/expiry signals, outputs renewalDate + status + urgency
   - Urgent services flagged in `urgent[]` array for red-bar treatment in digest

3. **opportunities** — cashback, refunds, time-sensitive rewards
   - Three strict criteria: personally addressed, deadline within 30 days, known service
   - Filter uses corpus-derived trusted-domain set to eliminate newsletter noise
   - Today's date injected into buildPrompt for deadline assessment

Zod schema robustness: all array fields have `.default([])`, all string fields have `.default("")`, all numeric fields have `.default(0)` — LLM occasionally omits top-level fields.

### Database (src/db/)
Tables: `gmail_tokens`, `digest_runs`, `analyzer_results`, `transactions`, `transportation_monthly`, `user_config`
Migration: src/db/migrations/001_schema.sql
Client: postgres.js (not Supabase — migrated away; Supabase free tier pauses after 7 days inactivity)

DB functions (src/db/results.ts):
- `saveAnalyzerResults`, `saveTransactions`, `clearUserTransactions`, `saveTransportationMonthly`
- `getAnalyzerHistory`, `getLatestTransactions`, `getLatestTransportMonth`, `hasDigestRuns`

### Pipeline (src/pipeline/index.ts)
- First-run detection: `hasDigestRuns()` → false → 90-day scan; subsequent runs → 7 days
- Deduplication: normalize service name + date as key; prefer ILS over USD for same key
- Transportation extraction: GoTo + Moovit/Rav Kav → transportation_monthly upsert
- Full refresh per run (clears previous transactions before saving)

### Digest renderer (src/email/renderer.ts)
- Fully self-contained inline-styled HTML — no template file, no CSS classes
- TABLE layout throughout (no flexbox/grid — email client compatibility)
- Web-safe fonts: Arial/Helvetica + Courier New (no Google Fonts)
- Sections: header, hero greeting, black stat hero, two-column alerts+opportunities, transport row, charges list, WhatsApp CTA, footer
- Design: black (#000), teal (#0D9488), white, light gray surfaces

### Cron route (app/api/cron/digest/route.ts)
- POST with Bearer ${CRON_SECRET}
- Fetches all users with tokens, runs pipeline + render + send for each
- First-run uses 90-day lookback; weekly runs use 7 days

### Email sender (src/email/sender.ts)
- sendDigest(to, html, weekOf) via Resend — working, tested end-to-end
- Currently sending from onboarding@resend.dev (needs custom domain for branded sender)

### OAuth flow (app/api/auth/gmail/)
- Full page navigation (not fetch) to avoid CORS on cross-origin Google redirect
- Callback saves tokens to gmail_tokens table
- Redirect URI derived from NEXTAUTH_URL env var

---

## What's Not Yet Done

1. **WhatsApp/Twilio webhook** — not started (priority #1)
2. **Inbound email** — forward@ address not set up (priority #2)
3. **Adaptive learning** — learned_senders table + auto-expand keyword list (priority #3)
4. **Lightweight dashboard** — financial profile page at the app URL (priority #4)
5. **Portfolio intelligence** — asset registry, vesting tracker, deal evaluation (priority #5, full spec in memory)
6. **Israeli sender list** — ~500 domains for better auto-detection (priority #6)
7. **Custom domain** — needed for Resend branded sender + inbound email (priority #7)
8. **Google OAuth verification** — removes 7-day token expiry in Testing mode (priority #9)
9. **PDF parsing** — removed due to serverless crash; needs serverless-safe replacement for forward-to-Jist feature
10. **Gmail pagination** — fetcher capped at 500 results per call; high-volume inboxes may miss older emails

---

## Known Issues / Gotchas

- tsx runs in CJS mode: never use top-level await in scripts
- Desktop app OAuth client silently drops gmail.readonly restricted scope — always use Web application client
- Apple invoices are HTML-only with massive CSS blocks — HTML stripping in fetcher is essential
- Same charge can appear in both subscriptions (USD) and renewals (ILS) — deduplication handles this, prefers ILS
- Anthropic API key must be from the correct workspace (console.anthropic.com) — different workspaces have separate billing
- Postgres.js returns numeric(12,2) columns as strings — always parseFloat() before arithmetic
- Resend lazy-initializes its client inside sendDigest() (not module-level) — required to avoid build-time crash when RESEND_API_KEY is absent
- pdf-parse removed: uses @napi-rs/canvas which crashes in Vercel serverless (DOMMatrix not defined)
- OAuth refresh tokens expire every 7 days while app is in Google "Testing" mode
