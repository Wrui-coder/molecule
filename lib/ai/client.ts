import Anthropic from "@anthropic-ai/sdk";

/** Model + endpoint come from the environment so the same code runs against a
 *  local relay, a self-hosted gateway, or the Anthropic API unchanged. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

/**
 * Budget for the *whole* reply, thinking included.
 *
 * Reasoning models bill their scratchpad against this same ceiling, and a
 * single-file app is 10–13k output tokens on its own. The default is
 * deliberately generous: the failure mode of a tight limit is not a short
 * answer, it is a run that spends every last token thinking and returns
 * nothing at all.
 */
export const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 32000);

/**
 * Optional cap on the reasoning block. Without one, some models will think for
 * 40k+ tokens before writing the first line of code — which is both slow and,
 * with a fixed `max_tokens`, a way to starve the actual answer. Set to 0 to
 * leave the model's own default alone.
 */
export const THINKING_BUDGET_TOKENS = Number(process.env.LLM_THINKING_BUDGET ?? 2000);

export const thinkingConfig = (): { type: "enabled"; budget_tokens: number } | undefined =>
  THINKING_BUDGET_TOKENS > 0 && THINKING_BUDGET_TOKENS < MAX_TOKENS
    ? { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS }
    : undefined;

/**
 * Turn whatever the SDK threw into one line a person can read.
 *
 * The SDK folds the entire response body into `error.message`, so a refused
 * request reaches the UI as `403 {"type":"error","error":{...}}`. The gateway's
 * own sentence is in there, wrapped in the JSON — dig it out, and keep the
 * status as a suffix for when it matters.
 */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return raw;
  try {
    // Control characters are illegal inside JSON strings; relays that hand-build
    // their error bodies send them anyway. Swap for spaces before parsing.
    const body = JSON.parse(json[0].replace(/[\u0000-\u001f]/g, " ")) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const inner = body.error?.message ?? body.message;
    if (typeof inner === "string" && inner.trim()) {
      const status = raw.slice(0, json.index).trim();
      return status ? `${inner.trim()}（${status}）` : inner.trim();
    }
  } catch {
    // Not JSON after all — show it unchanged rather than swallow it.
  }
  return raw;
}

export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少模型凭证：请配置 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY");
  }
  return new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL,
    // Relay gateways are not always happy with SDK retries on long streams.
    maxRetries: 1,
  });
}
