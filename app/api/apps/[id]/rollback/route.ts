import { addMessage, appendVersion, getVersion } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rollback is a *forward* operation: we append a copy of an old version rather
 * than deleting the ones after it, so the history stays a complete, auditable
 * record and an accidental rollback is itself undoable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const version = Number(body?.version);

  if (!Number.isInteger(version) || version < 1) {
    return Response.json({ error: "版本号不合法" }, { status: 400 });
  }

  const source = await getVersion(id, version);
  if (!source) return Response.json({ error: "找不到该版本" }, { status: 404 });

  const summary = `回滚到 v${version}：${source.summary}`;
  const row = await appendVersion({
    appId: id,
    instruction: `回滚到 v${version}`,
    summary,
    html: source.html,
    durationMs: 0,
  });
  await addMessage({ appId: id, role: "assistant", content: summary, version: row.version });

  return Response.json({ version: row.version, summary });
}
