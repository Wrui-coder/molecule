"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PreviewPane from "./PreviewPane";

export interface VersionItem {
  version: number;
  instruction: string;
  summary: string;
  html: string;
  durationMs: number;
}

export interface MessageItem {
  id: string;
  role: string;
  content: string;
  version: number | null;
}

/** The preview iframe reloads on every new srcdoc, so partial rebuilds are
 *  throttled: fast enough to feel live, slow enough not to strobe. */
const PREVIEW_REFRESH_MS = 800;
const THINKING_REFRESH_MS = 300;

const tail = (text: string, max = 150) => (text.length > max ? `…${text.slice(-max)}` : text);

export default function Workspace({
  appId,
  initialTitle,
  initialPrompt,
  initialVersions,
  initialMessages,
}: {
  appId: string;
  initialTitle: string;
  initialPrompt: string;
  initialVersions: VersionItem[];
  initialMessages: MessageItem[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [versions, setVersions] = useState<VersionItem[]>(initialVersions);
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [activeNumber, setActiveNumber] = useState<number>(initialVersions.at(-1)?.version ?? 0);

  const [running, setRunning] = useState(false);
  const [liveHtml, setLiveHtml] = useState<string | null>(null);
  const [liveSummary, setLiveSummary] = useState("");
  const [thinking, setThinking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mobileView, setMobileView] = useState<"chat" | "preview">("preview");

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Cleared on unmount, re-armed by the remount that follows a StrictMode teardown. */
  const aliveRef = useRef(true);
  const teardownTimer = useRef<number | null>(null);

  // --- throttled live preview ----------------------------------------------
  const pendingHtml = useRef<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const lastPreviewAt = useRef(0);

  const flushPreview = useCallback(() => {
    previewTimer.current = null;
    if (pendingHtml.current !== null) {
      setLiveHtml(pendingHtml.current);
      pendingHtml.current = null;
      lastPreviewAt.current = Date.now();
    }
  }, []);

  const pushPreview = useCallback(
    (html: string) => {
      const elapsed = Date.now() - lastPreviewAt.current;
      if (elapsed >= PREVIEW_REFRESH_MS) {
        lastPreviewAt.current = Date.now();
        setLiveHtml(html);
        return;
      }
      pendingHtml.current = html;
      previewTimer.current ??= window.setTimeout(flushPreview, PREVIEW_REFRESH_MS - elapsed);
    },
    [flushPreview],
  );

  // --- thinking ticker ------------------------------------------------------
  const thinkingBuffer = useRef("");
  const lastThinkingAt = useRef(0);

  const pushThinking = useCallback((chunk: string) => {
    thinkingBuffer.current += chunk;
    const now = Date.now();
    if (now - lastThinkingAt.current < THINKING_REFRESH_MS) return;
    lastThinkingAt.current = now;
    setThinking(tail(thinkingBuffer.current));
  }, []);

  // --- authoritative reload -------------------------------------------------
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/apps/${appId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setVersions(data.versions);
    setMessages(data.messages);
    setTitle(data.app.title);
    setActiveNumber(data.app.currentVersion);
  }, [appId]);

  // --- the generation loop --------------------------------------------------
  const runGeneration = useCallback(
    async (instruction: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setError(null);
      setLiveSummary("");
      setThinking("");
      thinkingBuffer.current = "";
      lastThinkingAt.current = 0;
      lastPreviewAt.current = 0;
      setLiveHtml("");

      const controller = new AbortController();
      abortRef.current = controller;
      let aborted = false;

      try {
        const response = await fetch(`/api/apps/${appId}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error ?? `请求失败（${response.status}）`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!raw) continue;

            const event = JSON.parse(raw);
            if (event.t === "thinking") pushThinking(event.d);
            else if (event.t === "summary") setLiveSummary(event.d);
            else if (event.t === "preview") pushPreview(event.d);
            else if (event.t === "done") setLiveSummary(event.summary);
            else if (event.t === "error") throw new Error(event.d);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          aborted = true;
        } else {
          setError(err instanceof Error ? err.message : "生成失败，请重试");
          // On a narrow screen the preview tab is the one on show, so the
          // explanation would render in the pane nobody is looking at.
          setMobileView("chat");
        }
      } finally {
        if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
        previewTimer.current = null;
        pendingHtml.current = null;

        // The server writes the version when its stream closes, which on an
        // abort happens just after us — give it a beat before reading back.
        if (aborted) await new Promise((resolve) => setTimeout(resolve, 900));
        await refresh().catch(() => {});

        setLiveHtml(null);
        setLiveSummary("");
        setThinking("");
        setRunning(false);
        runningRef.current = false;
        abortRef.current = null;
      }
    },
    [appId, pushPreview, pushThinking, refresh],
  );

  // Kick off the very first generation as soon as the workspace opens, so the
  // user goes from "typed an idea" to "it is building" without another click.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || initialVersions.length > 0) return;
    autoStarted.current = true;
    void runGeneration(initialPrompt);
  }, [initialPrompt, initialVersions.length, runGeneration]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, running, liveSummary]);

  useEffect(() => {
    aliveRef.current = true;
    if (teardownTimer.current !== null) {
      window.clearTimeout(teardownTimer.current);
      teardownTimer.current = null;
    }

    return () => {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);

      // StrictMode (on by default in dev) mounts, tears down, then mounts again.
      // Aborting synchronously here would kill the generation the second mount is
      // about to adopt — and the auto-start guard has already been set, so nothing
      // would restart it and the workspace would wait on "等待第一版代码…" forever.
      // Waiting a beat lets the remount cancel the teardown; a real unmount leaves
      // `aliveRef` false and still stops the stream.
      aliveRef.current = false;
      teardownTimer.current = window.setTimeout(() => {
        teardownTimer.current = null;
        if (!aliveRef.current) abortRef.current?.abort();
      }, 300);
    };
  }, []);

  async function send() {
    const instruction = draft.trim();
    if (!instruction || running) return;
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: instruction, version: null },
    ]);
    setMobileView("preview");
    await runGeneration(instruction);
  }

  async function rollback(version: number) {
    if (running) return;
    await fetch(`/api/apps/${appId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
    await refresh();
  }

  const active = versions.find((item) => item.version === activeNumber) ?? versions.at(-1);
  const latest = versions.at(-1)?.version ?? 0;
  const displayHtml = liveHtml ?? active?.html ?? "";

  return (
    <div className="relative z-10 flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <Link
          href="/"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-mist transition hover:border-accent/50 hover:text-chalk"
        >
          ← 返回
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-violet text-xs font-bold text-white">
            M
          </span>
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </div>

        <StatusPill running={running} error={error} latest={latest} />

        {/* Below lg the two panes take turns in the same space. */}
        <div className="ml-auto flex rounded-lg border border-line p-0.5 lg:hidden">
          {(["chat", "preview"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setMobileView(view)}
              className={`rounded-md px-3 py-1 text-xs transition ${
                mobileView === view ? "bg-white/10 text-chalk" : "text-mist"
              }`}
            >
              {view === "chat" ? "对话" : "预览"}
            </button>
          ))}
        </div>
      </header>

      <VersionStrip
        versions={versions}
        activeNumber={active?.version ?? 0}
        latest={latest}
        running={running}
        onSelect={setActiveNumber}
        onRollback={rollback}
      />

      <div className="flex min-h-0 flex-1">
        <section
          className={`min-h-0 w-full shrink-0 flex-col border-r border-line lg:flex lg:w-[400px] ${
            mobileView === "chat" ? "flex" : "hidden"
          }`}
        >
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/30 bg-accent/15 px-3.5 py-2.5 text-sm leading-6">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex gap-2.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-violet text-[10px] font-bold text-white">
                    M
                  </span>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-white/[0.04] px-3.5 py-2.5 text-sm leading-6">
                    {message.version !== null && (
                      <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-mist">
                        v{message.version}
                      </span>
                    )}
                    {message.content}
                  </div>
                </div>
              ),
            )}

            {running && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-violet text-[10px] font-bold text-white">
                  M
                </span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-bl-md border border-line bg-white/[0.04] px-3.5 py-2.5">
                  <p className="text-sm text-chalk">
                    {liveSummary || "正在理解需求…"}
                    <span className="blink ml-1 text-accent-soft">▍</span>
                  </p>
                  {thinking && (
                    <p className="mt-2 line-clamp-2 font-mono text-[11px] leading-5 text-mist/70">
                      {thinking}
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose/40 bg-rose/10 px-3.5 py-2.5 text-xs leading-5 text-rose">
                {error}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-line p-3">
            <div className="rounded-xl border border-line bg-white/[0.03] p-2 focus-within:border-accent/50">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={running}
                rows={2}
                placeholder={running ? "生成中，稍后再继续提要求…" : "继续提要求，例如：加上按标签筛选，并把已完成项置灰"}
                className="w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none placeholder:text-mist/50 disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-mist/60">每一次修改都会存成一个新版本</span>
                {running ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-mist transition hover:border-rose/50 hover:text-rose"
                  >
                    停止
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!draft.trim()}
                    className="rounded-lg bg-gradient-to-r from-accent to-violet px-3.5 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section
          className={`min-h-0 flex-1 flex-col lg:flex ${mobileView === "preview" ? "flex" : "hidden"}`}
        >
          <PreviewPane
            html={displayHtml}
            running={running}
            title={active?.version === latest ? title : `${title}-v${active?.version ?? 0}`}
          />
        </section>
      </div>
    </div>
  );
}

function StatusPill({ running, error, latest }: { running: boolean; error: string | null; latest: number }) {
  if (running) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] text-accent-soft sm:inline-flex">
        <span className="size-1.5 animate-pulse rounded-full bg-accent-soft" />
        智能体工作中
      </span>
    );
  }
  if (error) {
    return (
      <span className="hidden rounded-full border border-rose/40 bg-rose/10 px-2.5 py-1 text-[11px] text-rose sm:inline">
        生成失败
      </span>
    );
  }
  return (
    <span className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-mist sm:inline">
      v{latest} · 已就绪
    </span>
  );
}

function VersionStrip({
  versions,
  activeNumber,
  latest,
  running,
  onSelect,
  onRollback,
}: {
  versions: VersionItem[];
  activeNumber: number;
  latest: number;
  running: boolean;
  onSelect: (version: number) => void;
  onRollback: (version: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line px-4 py-2">
      <span className="shrink-0 pr-1 font-mono text-[11px] text-mist/60">版本</span>

      {versions.length === 0 && (
        <span className="text-[11px] text-mist/60">还没有版本，第一版马上就来</span>
      )}

      {versions.map((version) => {
        const isActive = version.version === activeNumber;
        return (
          <div
            key={version.version}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
              isActive ? "border-accent/60 bg-accent/10" : "border-line hover:border-accent/30"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(version.version)}
              title={version.instruction}
              className="flex max-w-[190px] items-center gap-2 text-left"
            >
              <span className="font-mono text-[11px] text-accent-soft">v{version.version}</span>
              <span className="truncate text-[11px] text-mist">{version.summary}</span>
            </button>

            {version.version === latest && (
              <span className="rounded bg-mint/15 px-1.5 py-0.5 text-[10px] text-mint">当前</span>
            )}

            {version.version !== latest && (
              <button
                type="button"
                disabled={running}
                onClick={() => onRollback(version.version)}
                title={`回滚到 v${version.version}`}
                className="rounded px-1 text-[11px] text-mist transition hover:text-amber disabled:opacity-40"
              >
                ↺
              </button>
            )}
          </div>
        );
      })}

      {running && (
        <span className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 font-mono text-[11px] text-accent-soft">
          v{latest + 1} 生成中…
        </span>
      )}
    </div>
  );
}
