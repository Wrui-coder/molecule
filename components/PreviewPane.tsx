"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewDocument, PREVIEW_SANDBOX } from "@/lib/preview";

type Device = "desktop" | "tablet" | "phone";

const DEVICES: Array<{ id: Device; label: string; width: string }> = [
  { id: "desktop", label: "桌面", width: "100%" },
  { id: "tablet", label: "平板", width: "834px" },
  { id: "phone", label: "手机", width: "390px" },
];

export default function PreviewPane({
  html,
  running,
  title,
}: {
  html: string;
  running: boolean;
  title: string;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // NB: not named `document` — that would shadow the global inside this component.
  const previewDoc = useMemo(() => buildPreviewDocument(html), [html]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only trust frames we own — the page may host several previews.
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.__molecule !== true) return;

      if (data.type === "error") {
        setRuntimeError(String(data.message ?? "运行时错误"));
      } else if (data.type === "console") {
        setRuntimeError(String(data.message ?? "控制台错误"));
      } else if (data.type === "nav") {
        setNotice(`已拦截跳转：${data.href}`);
        setTimeout(() => setNotice(null), 2600);
      } else if (data.type === "ready") {
        // A fresh document starts clean.
        setRuntimeError(null);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function exportHtml() {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title || "app"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const width = DEVICES.find((item) => item.id === device)?.width ?? "100%";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5 pl-1">
          <span className="size-2.5 rounded-full bg-rose/60" />
          <span className="size-2.5 rounded-full bg-amber/60" />
          <span className="size-2.5 rounded-full bg-mint/60" />
        </div>

        <div className="ml-2 hidden truncate rounded-md border border-line bg-black/20 px-3 py-1 text-[11px] text-mist sm:block">
          localhost / {title || "untitled"}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-line p-0.5">
            {DEVICES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDevice(item.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                  device === item.id ? "bg-white/10 text-chalk" : "text-mist hover:text-chalk"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportHtml}
            disabled={running || !html}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-mist transition hover:border-accent/50 hover:text-chalk disabled:opacity-40"
          >
            导出 HTML
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-black/25">
        <div className="flex h-full justify-center overflow-hidden">
          <iframe
            ref={frameRef}
            title="应用预览"
            srcDoc={previewDoc}
            sandbox={PREVIEW_SANDBOX}
            className="h-full border-0 bg-white transition-[width] duration-300"
            style={{ width }}
          />
        </div>

        {running && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="shimmer h-full w-full" />
          </div>
        )}

        {notice && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-amber/40 bg-amber/15 px-3 py-1.5 text-[11px] text-amber backdrop-blur">
            {notice}
          </div>
        )}

        {runtimeError && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-rose/40 bg-[#2a0f18]/95 p-3 backdrop-blur">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-rose">▲</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-rose">页面运行时报错</p>
                <p className="mt-1 line-clamp-3 font-mono text-[11px] leading-5 break-all text-rose/80">
                  {runtimeError}
                </p>
                <p className="mt-2 text-[11px] text-mist">
                  在左侧对话框里描述这个问题，让智能体修掉它。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRuntimeError(null)}
                className="rounded px-1.5 text-xs text-mist hover:text-chalk"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {!html && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="text-xs text-mist">等待第一版代码…</p>
          </div>
        )}
      </div>
    </div>
  );
}
