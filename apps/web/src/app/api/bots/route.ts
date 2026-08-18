import { z } from "zod";
import { PROVIDERS } from "@/lib/types";
import { makeBot, listBots, upsertBot } from "@/lib/server/store";

export const runtime = "nodejs";

const CreateBot = z.object({
  name: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  provider: z.enum(PROVIDERS).optional(),
  model: z.string().max(80).optional(),
  color: z.string().max(20).optional(),
});

export async function GET() {
  return Response.json({ bots: listBots(true) });
}

export async function POST(request: Request) {
  const body = CreateBot.parse(await request.json());
  const bot = await upsertBot(makeBot(body));
  return Response.json({ bot });
}
