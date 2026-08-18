import { snapshot } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(snapshot());
}
