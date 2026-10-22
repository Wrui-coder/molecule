import { deleteApp, getApp } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const bundle = await getApp(id);
  if (!bundle) return Response.json({ error: "应用不存在" }, { status: 404 });
  return Response.json(bundle);
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteApp(id);
  return Response.json({ ok: true });
}
