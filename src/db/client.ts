import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Use an obvious placeholder when DATABASE_URL is missing so build-time static
// analysis doesn't crash. Runtime queries will fail with a clearer error.
const url =
  process.env.DATABASE_URL ||
  "postgresql://invalid:invalid@invalid.neon.tech/invalid?sslmode=require";

const sqlClient = neon(url);
export const db = drizzle(sqlClient, { schema });
export { schema };

