import { z } from "zod";
import { createGroup, listThreads, messagesFor } from "@/lib/server/store";

export const runtime = "nodejs";

const CreateGroup = z.object({
  botIds: z.array(z.string()).min(2).max(6),
  title: z.string().max(80).optional(),
});

export async function GET() {
  const threads = listThreads().map((thread) => ({
    ...thread,
    lastMessage: messagesFor(thread.id).at(-1) || null,
  }));
  return Response.json({ threads });
}

export async function POST(request: Request) {
  const body = CreateGroup.parse(await request.json());
  const thread = await createGroup(body.botIds, body.title);
  return Response.json({ thread });
}
