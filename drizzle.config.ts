import type { Config } from "drizzle-kit";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.LIBSQL_URL ||
  "file:./tmp/food-tracker-local.db";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  },
} satisfies Config;
