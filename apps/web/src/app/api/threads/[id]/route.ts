import { getThread, messagesFor, updateState } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = getThread(id);
  if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ thread, messages: messagesFor(id) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { allowCollaboration?: boolean; unread?: boolean };
  await updateState((state) => {
    const thread = state.threads.find((item) => item.id === id);
    if (!thread) return;
    if (typeof body.allowCollaboration === "boolean") {
      thread.allowCollaboration = body.allowCollaboration;
    }
    if (typeof body.unread === "boolean") thread.unread = body.unread;
  });
  const thread = getThread(id);
  return Response.json({ thread });
}
