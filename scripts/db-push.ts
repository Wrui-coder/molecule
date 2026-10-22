/**
 * Apply the schema DDL to the database in DATABASE_URL (production = Neon).
 * Single source of truth stays `lib/db/ddl.ts`; this is just the delivery
 * vehicle so the same SQL that bootstraps local PGlite bootstraps Neon too.
 *
 *   npx tsx scripts/db-push.ts
 *
 * No-op (exits 0) when DATABASE_URL is unset — local dev auto-creates tables
 * in PGlite on first connection.
 */
import { neon } from "@neondatabase/serverless";
import { DDL } from "../lib/db/ddl";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL not set — skipping push (local PGlite self-bootstraps).");
  process.exit(0);
}

const sql = neon(url);
await sql.unsafe(DDL);
console.log("DDL applied to DATABASE_URL target.");
