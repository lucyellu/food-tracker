import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const legacyDatabaseUrl = process.env.DATABASE_URL;
const legacyDatabaseUrlIsLibsql =
  legacyDatabaseUrl?.startsWith("libsql://") ||
  legacyDatabaseUrl?.startsWith("file:") ||
  legacyDatabaseUrl?.startsWith("http://") ||
  legacyDatabaseUrl?.startsWith("https://");

// Prefer explicit Turso/libSQL env vars. The file fallback keeps Next build-time
// imports from crashing before production env vars are configured.
const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.LIBSQL_URL ||
  (legacyDatabaseUrlIsLibsql ? legacyDatabaseUrl : undefined) ||
  "file:./tmp/food-tracker-local.db";
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

const client = createClient({
  url,
  authToken,
});

export const db = drizzle(client, { schema });
export { schema };
