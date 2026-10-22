import { createApp, listApps } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ apps: await listApps() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const idea = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (idea.length < 4) {
    return Response.json({ error: "请再描述得具体一点（至少 4 个字）" }, { status: 400 });
  }
  if (idea.length > 2000) {
    return Response.json({ error: "描述太长了，请精简到 2000 字以内" }, { status: 400 });
  }

  const app = await createApp(idea);
  return Response.json({ id: app.id, title: app.title }, { status: 201 });
}
