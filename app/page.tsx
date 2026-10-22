import Link from "next/link";
import PromptComposer from "@/components/PromptComposer";
import { getStats, listApps } from "@/lib/repo";
import { buildPreviewDocument, PREVIEW_SANDBOX } from "@/lib/preview";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    step: "01",
    title: "描述想法",
    body: "用一句自然语言说清你要什么。不需要写需求文档，也不用画原型。",
  },
  {
    step: "02",
    title: "智能体生成",
    body: "模型边思考边写出完整的单文件应用，预览区同步渲染——你能看到它一点点长出来。",
  },
  {
    step: "03",
    title: "对话式迭代",
    body: "继续提要求即可增量修改，每一版都自动归档，随时可回滚到任意历史版本。",
  },
];

export default async function Home() {
  const [recent, stats] = await Promise.all([listApps(6), getStats()]);
  const withPreview = recent.filter((app) => app.previewHtml);

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-violet text-sm font-bold text-white">
            M
          </span>
          <span className="text-sm font-semibold tracking-wide">Molecule</span>
        </div>
        <span className="rounded-full border border-line bg-white/[0.03] px-3 py-1 text-[11px] text-mist">
          Agent 驱动的应用生成器
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        <section className="flex flex-col items-center pt-10 text-center sm:pt-16">
          <p className="animate-rise mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-4 py-1.5 text-xs text-mist">
            <span className="size-1.5 rounded-full bg-mint" />
            输入一句话，直接得到一个能用的网页应用
          </p>

          <h1 className="animate-rise max-w-3xl text-4xl leading-[1.15] font-semibold tracking-tight sm:text-6xl">
            把想法<span className="gradient-text">直接变成</span>
            <br />
            可运行的应用
          </h1>

          <p className="animate-rise mt-6 max-w-xl text-sm leading-7 text-mist sm:text-base">
            Molecule 用智能体驱动的方式完成代码生成：你负责描述，它负责写出一个完整、可交互、数据可持久化的网页应用。
          </p>

          <div className="mt-10 flex w-full justify-center">
            <PromptComposer />
          </div>
        </section>

        <section className="mt-24 grid gap-4 sm:grid-cols-3">
          {STEPS.map((item) => (
            <div key={item.step} className="panel rounded-2xl p-5">
              <span className="font-mono text-xs text-accent-soft">{item.step}</span>
              <h2 className="mt-3 text-base font-medium">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-mist">{item.body}</p>
            </div>
          ))}
        </section>

        {/* Real numbers read from the database, not decoration. */}
        <section className="panel mt-6 grid grid-cols-3 divide-x divide-line rounded-2xl">
          <Stat label="已生成应用" value={stats.apps ? String(stats.apps) : "—"} />
          <Stat label="已归档版本" value={stats.versions ? String(stats.versions) : "—"} />
          <Stat
            label="平均出首版"
            value={stats.avgSeconds ? `${stats.avgSeconds}s` : "—"}
            hint={stats.versions ? "基于真实生成记录" : "等待第一个应用"}
          />
        </section>

        <section className="mt-20">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-medium">最近生成</h2>
              <p className="mt-1 text-sm text-mist">点开任意一个，可以继续对话式迭代。</p>
            </div>
          </div>

          {recent.length === 0 ? (
            <div className="panel rounded-2xl px-6 py-14 text-center">
              <p className="text-sm text-mist">还没有作品。在上面的输入框里描述一个应用，它就是第一个。</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((app) => (
                <Link
                  key={app.id}
                  href={`/build/${app.id}`}
                  className="panel group overflow-hidden rounded-2xl transition hover:border-accent/50"
                >
                  <div className="relative h-40 overflow-hidden border-b border-line bg-abyss">
                    {app.previewHtml ? (
                      <>
                        {/* A real, live render of the generated app — same sandbox
                            as the workspace, just clipped to a card and with the
                            pointer disabled so clicks reach the card link. */}
                        <iframe
                          title={`${app.title} 预览`}
                          srcDoc={buildPreviewDocument(app.previewHtml)}
                          sandbox={PREVIEW_SANDBOX}
                          loading="lazy"
                          tabIndex={-1}
                          className="pointer-events-none h-[600px] w-full border-0"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-abyss to-transparent" />
                      </>
                    ) : (
                      <div className="grid h-full place-items-center text-xs text-mist/60">
                        {withPreview.length === 0 ? "生成中…" : "暂无预览"}
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-sm font-medium">{app.title}</h3>
                      <span className="shrink-0 font-mono text-[11px] text-mist">v{app.currentVersion}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-mist">
                      {app.summary || app.prompt}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-line/70 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 text-xs text-mist/70 sm:flex-row sm:items-center sm:justify-between">
          <span>Molecule · 智能体驱动的单文件应用生成器</span>
          <span>生成的代码运行在无 allow-same-origin 的沙箱中</span>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-5 py-6 text-center">
      <div className="font-mono text-2xl font-semibold text-chalk sm:text-3xl">{value}</div>
      <div className="mt-1.5 text-xs text-mist">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-mist/50">{hint}</div>}
    </div>
  );
}
