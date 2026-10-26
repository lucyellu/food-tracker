import fs from "fs";
const env = fs.readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim().replace(/^"|"$/g, '');
}
import { enrichReceiptNutrition } from "../src/lib/nutrition/usda.ts";

async function main() {
  console.log("Enriching receipt 205...");
  const res = await enrichReceiptNutrition(205);
  console.log("Result:", res);
}

main().catch(console.error);
