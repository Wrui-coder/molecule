# Molecule — 一句话生成可用的网页应用

> 本仓库是「研发笔试」的作答源码与说明文档。
>
> 参考案例：[atoms-demo.pub.atoms.world](https://atoms-demo.pub.atoms.world/) —— 用自然语言描述一个应用，AI Agent 自动生成可运行的网页，并支持实时预览、对话式迭代、版本管理与导出。

**线上可体验地址：** `https://molecule-orpin.vercel.app`

---

## 1. 这是什么

Molecule 是一个 **Agent 驱动的「应用生成器」Demo**：

用户输入一句话描述（例如 *"做一个记账小工具，记录每天的收入支出，支持编辑删除、按分类和月份统计并画出柱状图"*），系统通过大模型 **实时流式生成** 一个完整的、可独立运行的单文件 HTML 网页应用，并在页面右侧的 **沙箱预览窗格** 中即时呈现。

生成完成后，用户可以：

- **继续对话迭代** —— 例如"备注改为必填，明细列表新增按分类筛选下拉框"，Agent 基于上下文修改并生成 v2；
- **版本回滚** —— 版本历史以追加式保存，一键回滚到任意历史版本；
- **导出** —— 把当前版本导出为独立的 `.html` 文件，可脱离本系统直接双击运行（数据保存在浏览器 localStorage）。

## 2. 笔试要求对照

| 笔试要求 | 实现情况 |
| --- | --- |
| 真实交互，不是静态 PoC | ✅ 输入描述 → 流式生成 → 预览可操作（点击、输入、增删数据）→ 对话迭代 → 版本回滚 → 导出下载 |
| 数据持久化（任意技术栈） | ✅ 版本历史 / 对话记录持久化到 PostgreSQL：生产环境 Neon，本地开发用 WASM 版 Postgres（PGlite），同一套 Drizzle Schema 双驱动 |
| 有基本使用流程 | ✅ 首页新建 → 生成页预览与迭代 → 版本管理 → 导出 |
| 至少一个延展能力 | ✅ **对话式迭代**：多轮对话上下文回放（最近 6 轮「指令+摘要」，不含历史代码），基于摘要让模型增量修改 |
| 可公开访问的测试链接 | ✅ Vercel + Neon 部署 |
| 公开 GitHub 源码链接 | ✅ 本仓库 |
| 说明文档 | ✅ 本文档（第 3、4 节） |

## 3. 架构

```
浏览器 (React 19 + Tailwind v4)
   │  ① 一句话描述
   ▼
Next.js App Router ── POST /api/apps/{id}/generate
   │  ② 流式调用大模型 (Anthropic-compatible Messages API)
   │     解析 tagged 输出协议 <name>/<summary>/<file> → 增量解析器
   │  ③ NDJSON 流式返回 (server 350ms / client 800ms 节流)
   ▼
   │  ④ 生成完成后 appendVersion()：追加保存 v2, v3…
   ▼
PostgreSQL (Neon) ─ Drizzle ORM
   ├─ apps      (应用元数据 + currentVersion)
   ├─ versions  (追加式版本历史: html / instruction / summary)
   └─ messages  (对话记录)
```

### 3.1 代码结构

```
app/
  page.tsx                    首页：输入一句话，创建应用
  build/[id]/page.tsx         生成工作台：预览 + 对话 + 版本时间轴
  api/apps/                   REST：创建、详情、generate(流式)、rollback
components/
  Workspace.tsx              工作台主逻辑（NDJSON 读取、StrictMode 安全的自动启动）
  PreviewPane.tsx            沙箱预览 + 导出下载
  PromptComposer.tsx          对话输入
lib/
  ai/client.ts                大模型客户端（Anthropic 兼容协议，可换任意中转/官方端点）
  ai/prompt.ts                系统提示词：输出协议、迭代约束、Token 预算
  ai/run.ts                   单次生成编排：历史回放、事件流(name/summary/preview/thinking/done)
  ai/parser.ts                增量解析 <file> 等 tagged 输出 + 多模型容错回退
  preview.ts                  沙箱文档构建、localStorage shim、崩溃上报协议
  db/                         Drizzle Schema + 双驱动（Neon HTTP / PGlite WASM）+ DDL
  repo.ts                     版本/对话读写
```

## 4. 关键工程决策

### 4.1 数据持久化：一套 Schema，双驱动
- 生产：`@neondatabase/serverless`（neon-http）连 Neon 托管 PostgreSQL；
- 本地开发：`@electric-sql/pglite`（浏览器 WASM Postgres，落盘到临时目录），零依赖、秒级启动；
- 同一份 Drizzle Schema，`lib/db/index.ts` 按 `DATABASE_URL` 是否存在自动切换驱动。

### 4.2 预览安全与「诚实」的存储取舍
预览 iframe 采用 `sandbox="allow-scripts allow-forms allow-modals allow-popups"`，**刻意不含 `allow-same-origin`**，生成的代码运行在隔离的 opaque origin 中，无法触达宿主页面。

代价：iframe 内没有真实 localStorage（沙箱 opaque origin 会抛 SecurityError）。因此注入了一个**内存版 localStorage shim** —— 演示中数据可增删、刷新可保留，但刷新页面后临时数据会清空。这是安全性优先的**明确取舍**：生成代码是外部 LLM 产物，不授予它持久化权限是正确姿势；用户如需真实持久化，点「导出」拿到独立文件后双击运行，即可获得浏览器原生 localStorage。

### 4.3 版本历史是「追加式」的，回滚 = 向前追加
- 每次生成都追加一条新版本记录，`currentVersion` 前进，永不覆写历史；
- 「回滚到 vN」并不是把指针拨回去，而是追加一条 `instruction: 回滚到 vN` 的新版本（其代码内容复现 vN）—— 回滚动作本身也被完整记录在案；
- 对话上下文回放的是「最近 6 轮指令+摘要」，**从不把历史 HTML 喂给模型**，保证迭代输入简短、成本可控。

### 4.4 流式输出与多模型容错
- 生成端以 NDJSON 流式下发，用户能实时看到「命名 → 摘要 → 代码」逐步成型；
- 模型输出使用 tagged 协议（`<name>` / `<summary>` / `<file>`），解析器支持**增量解析 + 三种回退策略**（tag、``` html 围栏、裸 doctype），以兼容不同模型对协议的遵循程度；
- 推理预算（thinking budget）计入 `max_tokens` 上限，避免某些模型「想太久、写不出来」。

### 4.5 部署
- Vercel（Hobby 即支持 300s 函数时长，本 Demo 最长一次生成约 2.3 分钟，安全余量充足）；
- Neon Postgres 存数据；环境变量见下。

## 5. 本地运行

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

本地默认使用 PGlite（无需安装数据库）。需要连接远程 Postgres 时设置：

```bash
DATABASE_URL=postgres://...        # 启用 Neon 驱动，并执行 scripts/db-push（见下）
ANTHROPIC_BASE_URL=https://...     # Anthropic 兼容端点（官方或中转）
ANTHROPIC_AUTH_TOKEN=sk-...        # 鉴权令牌（或 ANTHROPIC_API_KEY）
ANTHROPIC_MODEL=deepseek-v4-flash  # 模型名
LLM_MAX_TOKENS=64000               # 整个回复（含推理）的 token 上限，代码默认 32000
LLM_THINKING_BUDGET=2000           # 推理 token 上限，设 0 则不限制
```

以上变量可参考仓库根目录的 `.env.example`（复制为 `.env.local` 后填写）。

应用 DDL（建表）见 `lib/db/ddl.ts`，可执行：

```bash
npx tsx scripts/db-push.ts   # 把 DDL 应用到 DATABASE_URL 指向的数据库
```

## 6. 环境变量一览

| 变量 | 说明 | 必填 |
| --- | --- | --- |
| `DATABASE_URL` | Postgres 连接串；不设置则走本地 PGlite | 生产必填 |
| `ANTHROPIC_BASE_URL` | Anthropic 兼容 API 端点 | 生产必填 |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | 鉴权令牌（兼容两种命名） | 生产必填 |
| `ANTHROPIC_MODEL` | 模型名 | 否（有默认） |
| `LLM_MAX_TOKENS` | 总 token 预算 | 否 |
| `LLM_THINKING_BUDGET` | 思考 token 预算 | 否 |

---

*Generated with [Claude Code](https://claude.com/claude-code)*
