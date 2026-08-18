import {
  clickDesktop,
  moveMouse,
  openApp,
  setTakeover,
  typeText,
} from "@/lib/server/workstation";
import { getWorkstation, saveWorkstation } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const state = getWorkstation(botId);
  if (!state) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json()) as {
    type?: string;
    x?: number;
    y?: number;
    text?: string;
    app?: "files" | "browser" | "terminal";
    takeover?: boolean;
  };
  if (body.type === "takeover" && typeof body.takeover === "boolean") {
    setTakeover(state, body.takeover);
  } else if (body.type === "move" && typeof body.x === "number" && typeof body.y === "number") {
    if (!state.takeover) return Response.json({ error: "Takeover is off" }, { status: 403 });
    moveMouse(state, body.x, body.y);
  } else if (body.type === "click") {
    if (!state.takeover) return Response.json({ error: "Takeover is off" }, { status: 403 });
    clickDesktop(state);
  } else if (body.type === "type" && body.text) {
    if (!state.takeover) return Response.json({ error: "Takeover is off" }, { status: 403 });
    typeText(state, body.text);
  } else if (body.type === "open" && body.app) {
    openApp(state, body.app);
  } else {
    return Response.json({ error: "Unknown input" }, { status: 400 });
  }
  await saveWorkstation(state);
  return Response.json({ workstation: state });
}
