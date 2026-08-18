/** REST + WebSocket API. */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { z } from "zod";
import fastifyStatic from "@fastify/static";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, type Provider } from "@grokbot/shared";
import { config } from "./config.js";
import * as store from "./store.js";
import * as service from "./agents/service.js";
import { computerManager } from "./computer/manager.js";
import { addClient, broadcast } from "./bus.js";
import { dispatchUserMessage } from "./runtime/orchestrator.js";
import { resolvePendingApproval } from "./runtime/approvals.js";
import { cancelTask } from "./runtime/cancel.js";

const providerEnum = z.enum(["anthropic", "openai", "google", "generic"]);

const agentBody = z.object({
  name: z.string().min(1).max(40),
  roleTitle: z.string().max(80).default(""),
  instructions: z.string().max(8000).default(""),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  provider: providerEnum,
  model: z.string().min(1).max(120),
  collaborationEnabled: z.boolean().default(true),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, "screenshots"),
    prefix: "/screenshots/",
  });

  app.get("/ws", { websocket: true }, (socket) => {
    addClient(socket);
  });

  // ── config / providers ────────────────────────────────────────────────
  app.get("/api/config", async () => {
    const keyPresent: Record<Provider, boolean> = {
      anthropic: !!config.anthropicApiKey,
      openai: !!config.openaiApiKey,
      google: !!config.googleApiKey,
      generic: !!config.xaiApiKey,
    };
    return {
      providers: (Object.keys(PROVIDER_LABELS) as Provider[]).map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        hasKey: keyPresent[id],
        defaultModel: PROVIDER_DEFAULT_MODELS[id],
      })),
      dockerAvailable: await computerManager.dockerAvailable(),
      imageAvailable: await computerManager.imageAvailable(),
      maxRunningComputers: config.maxRunningComputers,
    };
  });

  // ── agents ────────────────────────────────────────────────────────────
  app.get("/api/agents", async () => {
    return Promise.all(store.listAgents().map((a) => service.agentWithComputer(a)));
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = agentBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (store.getAgentByName(parsed.data.name)) {
      return reply.code(409).send({ error: `An agent named "${parsed.data.name}" already exists` });
    }
    const agent = await service.createAgent(parsed.data);
    return service.agentWithComputer(agent);
  });

  app.get("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = store.getAgent(id);
    if (!agent) return reply.code(404).send({ error: "not found" });
    return service.agentWithComputer(agent);
  });

  app.patch("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = agentBody.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const agent = store.updateAgent(id, parsed.data);
    if (!agent) return reply.code(404).send({ error: "not found" });
    // keep direct conversation title in sync with the agent name
    const direct = store.directConversationForAgent(id);
    if (direct && parsed.data.name && direct.title !== parsed.data.name) {
      store.renameConversation(direct.id, parsed.data.name);
      const conv = store.getConversation(direct.id);
      if (conv) broadcast({ type: "conversation_updated", conversation: conv });
    }
    const full = await service.agentWithComputer(agent);
    broadcast({ type: "agent_updated", agent: full });
    return full;
  });

  app.delete("/api/agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { deleteData } = req.query as { deleteData?: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    await service.deleteAgent(id, deleteData === "1");
    return { ok: true };
  });

  // ── agent computer lifecycle ──────────────────────────────────────────
  app.get("/api/agents/:id/computer", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    return computerManager.status(id);
  });

  app.post("/api/agents/:id/computer/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    await service.provisionComputer(id);
    return computerManager.status(id);
  });

  app.post("/api/agents/:id/computer/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    await service.stopComputer(id);
    return computerManager.status(id);
  });

  app.post("/api/agents/:id/computer/restart", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    await computerManager.restart(id);
    await service.provisionComputer(id);
    return computerManager.status(id);
  });

  // ── memories ──────────────────────────────────────────────────────────
  app.get("/api/agents/:id/memories", async (req) => {
    const { id } = req.params as { id: string };
    return store.listMemories(id, 100);
  });

  app.delete("/api/memories/:id", async (req) => {
    const { id } = req.params as { id: string };
    store.deleteMemory(id);
    return { ok: true };
  });

  // ── conversations & messages ──────────────────────────────────────────
  app.get("/api/conversations", async () => store.listConversations());

  app.post("/api/conversations", async (req, reply) => {
    const body = z
      .object({ title: z.string().min(1).max(80), agentIds: z.array(z.string()).min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    for (const id of body.data.agentIds) {
      if (!store.getAgent(id)) return reply.code(400).send({ error: `unknown agent ${id}` });
    }
    const conv = store.createConversation("group", body.data.title, body.data.agentIds);
    broadcast({ type: "conversation_updated", conversation: conv });
    return conv;
  });

  app.delete("/api/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    if (conv.kind === "direct") return reply.code(400).send({ error: "direct conversations are removed with their agent" });
    store.deleteConversation(id);
    return { ok: true };
  });

  app.get("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getConversation(id)) return reply.code(404).send({ error: "not found" });
    return store.listMessages(id);
  });

  app.post("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    if (conv.kind === "agent_dm") return reply.code(400).send({ error: "agent-to-agent DMs are read-only for the user" });
    const body = z.object({ text: z.string().min(1).max(20000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });

    const message = store.addMessage({
      conversationId: conv.id,
      sender: { kind: "user" },
      kind: "text",
      text: body.data.text,
    });
    broadcast({ type: "message", message });
    dispatchUserMessage(conv, message);
    return message;
  });

  // ── approvals & task control ──────────────────────────────────────────
  app.post("/api/approvals/:id/:decision", async (req, reply) => {
    const { id, decision } = req.params as { id: string; decision: string };
    if (decision !== "approve" && decision !== "reject") {
      return reply.code(400).send({ error: "decision must be approve|reject" });
    }
    const approval = resolvePendingApproval(id, decision === "approve" ? "approved" : "rejected");
    if (!approval) return reply.code(404).send({ error: "approval not found or already resolved" });
    return approval;
  });

  app.post("/api/tasks/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = cancelTask(id);
    if (!ok) return reply.code(404).send({ error: "task not running" });
    return { ok: true };
  });
}
