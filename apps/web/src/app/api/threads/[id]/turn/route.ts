import { addMessage, getThread, updateState } from "@/lib/server/store";
import { pickResponders, runTurn, type TurnEvent } from "@/lib/server/agent";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json()) as { content?: string };
  const content = (body.content || "").trim();
  if (!content) return Response.json({ error: "Empty message" }, { status: 400 });

  await addMessage({ threadId: id, role: "user", content });
  await updateState((state) => {
    const item = state.threads.find((threadItem) => threadItem.id === id);
    if (item) item.unread = false;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: TurnEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`),
        );
      };
      try {
        for (const bot of pickResponders(thread, content)) {
          await runTurn({ threadId: id, botId: bot.id, userText: content, emit });
        }
      } catch (error) {
        emit({
          type: "error",
          payload: error instanceof Error ? error.message : "Turn failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
