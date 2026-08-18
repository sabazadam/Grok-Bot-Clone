import { Workspace } from "@/components/workspace";
import { getWorkstation, messagesFor, snapshot } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default function Home() {
  const initial = snapshot();
  const threadId = initial.threads[0]?.id || null;
  const messages = threadId ? messagesFor(threadId) : [];
  const botId = initial.threads[0]?.botIds[0];
  const workstation = botId ? getWorkstation(botId) || null : null;
  return (
    <Workspace
      initial={initial}
      initialThreadId={threadId}
      initialMessages={messages}
      initialWorkstation={workstation}
    />
  );
}
