"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "一个待办清单，可以添加、完成、按状态筛选，数据保存在本地",
  "个人记账本，记录每天收支，并用条形图展示本月分类占比",
  "番茄钟专注计时器，包含任务列表和今日专注统计",
  "团队看板，卡片可在「待办 / 进行中 / 已完成」之间拖动",
];

export default function PromptComposer() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
  }, [value]);

  async function submit(idea: string) {
    const prompt = idea.trim();
    if (prompt.length < 4) {
      setError("再多写几个字吧，比如「可以添加和完成任务的待办清单」");
      areaRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "创建失败，请重试");
      router.push(`/build/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败，请重试");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-3xl">
      <div className={`ring-gradient rounded-3xl p-1.5 transition ${busy ? "opacity-70" : ""}`}>
        <div className="panel rounded-[20px] p-5">
          <textarea
            ref={areaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy) void submit(value);
              }
            }}
            rows={2}
            disabled={busy}
            placeholder="描述你想要的应用，例如：一个可以记单词并每天复习的闪卡应用…"
            className="w-full resize-none bg-transparent text-[15px] leading-7 text-chalk outline-none placeholder:text-mist/60 disabled:cursor-not-allowed"
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="hidden text-xs text-mist sm:block">
              <kbd className="rounded border border-line bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>{" "}
              生成 ·{" "}
              <kbd className="rounded border border-line bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                Shift + Enter
              </kbd>{" "}
              换行
            </p>

            <button
              type="button"
              onClick={() => void submit(value)}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-violet px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_30px_-8px_rgba(99,102,241,0.9)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  正在创建…
                </>
              ) : (
                <>
                  生成应用
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-rose">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-xs text-mist/70">试试：</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => {
              setValue(example);
              areaRef.current?.focus();
            }}
            className="rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-xs text-mist transition hover:border-accent/50 hover:bg-accent/10 hover:text-chalk disabled:opacity-50"
          >
            {example.length > 22 ? `${example.slice(0, 22)}…` : example}
          </button>
        ))}
      </div>
    </div>
  );
}
