# Food Tracker

**[Try it live →](https://food-tracker-1.netlify.app/)**

Parse grocery receipts and track nutrition. Drop in a Trader Joe's / Costco / Whole Foods receipt as text, photo, or forwarded email and see an itemized database.

See [PROMPT.md](./PROMPT.md) for the full design spec.

## Status

**Phase 1 — done.** Ingest, parse, persist, list, detail.
**Phase 2** (next): USDA FoodData Central lookup → real nutrition data per item.
**Phase 3**: Dashboard with people/days dial and macro summary.
**Phase 3.5**: Auto-ingest receipts from Gmail via Google OAuth + Netlify Scheduled Functions.
**Phase 4**: Monthly history view.

## Run locally

```bash
# 1. Fill in the keys
cp .env.local.example .env.local
npx github:lucyellu/key-manager   # interactive prompts for each missing key

# 2. Push schema to Turso/libSQL (creates all tables).
# This is enough for a fresh Turso start; importing old Neon data is optional.
npm run db:push

# 3. Start the dev server
npm run dev
```

Visit http://localhost:3000.

You need: DeepSeek key, Gemini key, USDA key (Phase 2), and Turso/libSQL credentials (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`). The app uses Turso for persistence so read-heavy dashboards stay inside a much roomier free tier than Neon network transfer.

Open Food Facts enrichment is optional and read-only. It does not need an API key, but set `OPEN_FOOD_FACTS_USER_AGENT` to a custom value with a contact email if you deploy the app publicly.

For Gmail and Google Photos import, create a Google Cloud OAuth Web client, enable the Gmail API and Google Photos Picker API, and add this authorized redirect URI for local development:

```text
http://localhost:3000/api/google/callback
```

Then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `EMAIL_ENCRYPTION_KEY`. The app requests read-only Gmail access for inbox imports, and selected-photo access for Google Photos imports. Optional photo OCR uses `GOOGLE_CLOUD_VISION_API_KEY`.

## Architecture

- **Next.js 16 App Router** (TypeScript, React 19).
- **Database**: Drizzle ORM over Turso/libSQL (`@libsql/client`). Hot dashboard reads avoid raw receipt text and use Next cache tags so routine navigation transfers less data.
- **LLM routing** (`src/lib/llm/parse.ts`):
  - Text + email → DeepSeek `deepseek-chat` (cheap, ~$0.14/1M input)
  - Images + PDFs → Google Gemini 2.0 Flash (cheapest vision-capable)
- **Schema enforcement**: Zod validates every LLM response. Invalid output triggers one re-prompt with the error message before failing.
- **Hosting**: Netlify (`netlify.toml` at the repo root, `@netlify/plugin-nextjs`).

## Project layout

```
src/
  app/
    page.tsx                       # upload page (3 input modes)
    receipts/page.tsx              # list of all receipts
    receipts/[id]/page.tsx         # single receipt detail
    api/parse-receipt/route.ts     # POST: parse + persist
    api/receipts/route.ts          # GET: list
    api/receipts/[id]/route.ts     # GET / DELETE
  db/
    client.ts                      # drizzle + libsql client
    schema.ts                      # all tables
  lib/llm/
    schema.ts                      # zod + shared system prompt
    parse.ts                       # top-level parseReceipt() router
    deepseek.ts                    # text/email handler
    gemini.ts                      # image/PDF handler
```

## Scripts

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run db:push` — sync schema to the database (rerun after editing `src/db/schema.ts`)
- `npm run db:studio` — open Drizzle Studio to browse data
- `npm run db:migrate:turso` — copy existing Neon rows into Turso using `NEON_DATABASE_URL`/`DATABASE_URL` as source and `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` as target

## Fresh Turso start or Neon migration

If Neon is quota-blocked or the old rows are not worth carrying forward, start fresh:

```bash
# Create a Turso DB + token, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN,
# then create the empty schema.
npm run db:push
```

That produces an empty Food Tracker database. The app will create rows again as
receipts are parsed/imported.

If the old Neon project is still readable, copy existing rows instead:

```bash
# 1. Create Turso DB + token, then set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
npm run db:push

# 2. Copy existing Neon rows into the Turso database
# Source URL: NEON_DATABASE_URL, or the legacy DATABASE_URL if still set to Neon.
npm run db:migrate:turso
```

After the copy, set Netlify environment variables to `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Keep the old Neon URL only as `NEON_DATABASE_URL` while migration verification is underway.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify dashboard → "Add new site" → "Import from Git" → pick the repo.
3. Build settings: leave defaults (`netlify.toml` configures them).
4. Site settings → Environment variables → add `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `USDA_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `EMAIL_ENCRYPTION_KEY` (same values as your local `.env.local`).
5. Trigger deploy.

The Phase 3.5 scheduled function (Gmail polling) will be wired into `netlify.toml` when that phase is built.
