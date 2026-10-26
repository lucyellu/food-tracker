// For foods without a photo, search T&T's public catalog by food name and download the best match
// into tmp/food-photos/raw/<slug>.<ext>. Writes tmp/food-photos/manifest.json so matches can be reviewed.
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const db = createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:./tmp/food-tracker-local.db" });
const rawDir = path.resolve("tmp/food-photos/raw");
const manifestPath = path.resolve("tmp/food-photos/manifest.json");
await fs.mkdir(rawDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}"));

const GRAPHQL = "https://www.tntsupermarket.com/graphql";
const stem = (w) => w.toLowerCase().replace(/(ies)$/, "y").replace(/(es|s)$/, "");
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map(stem);

async function search(q) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "FoodTracker/0.1 local app" },
    body: JSON.stringify({
      query: `query($s:String!){products(search:$s,pageSize:20){items{sku name small_image{url} image{url}}}}`,
      variables: { s: q },
    }),
  });
  const j = await res.json();
  return j.data?.products?.items ?? [];
}

// Every word of the food's name must appear in the product name; prefer the shortest (most generic) product.
function pick(foodName, items) {
  const want = tokens(foodName);
  const ok = items
    .filter((i) => i.name && (i.small_image?.url || i.image?.url))
    .filter((i) => { const have = new Set(tokens(i.name)); return want.every((w) => have.has(w)); })
    .sort((a, b) => a.name.length - b.name.length);
  return ok[0] ?? null;
}

const foods = (
  await db.execute("select slug, name from foods where image_url is null and kind <> 'non_food' order by id")
).rows;

const hashes = new Map();
let hit = 0;
for (const f of foods) {
  const slug = String(f.slug);
  if (manifest[slug]) continue;
  try {
    const item = pick(String(f.name), await search(String(f.name)));
    if (!item) { manifest[slug] = { status: "no-match" }; continue; }
    const url = item.image?.url ?? item.small_image.url;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = createHash("md5").update(bytes).digest("hex");
    hashes.set(hash, [...(hashes.get(hash) ?? []), slug]);
    const type = res.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    await fs.writeFile(path.join(rawDir, `${slug}.${ext}`), bytes);
    manifest[slug] = { status: "ok", source: "T&T", product: item.name, url, hash };
    hit++;
  } catch (e) {
    manifest[slug] = { status: "error", error: String(e.message) };
  }
  await new Promise((r) => setTimeout(r, 250));
}

// Same bytes under several foods = a retailer placeholder, not a product photo.
for (const slugs of hashes.values()) {
  if (slugs.length < 2) continue;
  for (const s of slugs) {
    for (const ext of ["jpg", "png", "webp"]) await fs.rm(path.join(rawDir, `${s}.${ext}`), { force: true });
    manifest[s] = { status: "placeholder" };
    hit--;
  }
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`searched ${foods.length} foods, ${hit} photos downloaded`);
