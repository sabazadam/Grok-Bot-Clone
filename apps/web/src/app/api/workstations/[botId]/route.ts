import { getBot, getWorkstation } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const workstation = getWorkstation(botId);
  const bot = getBot(botId);
  if (!workstation || !bot) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ workstation, botName: bot.name });
}
