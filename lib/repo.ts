import "server-only";

import { and, asc, avg, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { apps, messages, versions, type AppRow, type MessageRow, type VersionRow } from "./db/schema";
import { titleFromIdea } from "./ai/prompt";

export interface AppBundle {
  app: AppRow;
  versions: VersionRow[];
  messages: MessageRow[];
}

export async function createApp(idea: string): Promise<AppRow> {
  const db = await getDb();
  const [app] = await db
    .insert(apps)
    .values({ title: titleFromIdea(idea), prompt: idea, status: "draft" })
    .returning();
  await db.insert(messages).values({ appId: app.id, role: "user", content: idea });
  return app;
}

export async function getApp(id: string): Promise<AppBundle | null> {
  const db = await getDb();
  const [app] = await db.select().from(apps).where(eq(apps.id, id)).limit(1);
  if (!app) return null;

  const [versionRows, messageRows] = await Promise.all([
    db.select().from(versions).where(eq(versions.appId, id)).orderBy(asc(versions.version)),
    db.select().from(messages).where(eq(messages.appId, id)).orderBy(asc(messages.createdAt)),
  ]);
  return { app, versions: versionRows, messages: messageRows };
}

export interface AppCard {
  id: string;
  title: string;
  prompt: string;
  status: string;
  currentVersion: number;
  updatedAt: Date;
  /** Newest version's one-line summary, shown under the card. */
  summary: string | null;
  /** Newest version's document, rendered as a live thumbnail on the gallery. */
  previewHtml: string | null;
}

/**
 * Gallery rows: the app plus a peek at its newest version.
 *
 * Deliberately two queries rather than one correlated scalar subquery. A
 * subquery written as `WHERE v.app_id = ${apps.id}` gets emitted unqualified
 * (`WHERE v.app_id = "id"`), and "id" then resolves against the *inner* table
 * — `versions` also has an `id` — so the comparison silently matches nothing
 * and every card comes back without a preview. `DISTINCT ON` says what it
 * means and leaves the scoping to us.
 */
export async function listApps(limit = 12): Promise<AppCard[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: apps.id,
      title: apps.title,
      prompt: apps.prompt,
      status: apps.status,
      currentVersion: apps.currentVersion,
      updatedAt: apps.updatedAt,
    })
    .from(apps)
    // Only apps that produced at least one version — a gallery card with no
    // preview is just an empty box.
    .where(gt(apps.currentVersion, 0))
    .orderBy(desc(apps.updatedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const latest = await db
    .selectDistinctOn([versions.appId], {
      appId: versions.appId,
      summary: versions.summary,
      html: versions.html,
    })
    .from(versions)
    .where(inArray(versions.appId, rows.map((row) => row.id)))
    .orderBy(versions.appId, desc(versions.version));

  const byApp = new Map(latest.map((version) => [version.appId, version]));
  return rows.map((row) => ({
    ...row,
    summary: byApp.get(row.id)?.summary ?? null,
    previewHtml: byApp.get(row.id)?.html ?? null,
  }));
}

export async function getStats() {
  const db = await getDb();
  // "已生成应用" means an app that actually produced code. Someone who typed an
  // idea and closed the tab should not inflate the number.
  const [[appCount], [versionAgg]] = await Promise.all([
    db.select({ n: count() }).from(apps).where(gt(apps.currentVersion, 0)),
    db.select({ n: count(), avgMs: avg(versions.durationMs) }).from(versions),
  ]);
  return {
    apps: Number(appCount?.n ?? 0),
    versions: Number(versionAgg?.n ?? 0),
    avgSeconds: versionAgg?.avgMs ? Math.round(Number(versionAgg.avgMs) / 1000) : null,
  };
}

export async function getVersion(appId: string, version: number): Promise<VersionRow | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.appId, appId), eq(versions.version, version)))
    .limit(1);
  return row ?? null;
}

/** Appends a new version and repoints the app at it. History stays append-only,
 *  so a rollback is expressible as just another version. */
export async function appendVersion(params: {
  appId: string;
  instruction: string;
  summary: string;
  html: string;
  durationMs?: number;
  title?: string;
}): Promise<VersionRow> {
  const db = await getDb();
  const [app] = await db.select().from(apps).where(eq(apps.id, params.appId)).limit(1);
  if (!app) throw new Error("应用不存在");

  const next = app.currentVersion + 1;
  const [row] = await db
    .insert(versions)
    .values({
      appId: params.appId,
      version: next,
      instruction: params.instruction,
      summary: params.summary,
      html: params.html,
      durationMs: params.durationMs ?? 0,
    })
    .returning();

  await db
    .update(apps)
    .set({
      currentVersion: next,
      status: "ready",
      updatedAt: new Date(),
      ...(params.title ? { title: params.title } : {}),
    })
    .where(eq(apps.id, params.appId));

  return row;
}

export async function addMessage(params: {
  appId: string;
  role: "user" | "assistant";
  content: string;
  version?: number;
}) {
  const db = await getDb();
  await db.insert(messages).values({
    appId: params.appId,
    role: params.role,
    content: params.content,
    version: params.version ?? null,
  });
}

export async function setStatus(appId: string, status: AppRow["status"]) {
  const db = await getDb();
  await db.update(apps).set({ status, updatedAt: new Date() }).where(eq(apps.id, appId));
}

export async function deleteApp(appId: string) {
  const db = await getDb();
  await db.delete(apps).where(eq(apps.id, appId));
}
