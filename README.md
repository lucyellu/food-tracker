# Food Tracker

Parse grocery receipts and track nutrition. Drop in a Trader Joe's / Costco / Whole Foods receipt as text, photo, or forwarded email and see an itemized database.

See [PROMPT.md](./PROMPT.md) for the full design spec.

## Status

**Phase 1 — done.** Ingest, parse, persist, list, detail.
**Phase 2** (next): USDA FoodData Central lookup → real nutrition data per item.
**Phase 3**: Dashboard with people/days dial and macro summary.
**Phase 3.5**: Auto-ingest receipts from Gmail via IMAP + Netlify Scheduled Functions.
**Phase 4**: Monthly history view.

## Run locally

```bash
# 1. Fill in the keys
cp .env.local.example .env.local
npx github:lucyellu/key-manager   # interactive prompts for each missing key

# 2. Push schema to Neon (creates all tables)
npm run db:push

# 3. Start the dev server
npm run dev
```

Visit http://localhost:3000.

You need: DeepSeek key, Gemini key, USDA key (Phase 2), and a Neon Postgres URL (`DATABASE_URL`). Sign up for Neon at https://neon.tech — free tier covers this app, no credit card.

## Architecture

- **Next.js 16 App Router** (TypeScript, React 19).
- **Database**: Drizzle ORM over Neon serverless Postgres (`@neondatabase/serverless`). Single connection string powers both local dev and Netlify production — no SQLite, no local DB install.
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

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify dashboard → "Add new site" → "Import from Git" → pick the repo.
3. Build settings: leave defaults (`netlify.toml` configures them).
4. Site settings → Environment variables → add `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `USDA_API_KEY`, `DATABASE_URL`, and `EMAIL_ENCRYPTION_KEY` (same values as your local `.env.local`).
5. Trigger deploy.

The Phase 3.5 scheduled function (Gmail IMAP polling) will be wired into `netlify.toml` when that phase is built.
