import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const receipts = pgTable(
  "receipts",
  {
    id: serial("id").primaryKey(),
    vendor: text("vendor"),
    purchasedAt: text("purchased_at"),
    total: doublePrecision("total"),
    source: text("source", {
      enum: ["manual_text", "manual_image", "manual_email_paste", "auto_email"],
    }).notNull(),
    sourceMessageId: text("source_message_id"),
    rawInputKind: text("raw_input_kind", { enum: ["text", "image", "email"] }).notNull(),
    rawInputRef: text("raw_input_ref"),
    parseStatus: text("parse_status", { enum: ["pending", "parsed", "failed"] })
      .notNull()
      .default("pending"),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("receipts_source_message_id_unique").on(t.sourceMessageId),
    index("receipts_purchased_at_idx").on(t.purchasedAt),
    index("receipts_created_at_idx").on(t.createdAt),
  ],
);

export const lineItems = pgTable(
  "line_items",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    normalizedName: text("normalized_name"),
    brand: text("brand"),
    quantity: doublePrecision("quantity").notNull().default(1),
    unit: text("unit").notNull().default("count"),
    price: doublePrecision("price"),
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
    fdcId: integer("fdc_id"),
    nutritionStatus: text("nutrition_status", {
      enum: ["pending", "matched", "unmatched", "manual"],
    })
      .notNull()
      .default("pending"),
  },
  (t) => [index("line_items_receipt_id_idx").on(t.receiptId)],
);

export const nutritionFacts = pgTable("nutrition_facts", {
  lineItemId: integer("line_item_id")
    .primaryKey()
    .references(() => lineItems.id, { onDelete: "cascade" }),
  totalGrams: doublePrecision("total_grams"),
  calories: doublePrecision("calories"),
  proteinG: doublePrecision("protein_g"),
  carbsG: doublePrecision("carbs_g"),
  fatG: doublePrecision("fat_g"),
  fiberG: doublePrecision("fiber_g"),
  sugarG: doublePrecision("sugar_g"),
  sodiumMg: doublePrecision("sodium_mg"),
  alcoholG: doublePrecision("alcohol_g"),
  caffeineMg: doublePrecision("caffeine_mg"),
  vitaminsJson: text("vitamins_json"),
  mineralsJson: text("minerals_json"),
  ingredientsText: text("ingredients_text"),
  activeIngredientsJson: text("active_ingredients_json"),
});

export const consumptionLogs = pgTable(
  "consumption_logs",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    lineItemId: integer("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    consumedAt: text("consumed_at").notNull(),
    amount: doublePrecision("amount").notNull().default(1),
    unit: text("unit", { enum: ["item", "serving", "g", "100g"] })
      .notNull()
      .default("serving"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("consumption_logs_receipt_id_idx").on(t.receiptId),
    index("consumption_logs_line_item_id_idx").on(t.lineItemId),
    index("consumption_logs_consumed_at_idx").on(t.consumedAt),
  ],
);

export const settings = pgTable("settings", {
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

export const emailIngestLog = pgTable(
  "email_ingest_log",
  {
    id: serial("id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    index("email_ingest_log_received_at_idx").on(t.receivedAt),
    index("email_ingest_log_message_id_idx").on(t.messageId),
  ],
);

export const usdaCache = pgTable("usda_cache", {
  fdcId: integer("fdc_id").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type LineItem = typeof lineItems.$inferSelect;
export type NewLineItem = typeof lineItems.$inferInsert;
export type NutritionFact = typeof nutritionFacts.$inferSelect;
export type NewNutritionFact = typeof nutritionFacts.$inferInsert;
export type ConsumptionLog = typeof consumptionLogs.$inferSelect;
export type NewConsumptionLog = typeof consumptionLogs.$inferInsert;
export type Settings = typeof settings.$inferSelect;
