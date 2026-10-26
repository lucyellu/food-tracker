// Point foods.image_url at each cutout in public/foods/.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";

const db = createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:./tmp/food-tracker-local.db" });
const slugs = (await fs.readdir("public/foods")).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5));
await db.execute("update foods set image_url = null where image_url like '/foods/%'");
let n = 0;
for (const slug of slugs) {
  const r = await db.execute({ sql: "update foods set image_url = ? where slug = ?", args: [`/foods/${slug}.webp`, slug] });
  n += r.rowsAffected;
}
console.log(`linked ${n}/${slugs.length}`);
