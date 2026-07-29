// tools/db/push-migrations.mjs
import { readFileSync, readdirSync } from "node:fs";

const REF = "gidodxojpvztrsihnqxj";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = `https://api.supabase.com/v1/projects/${REF}/database/query`;

const run = async (sql) => {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
};

const pending = process.argv.slice(2); // versions to apply, in order
for (const v of pending) {
  const file = readdirSync("supabase/migrations").find((f) => f.startsWith(v));
  console.log(`applying ${file}`);
  await run(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await run(`insert into supabase_migrations.schema_migrations(version) values ('${v}')`);
  console.log(`  ok`);
}