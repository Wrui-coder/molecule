import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { getClient, MAX_TOKENS, MODEL, thinkingConfig } from "./client";
import { parse } from "./parser";
import { firstUserMessage, iterationUserMessage, SYSTEM_PROMPT } from "./prompt";

export type GenEvent =
  | { t: "thinking"; d: string }
  | { t: "name"; d: string }
  | { t: "summary"; d: string }
  | { t: "preview"; d: string }
  | {
      t: "done";
      html: string;
      summary: string;
      name?: string;
      durationMs: number;
      /** true when the run was cut short — the document is whatever we had. */
      partial?: boolean;
    };

export interface GenInput {
  /** The new instruction (also the original idea, for the first version). */
  instruction: string;
  /** Null on the very first generation. */
  currentHtml: string | null;
  /** Earlier turns, oldest first: [instruction, one-line summary]. */
  history: Array<{ instruction: string; summary: string }>;
  /** Aborted when the browser disconnects or the user hits stop, which also
   *  cancels the upstream model request instead of paying for a stream nobody
   *  is reading. */
  signal?: AbortSignal;
}

const PREVIEW_THROTTLE_MS = 350;
const MIN_USABLE_HTML = 80;

/**
 * Streaming generation.
 *
 * Yields preview snapshots as soon as there is parseable HTML, so the user
 * watches their app assemble itself instead of staring at a spinner. The final
 * `done` event carries the document that gets persisted.
 */
export async function* generateApp(input: GenInput): AsyncGenerator<GenEvent> {
  const client = getClient();
  const started = Date.now();

  const messages: MessageParam[] = [];
  if (input.currentHtml) {
    // Context discipline: replay only what the app *did* (instruction + its
    // one-line summary), never the pasted code of previous versions. The current
    // document below already carries all the state that matters, so replaying
    // old HTML would just burn tokens and invite the model to resurrect
    // discarded code.
    for (const turn of input.history.slice(-6)) {
      messages.push({ role: "user", content: turn.instruction });
      messages.push({ role: "assistant", content: turn.summary || "已处理。" });
    }
  }
  messages.push({
    role: "user",
    content: input.currentHtml
      ? iterationUserMessage(input.currentHtml, input.instruction)
      : firstUserMessage(input.instruction),
  });

  const stream = await client.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      stream: true,
      ...(thinkingConfig() ? { thinking: thinkingConfig()! } : {}),
    },
    { signal: input.signal },
  );

  let buffer = "";
  let lastPreviewAt = 0;
  let lastHtmlLength = 0;
  const sent = { name: false, summary: false };

  let aborted = false;
  let stopReason: string | null = null;
  let outputTokens = 0;
  try {
    for await (const event of stream) {
      // Kept for diagnostics: when a run ends with no usable document, the
      // reason it stopped is the difference between "raise the token budget"
      // and "the model ignored the protocol".
      if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason ?? stopReason;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        continue;
      }
      if (event.type !== "content_block_delta") continue;

      const delta = event.delta as { type: string; text?: string; thinking?: string };

      if (delta.type === "thinking_delta" && delta.thinking) {
        // Reasoning models emit a thinking block first. The client shows a short
        // tail of it as a "what is it doing right now" ticker.
        yield { t: "thinking", d: delta.thinking };
        continue;
      }

      if (delta.type !== "text_delta" || !delta.text) continue;

      buffer += delta.text;
      const p = parse(buffer);

      if (p.name && !sent.name) {
        sent.name = true;
        yield { t: "name", d: p.name };
      }
      if (p.summary && !sent.summary) {
        sent.summary = true;
        yield { t: "summary", d: p.summary };
      }

      const now = Date.now();
      if (p.html && p.html.length > lastHtmlLength && now - lastPreviewAt > PREVIEW_THROTTLE_MS) {
        lastPreviewAt = now;
        lastHtmlLength = p.html.length;
        yield { t: "preview", d: p.html };
      }
    }
  } catch (err) {
    // A cancelled stream surfaces as a throw. If the *caller* asked for the
    // cancellation, that is a normal stop, not a failure — keep the partial.
    if (!input.signal?.aborted) throw err;
    aborted = true;
  }

  const final = parse(buffer);
  if (!final.html || final.html.length < MIN_USABLE_HTML) {
    if (aborted) return; // stopped before anything worth keeping
    if (stopReason === "max_tokens") {
      throw new Error(
        `模型在思考阶段就用尽了 ${MAX_TOKENS} tokens（输出 ${outputTokens}），` +
          `还没来得及写代码。调大 LLM_MAX_TOKENS，或调小 LLM_THINKING_BUDGET 后重试。`,
      );
    }
    throw new Error("模型没有返回可用的 HTML，请重试或换一个描述方式。");
  }

  yield {
    t: "done",
    html: final.html,
    summary: final.summary || "已生成",
    name: final.name,
    durationMs: Date.now() - started,
    partial: aborted,
  };
}
