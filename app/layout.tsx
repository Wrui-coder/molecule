import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Molecule — 一句话生成可用的网页应用",
  description:
    "用自然语言描述你的想法，AI 智能体即时生成一个完整、可直接运行的网页应用，并支持对话式迭代与版本回滚。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      {/* System font stack on purpose: no network dependency at build time, and
          it renders Chinese far better than any bundled latin-only webfont. */}
      <body className="aurora relative flex min-h-full flex-col">{children}</body>
    </html>
  );
}
