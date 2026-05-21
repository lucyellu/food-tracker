# Receipt-to-Nutrition Tracker — Build Prompt for Claude Code

## Goal
Build a local web app that ingests grocery receipts (pasted text, photo upload, or forwarded email body), parses every line item, enriches each item with detailed nutrition data from USDA, and surfaces it through a dashboard with per-person/per-day breakdowns and a saved history of all past bills.

The user wants to drop in a Costco/Trader Joe's/Safeway/Whole Foods receipt and instantly see: total calories, macros, vitamins, minerals, alcohol, and ingredients — across the whole bill, per person per day, or for a custom selection of items.

---

## Tech Stack
- **Framework**: Next.js 14+ (App Router, TypeScript) — single repo, API routes serve as the backend.
- **Hosting**: Local dev → deploy to Netlify. Repo: `https://github.com/lucyellu/food-tracker.git`.
- **Database**: **Turso** (libSQL, SQLite-compatible) via Drizzle ORM + `@libsql/client`. Same code path local and deployed. Free tier covers this app easily. Set up at https://turso.tech: `turso db create food-tracker` → `turso db tokens create food-tracker` → use the URL + token.
- **Object storage**: **Netlify Blobs** for uploaded receipt images/PDFs. Zero-config, built-in, free.
- **LLM — text parsing (cheap path)**: **DeepSeek** via the OpenAI SDK pointed at `https://api.deepseek.com`. Model: `deepseek-chat`. Used for pasted text and email bodies.
- **LLM — vision parsing**: **Google Gemini 2.0 Flash** via `@google/generative-ai`. Used for image uploads and PDF attachments. Cheapest vision-capable option (~$0.10/1M input).
- **LLM abstraction**: `lib/llm/parse.ts` exports a single `parseReceipt(input)` that routes internally — text → DeepSeek, image/PDF → Gemini. Callers don't know which provider was used.
- **Nutrition data**: USDA FoodData Central API (free key at https://fdc.nal.usda.gov/api-key-signup.html). Fallback to Open Food Facts (`https://world.openfoodfacts.org/api/v2/search`, no key needed) for branded items USDA misses.
- **UI**: Tailwind + shadcn/ui components. Recharts for macro/calorie charts. Lucide icons.
- **Validation**: Zod for all LLM output validation.

---

## Data Model
```
Receipt
  id, vendor, purchased_at, total, raw_input_kind ('text'|'image'|'email'),
  raw_input_path_or_text, created_at

LineItem
  id, receipt_id, raw_name, normalized_name, brand?, quantity, unit, price,
  fdc_id?, nutrition_status ('matched'|'unmatched'|'manual')

NutritionFact (one per LineItem, after lookup)
  line_item_id, total_grams,
  calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, alcohol_g,
  vitamins_json, minerals_json,
  ingredients_text, active_ingredients_json?

DashboardSettings (single row)
  people (default 3), days (default 7)
```

---

## Build in This Order

### Phase 1 — Ingest
A single upload page with three input methods:
1. Textarea for pasted receipt text
2. File drop for an image (jpg/png/pdf, pdf can be deferred)
3. Textarea for forwarded email body — auto-detect email headers and strip them

On submit, send to a `/api/parse-receipt` endpoint. The endpoint calls `parseReceipt()` from the LLM abstraction — which routes text/email to DeepSeek and image/PDF to Gemini. The system prompt is the same regardless of provider:

> Extract every purchased item from this grocery receipt. Return JSON matching this schema: `{vendor: string, purchased_at: ISO date, total: number, items: [{raw_name, quantity, unit, price}], is_receipt: boolean}`. Units must be normalized to one of: oz, lb, g, kg, fl_oz, ml, l, gal, qt, cup, tbsp, tsp, count, dozen, pack. If quantity is unclear, use 1 and unit "count". Set is_receipt=false if the input is not actually a receipt (e.g., a shipping confirmation with no line items).

Validate response with Zod. On invalid output, re-prompt once with the error message. Persist the receipt + line items. If image/PDF input, upload the bytes to Netlify Blobs and store the blob key in `raw_input_path_or_text`.

### Phase 2 — Nutrition Lookup
For each LineItem (background job after parse):
1. Search USDA: `GET /foods/search?query={normalized_name}+{brand}&dataType=Branded,Foundation,SR+Legacy`.
2. Pick best match: (a) exact brand match in Branded, (b) Foundation, (c) SR Legacy, (d) first result.
3. Fetch full record: `GET /food/{fdc_id}`.
4. Convert to total grams purchased — see "Unit conversion" below.
5. Compute total nutrition: USDA reports per 100g for Foundation/SR, per serving for Branded. Detect which, normalize, multiply by total grams.
6. Store NutritionFact. Cache USDA responses by `fdc_id` in a `usda_cache` table.
7. If USDA returns nothing → try Open Food Facts. If still nothing → set `nutrition_status='unmatched'`.

### Phase 3 — Dashboard
Top of dashboard: **Last Bill Summary Card** showing the most recently processed receipt:
- Total spent, total items, total calories
- People/days dial: two sliders side-by-side (people default 3, days default 7). All per-person-per-day numbers below update reactively.
- Quick interesting stats: highest-calorie item, highest-protein item, total alcohol, % calories from fat/protein/carbs, # of unmatched items
- A macro donut chart and a top-5-items-by-calories bar chart

Below the summary: **Line item table** with columns name, brand, quantity, calories, protein, carbs, fat, price. Sortable. Each row has a checkbox; selected rows show a sticky "Custom Total" bar at the bottom of the viewport with combined nutrition.

Clicking any row opens a side panel with the full breakdown: all vitamins, all minerals, alcohol, ingredients text, active ingredients (if applicable), and a "Re-match" button that lets the user search USDA manually and pick a different match.

### Phase 3.5 — Email Auto-Ingest (IMAP polling)
Wire up automatic receipt pickup from a user-owned inbox. The user doesn't forward to *our* address — they forward to their *own* email (or their existing grocery receipts already land there), tag with a Gmail filter, and we poll IMAP.

**Why not a custom `receipts@ourapp.com` address?** That requires owning a domain, configuring MX records, running a transactional email provider (Postmark Inbound, SendGrid, Mailgun, AWS SES), AND exposing a public webhook URL — none of which a local-only app on a laptop can do without tunneling. IMAP polling on the user's existing inbox needs none of that. The processing pipeline is identical; only the ingress changes if we ever add a webhook path later.

**Settings page at `/settings/email`** with fields:
- IMAP host (default `imap.gmail.com`), port (993), TLS on
- Username + app password (Gmail requires 2FA + an App Password generated at https://myaccount.google.com/apppasswords)
- Mailbox/label to watch (default `Receipts`)
- Poll interval (default 5 min)
- "Test connection" button — connect, list mailboxes, confirm target exists
- Enabled toggle, with a "Recent ingests" log of the last 20 messages (success/skip/fail + parsed vendor)

Store the app password encrypted at rest (AES-GCM, key from a local secret in `.env.local`).

**IMAP poller** (`lib/email/imap-poller.ts`) using `imapflow`:
1. Connect → open mailbox → search `UNSEEN`.
2. For each new message: extract `From`, `Subject`, `Date`, `Message-ID`, and the best text body — prefer `text/plain`, fall back to `text/html` stripped via `node-html-parser`. Strip quoted replies and tracking pixels.
3. If there's a `application/pdf` attachment (Costco often does this), use the PDF bytes as input instead — Claude vision handles PDFs.
4. Pass to the **same `parseReceipt()` function Phase 1 uses** — keep the parser source-agnostic.
5. On success: store Receipt with `source='auto_email'`, `source_message_id=<Message-ID>`, mark message `\Seen`, optionally move to a "Processed" sub-folder.
6. Dedup with a UNIQUE index on `receipts.source_message_id`.
7. Have the LLM return `{is_receipt: false}` for order confirmations / shipping notices without line items — skip those, log to `EmailIngestLog` with status `skipped_not_receipt`.

**Background runner**: **Netlify Scheduled Function** at `netlify/functions/poll-email.ts` configured in `netlify.toml` with `schedule = "*/5 * * * *"` (every 5 min). The function connects via IMAP, processes any unread messages in the watched label, and exits. Works identically in local dev via `netlify dev` (which simulates the schedule). No long-running process needed.

**Recommended user setup** (put this on the settings page as a step-by-step):
1. In Gmail: Settings → Filters → Create new filter.
2. Match common receipt senders + subjects, e.g.:
   `from:(receipts@wholefoodsmarket.com OR noreply@trader-joes.com OR digital_receipts@safeway.com OR noreply@costco.com) OR subject:(receipt OR "your order" OR "order confirmation")`
3. Action: Apply label "Receipts" (optionally Skip Inbox).
4. Enable 2-Step Verification → generate an App Password for "Mail" → paste it into this app.
5. Anything else they want processed, they forward to themselves; a second filter (`subject:Fwd AND from:me` → label Receipts) catches it.

**Data model additions**:
```
Receipt (add column)
  source ('manual_text'|'manual_image'|'manual_email_paste'|'auto_email')
  source_message_id?  -- UNIQUE INDEX, nullable

EmailIngestLog
  id, received_at, from_address, subject, message_id,
  status ('parsed'|'skipped_not_receipt'|'failed'),
  receipt_id?, error_text?
```

**Upgrade path (don't build for v0, but design for it)**: if the user later wants a true `receipts@theirdomain.com` forwarding address, they can point a domain at Cloudflare Email Routing or AWS SES → Lambda/Worker → POST to a `/api/inbound-email` route on a deployed instance of this app. The route hands off to the same `parseReceipt()` pipeline. Because the parser doesn't know or care where the input came from, this is purely an ingress swap.

### Phase 4 — History
- **Monthly view** at `/history`: calendar grid for the current month, each day showing receipt count and dollar total if any. Click a day → drill into that day's receipts.
- Month-level totals at the top: total spent, total calories, top 5 items across the month.
- Month picker to navigate backward.
- Click any receipt → full breakdown view (same as the dashboard, but for that specific bill).

---

## The Hard Parts — Handle These Explicitly

### 1. Vendor variety in receipts
Don't write per-vendor regex. Use Claude API for parsing. Receipts from Costco look nothing like Trader Joe's, which look nothing like Whole Foods email confirmations. The LLM handles this naturally with the right schema-constrained prompt.

### 2. Unit conversion
Build `lib/units.ts` with conversion tables to grams or milliliters:
- Mass: oz→28.35g, lb→453.59g, kg→1000g
- Volume: fl_oz→29.57ml, cup→236.59ml, tbsp→14.79ml, tsp→4.93ml, gal→3785.41ml, qt→946.35ml, pt→473.18ml
- Count: requires USDA `servingSize`/`servingSizeUnit` (e.g., "1 apple, medium" = 182g). Multiply count × serving grams.
- Pack/dozen: pack→1 (treat as unit), dozen→12 count.

When the LLM returns "1 gallon of milk" → convert to 3785.41ml → multiply by milk density (~1.03 g/ml) → grams.

### 3. Serving size normalization
USDA has two conventions:
- **Foundation/SR Legacy**: nutrients reported per 100g. Scale linearly by `total_grams / 100`.
- **Branded**: nutrients reported per `servingSize` (with `servingSizeUnit`). Scale by `total_grams / servingSize_grams`.

Detect by `dataType` field on the food record. Write `lib/nutrition.ts` with `scaleNutrition(usdaFood, totalGrams)` that returns normalized totals.

### 4. Ambiguous matches & failed lookups
- Log every chosen `fdc_id` so users can override.
- "Re-match" button in the side panel: lets user search USDA themselves, pick a different food, recompute nutrition.
- Unmatched items show a yellow badge on the dashboard with a "Match manually" CTA.

### 5. Alcohol and "active ingredients"
- USDA nutrient ID 1018 is `Alcohol, ethyl` (grams). Pull it like any other nutrient.
- "Active ingredients" only applies to supplements/OTC meds caught in a grocery run. USDA doesn't track these. Mark this as a stretch goal — for v0, just surface the full ingredient text and leave `active_ingredients_json` null unless we add a separate source later.

---

## Setup Commands

```bash
# 1. Bootstrap Next.js
npx create-next-app@latest food-tracker --typescript --tailwind --app --src-dir --no-import-alias
cd food-tracker

# 2. Install dependencies
npm i drizzle-orm @libsql/client zod recharts lucide-react openai @google/generative-ai imapflow node-html-parser @netlify/blobs mailparser
npm i -D drizzle-kit @netlify/functions netlify-cli

# 3. shadcn/ui
npx shadcn@latest init
npx shadcn@latest add button card input slider table dialog sheet badge tabs calendar

# 4. Turso (one-time)
# Install CLI: https://docs.turso.tech/cli/installation (winget install turso.turso on Windows)
turso auth signup        # or `turso auth login` if you already have an account
turso db create food-tracker
turso db show food-tracker --url       # → TURSO_DATABASE_URL
turso db tokens create food-tracker    # → TURSO_AUTH_TOKEN

# 5. Initialize git + link to GitHub
git init
git remote add origin https://github.com/lucyellu/food-tracker.git
```

Create `.env.local` (DO NOT commit — `.gitignore` already excludes it):
```
DEEPSEEK_API_KEY=sk-...               # https://platform.deepseek.com/api_keys
GEMINI_API_KEY=...                    # https://aistudio.google.com/apikey  (free)
USDA_API_KEY=...                      # https://fdc.nal.usda.gov/api-key-signup.html  (free)
TURSO_DATABASE_URL=libsql://...       # from `turso db show`
TURSO_AUTH_TOKEN=...                  # from `turso db tokens create`
EMAIL_ENCRYPTION_KEY=...              # generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
```

## Netlify Deployment

`netlify.toml` at repo root:
```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[functions."poll-email"]
  schedule = "*/5 * * * *"
```

Deploy flow:
1. Push to `https://github.com/lucyellu/food-tracker.git` (main branch).
2. In Netlify dashboard → Add new site → Import from GitHub → pick the repo.
3. In Site settings → Environment variables → add every var from `.env.local` (Netlify will inject them into both build and runtime).
4. Trigger deploy. The scheduled IMAP function activates automatically.

For local end-to-end testing of the scheduled function and Netlify Blobs, use `netlify dev` instead of `next dev` — it emulates the Netlify runtime.

---

## Non-Goals for v0
- No authentication — this is a single-user local app
- No mobile-native — responsive web only
- No real-time email ingestion — user pastes the email body manually
- No barcode scanning (could add later)
- No meal planning, recipe suggestions, or macro goals/budgets
- No multi-currency — assume USD

---

## Definition of Done
1. Upload a Trader Joe's receipt photo → see itemized nutrition for every line within ~30 seconds.
2. Adjust the people/days dial → every per-person-per-day number updates live.
3. Select 3 items via checkboxes → see their combined nutrition in a sticky bar.
4. Open the monthly view → see all receipts from the current month, click one → see its full breakdown.
5. Click any line item → side panel shows vitamins, minerals, alcohol, ingredients.
6. Restart the dev server → all past receipts still there (SQLite persistence works).

---

## Notes on Cost
Claude API will run ~$0.01–0.05 per receipt parse (vision + structured output). USDA is free up to 1000 req/hr per key. Cache aggressively by `fdc_id` so re-processing a receipt doesn't re-hit USDA.
