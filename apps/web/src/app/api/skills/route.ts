import { z } from "zod";
import { addSkill, listSkills } from "@/lib/server/store";

export const runtime = "nodejs";

const CreateSkill = z.object({
  name: z.string().min(1).max(80),
  body: z.string().min(1).max(8000),
});

export async function GET() {
  return Response.json({ skills: listSkills() });
}

export async function POST(request: Request) {
  const body = CreateSkill.parse(await request.json());
  const skill = await addSkill(body.name, body.body);
  return Response.json({ skill });
}
