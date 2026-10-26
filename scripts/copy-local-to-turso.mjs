// One-off: copy every row of the local SQLite db into the hosted Turso db (tables must already exist via db:push).
import { createClient } from "@libsql/client";
const local = createClient({ url: "file:tmp/food-tracker-local.db" });
const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tables = (await local.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '%drizzle%'")).rows.map((r) => r.name);
await remote.execute("pragma foreign_keys=off").catch(() => {});
for (const t of [...tables].reverse()) await remote.execute(`delete from "${t}"`).catch(() => {});
for (const t of tables) {
  const rows = (await local.execute(`select * from "${t}"`)).rows;
  const exists = await remote.execute(`select name from sqlite_master where name='${t}'`);
  if (!exists.rows.length) { console.log(t, "MISSING remotely, skipped"); continue; }
  for (let i = 0; i < rows.length; i += 100) {
    const stmts = rows.slice(i, i + 100).map((r) => {
      const cols = Object.keys(r).filter((k) => isNaN(Number(k)));
      return { sql: `insert into "${t}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map(() => "?").join(",")})`, args: cols.map((c) => r[c]) };
    });
    await remote.batch([{ sql: "pragma defer_foreign_keys=on", args: [] }, ...stmts], "write");
  }
  console.log(t, rows.length);
}
