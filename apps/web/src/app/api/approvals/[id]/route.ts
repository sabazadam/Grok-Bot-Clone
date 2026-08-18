import { addMessage, resolveApproval } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { status?: "approved" | "denied" };
  if (body.status !== "approved" && body.status !== "denied") {
    return Response.json({ error: "status must be approved or denied" }, { status: 400 });
  }
  const approval = await resolveApproval(id, body.status);
  if (!approval) return Response.json({ error: "Not found" }, { status: 404 });
  const message = await addMessage({
    threadId: approval.threadId,
    role: "system",
    botId: approval.botId,
    content:
      body.status === "approved"
        ? `Approved: ${approval.summary}`
        : `Denied: ${approval.summary}`,
    meta: { approvalId: approval.id, status: body.status },
  });
  return Response.json({ approval, message });
}
