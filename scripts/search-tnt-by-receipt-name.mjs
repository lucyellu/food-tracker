// For foods still without a photo, search T&T's catalog using the exact names from their receipts.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";

const db = createClient({ url: "file:./tmp/food-tracker-local.db" });
const dir = "tmp/food-photos/tnt2";
await fs.mkdir(dir, { recursive: true });
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
const tokens = (s) =>
  s.toLowerCase().replace(/\(.*?\)|\b\d+(\.\d+)?\s*(g|kg|ml|l|lb|oz|pk|pcs?)\b/g, " ").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((w) => w.length > 1 && !["tt", "fresh", "frozen"].includes(w)).map(stem);

async function search(q) {
  const res = await fetch("https://www.tntsupermarket.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "FoodTracker/0.1 local app" },
    body: JSON.stringify({
      query: `query($s:String!){products(search:$s,pageSize:12){items{sku name small_image{url} image{url}}}}`,
      variables: { s: q },
    }),
  });
  return (await res.json()).data?.products?.items ?? [];
}

const rows = (await db.execute(
  `select f.slug, f.name fname, li.raw_name, count(*) n from foods f join product_catalog p on p.food_id=f.id
   join line_items li on li.product_id=p.id join receipts r on r.id=li.receipt_id
   where f.image_url is null and f.kind <> 'non_food' and f.name <> 'Unknown Item' and r.vendor like 'T&T%'
   group by f.slug, li.raw_name order by f.slug, n desc`,
)).rows;
const bySlug = new Map();
for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);

const manifest = {};
for (const [slug, list] of bySlug) {
  for (const r of list.slice(0, 2)) {
    const want = tokens(String(r.raw_name));
    if (want.length === 0) continue;
    const items = (await search(want.join(" "))).filter((i) => i.name && (i.image?.url || i.small_image?.url));
    let best = null;
    for (const i of items) {
      const have = new Set(tokens(i.name));
      const hit = want.filter((w) => have.has(w)).length;
      const score = hit / want.length;
      if (score >= 0.75 && (!best || score > best.score || (score === best.score && i.name.length < best.i.name.length))) best = { i, score };
    }
    if (!best) continue;
    const url = best.i.image?.url ?? best.i.small_image.url;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) continue;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 3000) continue;
    const ext = (res.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
    await fs.writeFile(`${dir}/${slug}.${ext}`, bytes);
    manifest[slug] = { food: r.fname, receipt: r.raw_name, product: best.i.name, score: +best.score.toFixed(2) };
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
await fs.writeFile("tmp/food-photos/tnt2-manifest.json", JSON.stringify(manifest, null, 1));
console.log(`foods tried ${bySlug.size}, matched ${Object.keys(manifest).length}`);
