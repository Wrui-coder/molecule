import "server-only";

import os from "node:os";
import path from "node:path";

import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Two drivers, one schema.
 *
 *  - Deployed (Vercel): `DATABASE_URL` is set → Neon over HTTP. Nothing to
 *    pool, safe in a serverless function that may be frozen at any moment.
 *  - Local: no `DATABASE_URL` → PGlite, a real Postgres compiled to WASM,
 *    persisted to a directory on disk. Same dialect, same SQL, same driver
 *    contract — so "works on my machine" and "works in production" run the
 *    exact same query code.
 */
export type DB = NeonHttpDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __moleculeDb: Promise<DB> | undefined;
}

/**
 * Kept out of the project directory on purpose: PGlite writes a lot of small
 * files as Postgres checkpoints, and a database inside the repo makes the dev
 * server's file watcher thrash on every write.
 */
function pgliteDir(): string {
  return process.env.PGLITE_DIR ?? path.join(os.tmpdir(), "molecule-pglite");
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    return drizzle(neon(url), { schema });
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(pgliteDir());
  const db = drizzle(client, { schema });
  // Local convenience: the embedded database is created empty, so make sure the
  // tables exist before the first query. In production this is a no-op path.
  const { DDL } = await import("./ddl");
  await client.exec(DDL);
  // The two drivers expose the same query builder surface for everything this
  // app uses; the cast keeps call sites free of driver branching.
  return db as unknown as DB;
}

/** Lazily connected, cached across dev hot-reloads so PGlite isn't opened twice
 *  (which would trip its single-writer lock). */
export function getDb(): Promise<DB> {
  globalThis.__moleculeDb ??= connect();
  return globalThis.__moleculeDb;
}
