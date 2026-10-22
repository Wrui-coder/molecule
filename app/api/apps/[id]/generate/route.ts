import { generateApp } from "@/lib/ai/run";
import { addMessage, appendVersion, getApp, setStatus } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long generations must survive Vercel's function timeout; streaming keeps the
// connection active the whole time.
export const maxDuration = 300;

const encoder = new TextEncoder();
const line = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`);

/**
 * POST /api/apps/:id/generate
 *
 * Streams the agent's progress as newline-delimited JSON. The browser needs the
 * intermediate states (thinking, partial document) to show work in progress, so
 * a single JSON body would defeat the point — this is a job feed, not a
 * request/response.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return Response.json({ error: "缺少指令" }, { status: 400 });
  }

  const bundle = await getApp(id);
  if (!bundle) return Response.json({ error: "应用不存在" }, { status: 404 });

  const latest = bundle.versions.at(-1);
  const currentHtml = latest?.html ?? null;

  // Built before the incoming instruction is stored, so the new turn isn't
  // replayed twice (once as history, once as the actual prompt).
  const history: Array<{ instruction: string; summary: string }> = [];
  for (const message of bundle.messages) {
    if (message.role === "user") history.push({ instruction: message.content, summary: "" });
    else if (history.length > 0) history[history.length - 1].summary = message.content;
  }

  if (currentHtml) {
    await addMessage({ appId: id, role: "user", content: instruction });
  }
  await setStatus(id, "generating");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(line(payload));
        } catch {
          /* client vanished; the abort below will unwind the generator */
        }
      };

      try {
        for await (const event of generateApp({
          instruction,
          currentHtml,
          history,
          signal: request.signal,
        })) {
          if (event.t !== "done") {
            send(event);
            continue;
          }

          const summary = event.partial
            ? `${event.summary}（中断，已保存当前进度）`
            : event.summary;

          const version = await appendVersion({
            appId: id,
            instruction,
            summary,
            html: event.html,
            durationMs: event.durationMs,
            ...(event.name ? { title: event.name } : {}),
          });
          await addMessage({ appId: id, role: "assistant", content: summary, version: version.version });

          send({ t: "done", version: version.version, summary, durationMs: event.durationMs });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失败，请重试";
        await setStatus(id, "error").catch(() => {});
        send({ t: "error", d: message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
