import { notFound } from "next/navigation";
import Workspace from "@/components/Workspace";
import { getApp } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function BuildPage({ params }: PageProps<"/build/[id]">) {
  const { id } = await params;
  const bundle = await getApp(id);
  if (!bundle) notFound();

  return (
    <Workspace
      appId={bundle.app.id}
      initialTitle={bundle.app.title}
      initialPrompt={bundle.app.prompt}
      initialVersions={bundle.versions.map((version) => ({
        version: version.version,
        instruction: version.instruction,
        summary: version.summary,
        html: version.html,
        durationMs: version.durationMs,
      }))}
      initialMessages={bundle.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        version: message.version,
      }))}
    />
  );
}
