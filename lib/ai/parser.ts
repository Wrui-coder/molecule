/**
 * Incremental parser for the model's tagged output.
 *
 * The model streams `<name>…`, `<summary>…` and `<file>…</file>`. We must be
 * able to act on a *partial* document — that is what lets the preview render
 * while the model is still writing.
 *
 * Implemented as "re-scan the accumulated buffer, remember what we already
 * emitted" rather than a character-level state machine. A state machine would
 * be O(n), but it has to handle every tag being split across chunk boundaries;
 * this is trivially correct, and at a few tens of KB the re-scan costs
 * microseconds while the throttle keeps it to ~4 scans/second.
 */

export interface Parsed {
  name?: string;
  summary?: string;
  /** HTML emitted so far — may be incomplete while streaming. */
  html?: string;
  /** True once the closing tag was seen, i.e. html is final. */
  complete: boolean;
}

const FILE_OPEN = /<file[^>]*>/i;

/** Models sometimes wrap the file body in a markdown fence despite being told
 *  not to. Strip a leading fence + language and a trailing fence. */
function stripFences(html: string): string {
  let out = html.replace(/^\s*```[a-z]*\s*\n?/i, "");
  out = out.replace(/\n?```\s*$/, "");
  return out;
}

export function parse(buffer: string): Parsed {
  const name = /<name>([\s\S]*?)<\/name>/i.exec(buffer)?.[1]?.trim();
  const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(buffer)?.[1]?.trim();

  const open = FILE_OPEN.exec(buffer);

  if (open && open.index !== undefined) {
    const body = buffer.slice(open.index + open[0].length);
    const close = body.search(/<\/file>/i);
    if (close !== -1) {
      return { name, summary, html: stripFences(body.slice(0, close)).trim(), complete: true };
    }
    return { name, summary, html: stripFences(body).trim(), complete: false };
  }

  // Fallback 1: the model ignored the tag protocol and used a ```html fence.
  const fence = /```(?:html|HTML)?\s*\n([\s\S]*?)(?:```|$)/.exec(buffer);
  if (fence) {
    return { name, summary, html: fence[1].trim(), complete: /```/.test(buffer.slice(fence.index)) };
  }

  // Fallback 2: bare document. Start at the doctype or <html>, whatever came first.
  const start = (() => {
    const doctype = buffer.search(/<!doctype html>/i);
    if (doctype !== -1) return doctype;
    return buffer.search(/<html[\s>]/i);
  })();
  if (start !== -1) {
    const tail = buffer.slice(start);
    const closed = /<\/html>/i.test(tail);
    return { name, summary, html: tail.trim(), complete: closed };
  }

  return { name, summary, complete: false };
}
