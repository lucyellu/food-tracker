import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@libsql/client";

function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadDotEnvLocal();

const sourceUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const targetUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
const targetToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

if (!sourceUrl?.startsWith("postgres")) {
  console.error("Set NEON_DATABASE_URL or DATABASE_URL to the source Neon Postgres URL.");
  process.exit(1);
}

if (!targetUrl) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for the target Turso database.");
  process.exit(1);
}

const pg = neon(sourceUrl);
const turso = createClient({ url: targetUrl, authToken: targetToken });

const dateMs = (value) => {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};
const boolInt = (value) => (value ? 1 : 0);

const tables = [
  {
    name: "product_catalog",
    orderBy: "id",
    columns: [
      "id",
      "product_key",
      "display_name",
      "normalized_name",
      "category",
      "brand",
      "barcode",
      "external_source",
      "external_id",
      "retailer_sku",
      "product_source",
      "product_url",
      "product_image_url",
      "fdc_id",
      "first_seen_at",
      "updated_at",
    ],
    convert: { first_seen_at: dateMs, updated_at: dateMs },
  },
  {
    name: "receipts",
    orderBy: "id",
    columns: [
      "id",
      "vendor",
      "purchased_at",
      "total",
      "source",
      "source_message_id",
      "raw_input_kind",
      "raw_input_ref",
      "parse_status",
      "parse_error",
      "created_at",
    ],
    convert: { created_at: dateMs },
  },
  {
    name: "line_items",
    orderBy: "id",
    columns: [
      "id",
      "receipt_id",
      "product_id",
      "raw_name",
      "normalized_name",
      "category",
      "brand",
      "quantity",
      "unit",
      "price",
      "retailer_sku",
      "product_source",
      "product_url",
      "product_image_url",
      "consumption_status",
      "status_date",
      "auto_consumed",
      "fdc_id",
      "nutrition_status",
    ],
    convert: { auto_consumed: boolInt },
  },
  {
    name: "nutrition_facts",
    orderBy: "line_item_id",
    columns: [
      "line_item_id",
      "total_grams",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sugar_g",
      "sodium_mg",
      "alcohol_g",
      "caffeine_mg",
      "vitamins_json",
      "minerals_json",
      "ingredients_text",
      "active_ingredients_json",
    ],
  },
  {
    name: "consumption_logs",
    orderBy: "id",
    columns: ["id", "receipt_id", "line_item_id", "consumed_at", "amount", "unit", "note", "created_at"],
    convert: { created_at: dateMs },
  },
  {
    name: "settings",
    orderBy: "id",
    columns: [
      "id",
      "people",
      "days",
      "email_enabled",
      "email_host",
      "email_port",
      "email_username",
      "email_password_encrypted",
      "email_mailbox",
      "email_poll_interval_min",
    ],
    convert: { email_enabled: boolInt },
  },
  {
    name: "email_accounts",
    orderBy: "id",
    columns: [
      "id",
      "provider",
      "label",
      "email",
      "host",
      "port",
      "mailbox",
      "query",
      "secret_encrypted",
      "enabled",
      "created_at",
      "updated_at",
    ],
    convert: { enabled: boolInt, created_at: dateMs, updated_at: dateMs },
  },
  {
    name: "email_ingest_log",
    orderBy: "id",
    columns: [
      "id",
      "email_account_id",
      "received_at",
      "from_address",
      "subject",
      "message_id",
      "status",
      "receipt_id",
      "error_text",
    ],
    convert: { received_at: dateMs },
  },
  {
    name: "google_photo_connections",
    orderBy: "id",
    columns: ["id", "email", "secret_encrypted", "enabled", "created_at", "updated_at"],
    convert: { enabled: boolInt, created_at: dateMs, updated_at: dateMs },
  },
  {
    name: "usda_cache",
    orderBy: "fdc_id",
    columns: ["fdc_id", "payload_json", "cached_at"],
    convert: { cached_at: dateMs },
  },
];

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function copyTable(table) {
  const columnsSql = table.columns.map(quoteIdent).join(", ");
  let rows;
  try {
    rows = await pg.query(`select ${columnsSql} from ${quoteIdent(table.name)} order by ${quoteIdent(table.orderBy)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("exceeded the data transfer quota") || message.includes("HTTP status 402")) {
      throw new Error(
        "Neon refused the source read because the project exceeded its data transfer quota. Wait for quota reset or briefly upgrade Neon, then rerun npm run db:migrate:turso.",
      );
    }
    throw error;
  }
  if (rows.length === 0) {
    console.log(`${table.name}: 0 rows`);
    return;
  }

  const placeholders = table.columns.map(() => "?").join(", ");
  const insertSql = `insert or replace into ${quoteIdent(table.name)} (${columnsSql}) values (${placeholders})`;
  const statements = rows.map((row) => ({
    sql: insertSql,
    args: table.columns.map((column) => {
      const convert = table.convert?.[column];
      return convert ? convert(row[column]) : row[column];
    }),
  }));

  for (let i = 0; i < statements.length; i += 100) {
    await turso.batch(statements.slice(i, i + 100), "write");
  }
  console.log(`${table.name}: ${rows.length} rows`);
}

await turso.execute("pragma foreign_keys = off");
for (const table of tables) await copyTable(table);
await turso.execute("pragma foreign_keys = on");
console.log("Migration copy complete.");
