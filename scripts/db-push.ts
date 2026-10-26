/**
 * Apply the schema DDL to the database in DATABASE_URL (production = Neon).
 * Single source of truth stays `lib/db/ddl.ts`; this is just the delivery
 * vehicle so the same SQL that bootstraps local PGlite bootstraps Neon too.
 *
 *   npx tsx scripts/db-push.ts
 *
 * No-op (exits 0) when DATABASE_URL is unset — local dev auto-creates tables
 * in PGlite on first connection.
 *
 * Neon's HTTP endpoint runs every query as a *prepared statement*, so it only
 * accepts one statement per request ("cannot insert multiple commands into a
 * prepared statement"). The DDL is therefore split and sent statement by
 * statement. `neon().unsafe()` is not usable here: on this driver version it
 * resolves without executing, silently, which is exactly the kind of failure
 * you do not want in a migration path.
 */
import { neon } from "@neondatabase/serverless";
import { DDL } from "../lib/db/ddl";

/** The statement array the driver's tagged-template path expects. Building it
 *  by hand lets us run SQL arriving as a runtime string, which a tagged
 *  template cannot express directly. */
function raw(text: string): TemplateStringsArray {
  return Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray;
}

/** Split on statement boundaries. Safe for this DDL: no semicolons inside
 *  string literals, no dollar-quoted bodies, no functions. */
function splitStatements(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set — skipping push (local PGlite self-bootstraps).");
    return;
  }

  const sql = neon(url);
  const statements = splitStatements(DDL);
  for (const [i, statement] of statements.entries()) {
    await sql(raw(statement));
    console.log(`  [${i + 1}/${statements.length}] ok — ${statement.split("\n")[0].slice(0, 60)}`);
  }
  console.log(`DDL applied: ${statements.length} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
