#!/usr/bin/env node
// Import a parsed receipt CSV into the Turso/libSQL database, bypassing the LLM entirely.
//
// Usage:
//   node scripts/import-csv.mjs parsed-receipts/tnt-2026-05-18.csv \
//        --vendor "T&T Supermarket" --date 2026-05-18 --total 276.67
//
// Required CSV columns: status, raw_name, sku, quantity, unit, unit_price, line_total
// (status is 'fulfilled' or 'refunded'; refunded items are still inserted so we
// can compute returns/discounts later — they're marked via raw_name suffix.)

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

// Load .env.local so Turso env vars are available without dotenv as a dep.
function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}
loadEnv(resolve(process.cwd(), ".env.local"));

const args = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") {
    flags["dry-run"] = true;
  } else if (a.startsWith("--")) {
    flags[a.slice(2)] = args[++i];
  } else {
    positional.push(a);
  }
}

const csvPath = positional[0];
if (!csvPath) {
  console.error("Usage:");
  console.error("  node scripts/import-csv.mjs <csv-path> \\");
  console.error("    --vendor 'T&T Supermarket' --date 2026-05-18 --total 276.67");
  console.error("");
  console.error("Add --dry-run to preview without writing to the DB.");
  process.exit(1);
}

const vendor = flags.vendor ?? "Unknown";
const purchasedAt = flags.date ?? null;
const total = flags.total ? Number(flags.total) : null;
const isDryRun = !!flags["dry-run"];

const dbUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || process.env.DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;
if (!dbUrl && !isDryRun) {
  console.error("TURSO_DATABASE_URL is not set. Run `setkey TURSO_DATABASE_URL` first.");
  console.error("(Or pass --dry-run to preview without DB.)");
  process.exit(1);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    // simple CSV split — none of our values contain commas or quotes
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i]));
    return row;
  });
}

const csvText = readFileSync(resolve(process.cwd(), csvPath), "utf8");
const rows = parseCsv(csvText);

console.log(`\nReceipt: ${vendor}, ${purchasedAt ?? "(no date)"}, total ${total != null ? `$${total.toFixed(2)}` : "(none)"}`);
console.log(`Items:   ${rows.length} (${rows.filter((r) => r.status === "fulfilled").length} fulfilled, ${rows.filter((r) => r.status === "refunded").length} refunded)`);
console.log("");

if (isDryRun) {
  console.log("DRY RUN — no DB writes.\n");
  for (const r of rows) {
    const tag = r.status === "refunded" ? "[REF]" : "     ";
    console.log(`  ${tag} ${r.raw_name.padEnd(60).slice(0, 60)} ${String(r.quantity).padStart(8)} ${r.unit.padEnd(5)} $${r.line_total}`);
  }
  process.exit(0);
}

const db = createClient({ url: dbUrl, authToken: dbToken });

const receiptRows = await db.execute({
  sql: `
  INSERT INTO receipts (vendor, purchased_at, total, source, raw_input_kind, parse_status)
  VALUES (?, ?, ?, 'manual_email_paste', 'email', 'parsed')
  RETURNING id
`,
  args: [vendor, purchasedAt, total],
});
const receiptId = Number(receiptRows.rows[0].id);
console.log(`Inserted receipt #${receiptId}`);

let inserted = 0;
let skipped = 0;
for (const r of rows) {
  const qty = Number(r.quantity);
  const price = Number(r.line_total);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) {
    console.warn(`  skip (bad numbers): ${r.raw_name}`);
    skipped++;
    continue;
  }
  const isRefunded = r.status === "refunded";
  await db.execute({
    sql: `
    INSERT INTO line_items (
      receipt_id,
      raw_name,
      quantity,
      unit,
      price,
      retailer_sku,
      product_source,
      consumption_status
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      'T&T',
      ?
    )
  `,
    args: [receiptId, r.raw_name, qty, r.unit ?? "count", price, r.sku || null, isRefunded ? "refunded" : "available"],
  });
  inserted++;
}

console.log(`\nDone: ${inserted} line items inserted, ${skipped} skipped.`);
console.log(`View at http://localhost:3000/receipts/${receiptId}`);
