import { enrichReceiptNutrition } from "../src/lib/nutrition/usda.ts";

async function main() {
  console.log("Enriching receipt 205...");
  const res = await enrichReceiptNutrition(205);
  console.log("Result:", res);
}

main().catch(console.error);
