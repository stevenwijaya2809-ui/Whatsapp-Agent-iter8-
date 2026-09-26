/**
 * Exports every conversation and message to a timestamped JSON file.
 * The Supabase free plan keeps no backups, so run this before schema changes:
 *
 *   node scripts/export-data.mjs [outputDirectory]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

const PAGE_SIZE = 1000;

loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Reads a whole table in pages, so an export is not capped by PostgREST's row limit. */
async function readAll(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

const outputDir = process.argv[2] ?? "backups";
mkdirSync(outputDir, { recursive: true });

const tables = ["conversations", "messages"];
const dump = { exportedAt: new Date().toISOString(), project: url, tables: {} };

for (const table of tables) {
  dump.tables[table] = await readAll(table);
  console.log(`${table}: ${dump.tables[table].length} rows`);
}

const file = path.join(outputDir, `export-${dump.exportedAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(dump, null, 2));
console.log(`written to ${file}`);
