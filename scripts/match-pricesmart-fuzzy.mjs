// Second pass: fuzzy-match remaining photo-less foods' receipt names to PriceSmart past-purchase products.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";

const db = createClient({ url: "file:./tmp/food-tracker-local.db" });
const tok = (s) =>
  new Set(
    s.toLowerCase().replace(/\b\d+(\.\d+)?\s*(gram|kilogram|millilitre|litre|pound|ounce|each|pack|g|ml|kg)\b/g, " ")
      .replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["fresh", "frozen", "the", "and", "pack"].includes(w)),
  );
const products = (await fs.readFile("tmp/pricesmart/products.tsv", "utf8")).split("\n").filter(Boolean).map((l) => {
  const [id, name] = l.split("\t");
  return { id, name, t: tok(name) };
});
const lines = (await db.execute(
  `select f.slug, f.name fname, li.raw_name, count(*) n from foods f join product_catalog p on p.food_id=f.id
   join line_items li on li.product_id=p.id where f.image_url is null and f.name <> 'Unknown Item' group by f.slug, li.raw_name`,
)).rows;
const out = [];
for (const l of lines) {
  const t = tok(String(l.raw_name));
  if (t.size === 0) continue;
  let best = null;
  for (const p of products) {
    let hit = 0;
    for (const w of t) if (p.t.has(w)) hit++;
    const score = hit / Math.max(t.size, 1);
    if (hit >= 1 && score >= 0.6 && (!best || score > best.score)) best = { p, score };
  }
  if (best) out.push({ slug: l.slug, food: l.fname, raw: l.raw_name, product: best.p.name, id: best.p.id, score: +best.score.toFixed(2), n: Number(l.n) });
}
await fs.writeFile("tmp/pricesmart/fuzzy.json", JSON.stringify(out, null, 1));
for (const o of out) console.log(`${o.slug} | ${o.raw} => ${o.product} (${o.score})`);
console.log(out.length);
