import {
  integer,
  text,
  real,
  sqliteTable,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = (name = "id") => integer(name).primaryKey({ autoIncrement: true });
const boolean = (name: string) => integer(name, { mode: "boolean" });
const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const receipts = sqliteTable(
  "receipts",
  {
    id: id(),
    vendor: text("vendor"),
    purchasedAt: text("purchased_at"),
    total: real("total"),
    source: text("source", {
      enum: ["manual_text", "manual_image", "manual_email_paste", "auto_email", "google_photos"],
    }).notNull(),
    sourceMessageId: text("source_message_id"),
    rawInputKind: text("raw_input_kind", { enum: ["text", "image", "email"] }).notNull(),
    rawInputRef: text("raw_input_ref"),
    parseStatus: text("parse_status", { enum: ["pending", "parsed", "failed"] })
      .notNull()
      .default("pending"),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    uniqueIndex("receipts_source_message_id_unique").on(t.sourceMessageId),
    index("receipts_purchased_at_idx").on(t.purchasedAt),
    index("receipts_created_at_idx").on(t.createdAt),
  ],
);

export const FOOD_KINDS = [
  "produce",
  "protein",
  "dairy",
  "bakery",
  "prepared",
  "frozen",
  "pantry",
  "snack",
  "drink",
  "condiment",
  "spice",
  "non_food",
] as const;

// A canonical food ("cilantro", "soy sauce") that many retailer products roll up
// into. Lifetimes are learned per food so three cilantro SKUs share one history.
export const foods = sqliteTable(
  "foods",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    kind: text("kind", { enum: FOOD_KINDS }).notNull(),
    // Days before an opened/bought package spoils.
    shelfLifeDays: integer("shelf_life_days").notNull(),
    // Days one person typically takes to finish a package; used until enough
    // repurchases exist to learn the real interval.
    typicalFinishDays: integer("typical_finish_days").notNull(),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at"),
  },
  (t) => [uniqueIndex("foods_slug_unique").on(t.slug)],
);

export const productCatalog = sqliteTable(
  "product_catalog",
  {
    id: id(),
    foodId: integer("food_id").references(() => foods.id, { onDelete: "set null" }),
    productKey: text("product_key").notNull(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name"),
    category: text("category"),
    brand: text("brand"),
    barcode: text("barcode"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    retailerSku: text("retailer_sku"),
    productSource: text("product_source"),
    productUrl: text("product_url"),
    productImageUrl: text("product_image_url"),
    fdcId: integer("fdc_id"),
    firstSeenAt: timestamp("first_seen_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    uniqueIndex("product_catalog_product_key_unique").on(t.productKey),
    index("product_catalog_display_name_idx").on(t.displayName),
    index("product_catalog_retailer_sku_idx").on(t.retailerSku),
    index("product_catalog_barcode_idx").on(t.barcode),
    index("product_catalog_external_idx").on(t.externalSource, t.externalId),
    index("product_catalog_food_id_idx").on(t.foodId),
  ],
);

export const lineItems = sqliteTable(
  "line_items",
  {
    id: id(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productCatalog.id, {
      onDelete: "set null",
    }),
    rawName: text("raw_name").notNull(),
    normalizedName: text("normalized_name"),
    category: text("category"),
    brand: text("brand"),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit").notNull().default("count"),
    price: real("price"),
    retailerSku: text("retailer_sku"),
    productSource: text("product_source"),
    productUrl: text("product_url"),
    productImageUrl: text("product_image_url"),
    consumptionStatus: text("consumption_status", {
      enum: ["available", "pantry", "fridge", "consumed", "disposed", "unavailable", "refunded"],
    })
      .notNull()
      .default("available"),
    statusDate: text("status_date"),
    autoConsumed: boolean("auto_consumed").notNull().default(false),
    fdcId: integer("fdc_id"),
    nutritionStatus: text("nutrition_status", {
      enum: ["pending", "matched", "unmatched", "manual"],
    })
      .notNull()
      .default("pending"),
  },
  (t) => [
    index("line_items_receipt_id_idx").on(t.receiptId),
    index("line_items_product_id_idx").on(t.productId),
  ],
);

export const nutritionFacts = sqliteTable("nutrition_facts", {
  lineItemId: integer("line_item_id")
    .primaryKey()
    .references(() => lineItems.id, { onDelete: "cascade" }),
  totalGrams: real("total_grams"),
  calories: real("calories"),
  proteinG: real("protein_g"),
  carbsG: real("carbs_g"),
  fatG: real("fat_g"),
  fiberG: real("fiber_g"),
  sugarG: real("sugar_g"),
  sodiumMg: real("sodium_mg"),
  alcoholG: real("alcohol_g"),
  caffeineMg: real("caffeine_mg"),
  vitaminsJson: text("vitamins_json"),
  mineralsJson: text("minerals_json"),
  ingredientsText: text("ingredients_text"),
  activeIngredientsJson: text("active_ingredients_json"),
});

export const consumptionLogs = sqliteTable(
  "consumption_logs",
  {
    id: id(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    lineItemId: integer("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    consumedAt: text("consumed_at").notNull(),
    amount: real("amount").notNull().default(1),
    unit: text("unit", { enum: ["item", "serving", "g", "100g"] })
      .notNull()
      .default("serving"),
    note: text("note"),
    createdAt: timestamp("created_at"),
  },
  (t) => [
    index("consumption_logs_receipt_id_idx").on(t.receiptId),
    index("consumption_logs_line_item_id_idx").on(t.lineItemId),
    index("consumption_logs_consumed_at_idx").on(t.consumedAt),
  ],
);

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  people: integer("people").notNull().default(2),
  days: integer("days").notNull().default(7),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  emailHost: text("email_host").default("imap.gmail.com"),
  emailPort: integer("email_port").default(993),
  emailUsername: text("email_username"),
  emailPasswordEncrypted: text("email_password_encrypted"),
  emailMailbox: text("email_mailbox").default("Receipts"),
  emailPollIntervalMin: integer("email_poll_interval_min").default(5),
});

export const emailAccounts = sqliteTable(
  "email_accounts",
  {
    id: id(),
    provider: text("provider", { enum: ["gmail_oauth", "yahoo_imap"] }).notNull(),
    label: text("label"),
    email: text("email"),
    host: text("host"),
    port: integer("port"),
    mailbox: text("mailbox").notNull().default("INBOX"),
    query: text("query"),
    secretEncrypted: text("secret_encrypted").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (t) => [
    index("email_accounts_provider_idx").on(t.provider),
    index("email_accounts_enabled_idx").on(t.enabled),
  ],
);

export const emailIngestLog = sqliteTable(
  "email_ingest_log",
  {
    id: id(),
    emailAccountId: integer("email_account_id").references(() => emailAccounts.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamp("received_at"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    messageId: text("message_id"),
    status: text("status", {
      enum: ["parsed", "skipped_not_receipt", "failed"],
    }).notNull(),
    receiptId: integer("receipt_id").references(() => receipts.id, {
      onDelete: "set null",
    }),
    errorText: text("error_text"),
  },
  (t) => [
    index("email_ingest_log_account_id_idx").on(t.emailAccountId),
    index("email_ingest_log_received_at_idx").on(t.receivedAt),
    index("email_ingest_log_message_id_idx").on(t.messageId),
  ],
);

export const googlePhotoConnections = sqliteTable("google_photo_connections", {
  id: integer("id").primaryKey().default(1),
  email: text("email"),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const usdaCache = sqliteTable("usda_cache", {
  fdcId: integer("fdc_id").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  cachedAt: timestamp("cached_at"),
});

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ProductCatalogItem = typeof productCatalog.$inferSelect;
export type NewProductCatalogItem = typeof productCatalog.$inferInsert;
export type LineItem = typeof lineItems.$inferSelect;
export type NewLineItem = typeof lineItems.$inferInsert;
export type NutritionFact = typeof nutritionFacts.$inferSelect;
export type NewNutritionFact = typeof nutritionFacts.$inferInsert;
export type ConsumptionLog = typeof consumptionLogs.$inferSelect;
export type NewConsumptionLog = typeof consumptionLogs.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type GooglePhotoConnection = typeof googlePhotoConnections.$inferSelect;
