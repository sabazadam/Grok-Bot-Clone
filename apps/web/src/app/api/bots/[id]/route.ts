import { z } from "zod";
import { PROVIDERS } from "@/lib/types";
import { getBot, updateState } from "@/lib/server/store";

export const runtime = "nodejs";

const PatchBot = z.object({
  name: z.string().min(1).max(40).optional(),
  title: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(2000).optional(),
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().max(80).optional(),
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  allowCollaboration: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bot = getBot(id);
  if (!bot) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ bot });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const patch = PatchBot.parse(await request.json());
  await updateState((state) => {
    const bot = state.bots.find((item) => item.id === id);
    if (!bot) return;
    Object.assign(bot, patch, { updatedAt: new Date().toISOString() });
    if (patch.name) {
      for (const thread of state.threads) {
        if (thread.kind === "dm" && thread.botIds[0] === id) thread.title = patch.name;
      }
    }
  });
  const bot = getBot(id);
  if (!bot) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ bot });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await updateState((state) => {
    const bot = state.bots.find((item) => item.id === id);
    if (bot) bot.hidden = true;
  });
  return Response.json({ ok: true });
}
