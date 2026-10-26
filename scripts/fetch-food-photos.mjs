// Download one retailer product photo per food into tmp/food-photos/raw/<slug>.<ext>.
// Run scripts/cutout-food-photos.py afterwards to strip backgrounds into public/foods/.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const db = createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:./tmp/food-tracker-local.db" });
const outDir = path.resolve("tmp/food-photos/raw");
await fs.mkdir(outDir, { recursive: true });

const rows = (
  await db.execute(`
    select f.slug, p.product_image_url url, p.product_source src
    from foods f join product_catalog p on p.food_id = f.id
    where p.product_image_url is not null and p.product_image_url <> ''
    order by f.id, (p.product_source = 'T&T') desc, p.id desc`)
).rows;

// Hand-picked exclusions: the retailer photo is a logo or artwork, not the food.
const SKIP = new Set(["spring-roll"]);
const bySlug = new Map();
for (const r of rows) if (!SKIP.has(r.slug) && !bySlug.has(r.slug)) bySlug.set(r.slug, r);

let ok = 0;
const byHash = new Map();
for (const [slug, r] of bySlug) {
  try {
    const res = await fetch(String(r.url), { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const bytes = Buffer.from(await res.arrayBuffer());
    const file = path.join(outDir, `${slug}.${ext}`);
    await fs.writeFile(file, bytes);
    const hash = createHash("md5").update(bytes).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    ok++;
  } catch (e) {
    console.log("skip", slug, e.message);
  }
}
// The same bytes under several foods means a retailer placeholder (e.g. the T&T logo), not a product.
for (const files of byHash.values()) {
  if (files.length < 2) continue;
  for (const file of files) await fs.rm(file);
  ok -= files.length;
  console.log("dropped placeholder:", files.map((f) => path.basename(f)).join(", "));
}
console.log(`downloaded ${ok}/${bySlug.size}`);
