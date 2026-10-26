// Map PriceSmart past-purchase products (tmp/pricesmart/products.tsv: id<TAB>name) to foods via receipt line items,
// download each product's photo from the public Save-On-Foods image CDN into tmp/food-photos/ps/<slug>.jpg.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";

const db = createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:./tmp/food-tracker-local.db" });
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const stripSize = (name) =>
  name.replace(/(,\s*)?\d+(\.\d+)?\s*(gram|kilogram|millilitre|litre|pound|ounce|each|pack|g|mm|ml|l|kg)\b.*$/i, "").trim();

const products = (await fs.readFile("tmp/pricesmart/products.tsv", "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [id, name] = l.split("\t");
    return { id, name, key: norm(stripSize(name)) };
  });

const rows = (
  await db.execute(
    `select li.raw_name, f.slug, f.name fname, count(*) n
       from line_items li join product_catalog p on p.id = li.product_id join foods f on f.id = p.food_id
      group by li.raw_name, f.slug`,
  )
).rows;
const byKey = new Map();
for (const r of rows) {
  const k = norm(stripSize(String(r.raw_name)));
  const list = byKey.get(k) ?? [];
  list.push({ slug: String(r.slug), fname: String(r.fname), n: Number(r.n) });
  byKey.set(k, list);
}

const best = new Map(); // slug -> {product, n}
let hit = 0;
for (const p of products) {
  const cands = byKey.get(p.key);
  if (!cands) continue;
  hit++;
  for (const c of cands) {
    const cur = best.get(c.slug);
    if (!cur || c.n > cur.n) best.set(c.slug, { product: p, n: c.n, fname: c.fname });
  }
}
console.log(`products matched to receipts: ${hit}/${products.length}; foods covered: ${best.size}`);

await fs.mkdir("tmp/food-photos/ps", { recursive: true });
const manifest = {};
for (const [slug, { product, n, fname }] of best) {
  const res = await fetch(`https://images.cdn.saveonfoods.com/cell/${product.id}.jpg`);
  if (!res.ok) {
    console.log("no image", product.id, product.name);
    continue;
  }
  await fs.writeFile(`tmp/food-photos/ps/${slug}.jpg`, Buffer.from(await res.arrayBuffer()));
  manifest[slug] = { food: fname, product: product.name, id: product.id, n };
}
await fs.writeFile("tmp/food-photos/ps-manifest.json", JSON.stringify(manifest, null, 1));
console.log("downloaded", Object.keys(manifest).length);
