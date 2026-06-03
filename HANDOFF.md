# Food Tracker — Work Handoff

Compact summary so a fresh session can continue without re-reading everything.

## Project facts
- Next.js 16 (modified — read `node_modules/next/dist/docs/` before writing Next code; see AGENTS.md).
- DB: Turso/libSQL via Drizzle on `codex/turso-migration`. Schema-first: edit `src/db/schema.ts` then `npm run db:push` (no migration files).
  - `db:push` needs `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from `.env.local` and network.
  - One-time Neon copy: keep the old Postgres URL as `NEON_DATABASE_URL` or legacy `DATABASE_URL`, then run `npm run db:migrate:turso` after `db:push` creates the Turso tables.
- LLM: image receipts → Google Cloud Vision OCR → text parser; PDFs → Gemini; text/email → Gemini-text w/ DeepSeek fallback.
- Verify with: `npx tsc --noEmit` and `npx eslint src`. Build: `npm run build`.
- Keys live in `.env.local` (gitignored): DEEPSEEK_API_KEY, GEMINI_API_KEY, GOOGLE_CLOUD_VISION_API_KEY (+billing enabled), USDA, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, etc. Netlify deploy needs these set there too.

## DONE and shipped (build passed, on branch — verify git status)
1. **Cloud Vision OCR for image receipts** — `src/lib/llm/parse.ts` (images go OCR→text parser, no Gemini vision). Committed earlier (`90567ae` on main).
2. **Item categories** — `src/lib/products/category.ts` (CATEGORIES, CONSUMABLE_CATEGORIES, `categorizeItem`, CATEGORY_LABELS). Threaded through `catalog.ts`, `llm/schema.ts` (+SYSTEM_PROMPT), `persist.ts`. `category` column added to `productCatalog` + `lineItems` (pushed). Backfill: `POST /api/receipts/recategorize` + "Categorize uncategorized items" button on `/receipts`.
3. **Consumption window (averaging display)** — `computeConsumptionWindow` in `src/lib/receipts/dates.ts` = min(next same-vendor purchase, 7 days). Wired into `receipts/[id]/page.tsx`; tracker shows "N days" big + date range small (Plan panel + header). Props `initialDays`, `windowNote` on `ReceiptNutritionTracker`.
4. **Manual edit/delete** — receipt header PATCH in `api/receipts/[id]/route.ts` + `ReceiptHeaderActions.tsx` (edit vendor/date/total, delete receipt). Per-line-item `api/receipts/[id]/items/[itemId]/route.ts` (PATCH fields incl. category, DELETE). Tracker: category quick-select chip per row + "Edit item" card (name/qty/price/category) + "Delete row" in details lane.

All of the above typechecks, lints, and builds clean.

## IN PROGRESS — auto-consume (THIS is what was half-done; DB now fixed)
Decision: **auto-mark CONSUMABLE items `consumed` 14 days after purchase, with manual undo that sticks.**
- DONE: `auto_consumed boolean default false` column added to `lineItems` in `schema.ts` AND pushed to DB (fixed the crash). `data-transfer.ts` normalizeLineItem updated.
- STILL TODO:
  1. New `src/lib/receipts/auto-consume.ts`:
     - `export const AUTO_CONSUME_DAYS = 14;`
     - `autoConsumeStaleItems()` — single raw SQL UPDATE via `db.execute(sql\`...\`)`:
       ```sql
       UPDATE line_items li
       SET consumption_status='consumed', auto_consumed=true,
           status_date = to_char(LEAST(to_date(r.purchased_at,'YYYY-MM-DD') + 14, CURRENT_DATE),'YYYY-MM-DD')
       FROM receipts r
       WHERE li.receipt_id=r.id AND li.auto_consumed=false
         AND li.consumption_status IN ('available','pantry','fridge')
         AND li.category IN ('food','drink','cannabis','supplement')
         AND r.purchased_at ~ '^\d{4}-\d{2}-\d{2}$'
         AND to_date(r.purchased_at,'YYYY-MM-DD') <= CURRENT_DATE - 14;
       ```
  2. Call `await autoConsumeStaleItems()` at the top of the data loader in `src/app/receipts/page.tsx` (list page) so it runs automatically on visit, and inside `POST /api/receipts/recategorize` AFTER categorizing (so one click clears the backlog: categorize → then auto-consume).
  3. **Lock manual changes** so undo sticks: set `auto_consumed=true` on every manual status write:
     - bulk `PATCH api/receipts/[id]/items/route.ts` (used by tracker `setStatus` + inventory) → add `autoConsumed: true` to the `.set({...})`.
     - per-item `PATCH api/receipts/[id]/items/[itemId]/route.ts` → when `consumptionStatus` present, also set `autoConsumed: true`.
  4. (Optional, low effort) Surface `autoConsumed` on `ReceiptTrackerItem` + show a small "· auto" hint next to consumed rows. Undo already works via the existing Tag status dropdown.
  5. Re-run `npx tsc --noEmit` + `npx eslint src`, then `npm run build`.

## FUTURE / v2 idea (user asked, deferred)
Auto-learn each product's real consumption duration from repurchase gaps (e.g. soy sauce bought 90 days apart ⇒ 90-day consume; large items like 4L oil last longer). More complex; not in current scope.

## Plan file
`C:\Users\lucyl\.claude\plans\giggly-rolling-catmull.md` (the categories/window/edit-delete plan).
