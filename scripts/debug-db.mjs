import { createClient } from "@libsql/client";
async function main() {
  const client = createClient({ url: "file:./tmp/food-tracker-local.db" });
  try {
    const res = await client.execute("SELECT id, purchased_at, total FROM receipts WHERE id = 205");
    console.log("Receipt 205:", res.rows);
  } finally {
    client.close();
  }
}
main().catch(console.error);
