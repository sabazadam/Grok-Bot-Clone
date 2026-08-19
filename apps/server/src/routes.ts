/** REST + WebSocket API. */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import fastifyStatic from "@fastify/static";
import { FACE_SHAPES, PROVIDER_LABELS, type Provider } from "@grokbot/shared";
import { config, defaultModelFor } from "./config.js";
import * as store from "./store.js";
import * as service from "./agents/service.js";
import { computerManager } from "./computer/manager.js";
import { addClient, broadcast } from "./bus.js";
import { dispatchUserMessage, stopConversation } from "./runtime/orchestrator.js";
import { runRoutineNow } from "./runtime/scheduler.js";
import { resolvePendingApproval } from "./runtime/approvals.js";
import { cancelTask } from "./runtime/cancel.js";
import { setTakeover } from "./runtime/takeover.js";
import { MAX_ATTACH_FILES, saveAttachments, uploadsDir } from "./uploads.js";
import { startTeach, stopTeach, getTeachSession } from "./runtime/teach.js";
import { forgetPlugin } from "./plugins/runtime.js";
import { isAllowedBrowserOrigin } from "./origin.js";

const providerEnum = z.enum(["anthropic", "openai", "google", "generic"]);

const agentBody = z.object({
  name: z.string().min(1).max(40),
  roleTitle: z.string().max(80).default(""),
  instructions: z.string().max(8000).default(""),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  avatarShape: z.enum(FACE_SHAPES).optional(),
  provider: providerEnum,
  model: z.string().min(1).max(120),
  collaborationEnabled: z.boolean().default(true),
  stealthBrowsing: z.boolean().default(true),
  isTeamLead: z.boolean().default(false),
  team: z.string().max(40).default(""),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  fs.mkdirSync(path.join(config.dataDir, "screenshots"), { recursive: true });
  fs.mkdirSync(uploadsDir(), { recursive: true });
  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, "screenshots"),
    prefix: "/screenshots/",
  });
  await app.register(fastifyStatic, {
    root: uploadsDir(),
    prefix: "/uploads/",
    decorateReply: false,
  });

  // Serve the built web UI (single-port mode, used by the desktop app and plain browser
  // access). Registered only when a production build exists; dev uses the Vite server.
  const hasBuiltUi = fs.existsSync(path.join(config.webDist, "index.html"));
  if (hasBuiltUi) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/",
      decorateReply: false, // a fastify-static instance is already registered above
    });
    // SPA fallback: non-asset, non-API GET routes return index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws") && !req.url.startsWith("/screenshots") && !req.url.startsWith("/uploads")) {
        // Serve from the web-dist root explicitly: reply.sendFile is decorated by the
        // first static registration (screenshots), so pass the correct root here.
        return reply.type("text/html").sendFile("index.html", config.webDist);
      }
      return reply.code(404).send({ error: "not found" });
    });
  }

  app.get("/ws", { websocket: true }, (socket, req) => {
    // WebSocket does not use CORS. A public page can otherwise subscribe to
    // every chat, approval, and screenshot URL while GrokBot is running.
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!isAllowedBrowserOrigin(origin)) {
      socket.close(1008, "origin not allowed");
      return;
    }
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
        defaultModel: defaultModelFor(id),
      })),
      dockerAvailable: await computerManager.dockerAvailable(),
      imageAvailable: await computerManager.imageAvailable(),
      maxRunningComputers: config.maxRunningComputers,
    };
  });

  // ── agents ────────────────────────────────────────────────────────────
  app.get("/api/agents", async () => {
    service.reconcileStatuses();
    return Promise.all(store.listAgents().map((a) => service.agentWithComputer(a)));
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = agentBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (store.rosterCount() >= store.ROSTER_LIMIT) {
      return reply.code(400).send({ error: "roster limit reached (50 bots + groups)" });
    }
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
    // apply browser/stealth setting changes live (no container recreate needed)
    if (full.computer?.state === "running") {
      void service.syncBrowserConfig(id);
    }
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

  app.post("/api/agents/:id/duplicate", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    if (store.rosterCount() >= store.ROSTER_LIMIT) {
      return reply.code(400).send({ error: "roster limit reached (50 bots + groups)" });
    }
    const copy = await service.duplicateAgent(id);
    return service.agentWithComputer(copy!);
  });

  app.post("/api/agents/:id/hide", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    const body = z.object({ hidden: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const agent = await service.setHidden(id, body.data.hidden);
    return agent;
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

  app.post("/api/agents/:id/takeover", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    const body = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    setTakeover(id, body.data.active);
    return { ok: true, active: body.data.active };
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
      .object({
        title: z.string().min(1).max(80),
        agentIds: z.array(z.string()).min(store.GROUP_MEMBER_MIN).max(store.GROUP_MEMBER_MAX),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    if (store.rosterCount() >= store.ROSTER_LIMIT) {
      return reply.code(400).send({ error: "roster limit reached (50 bots + groups)" });
    }
    const uniqueIds = [...new Set(body.data.agentIds)];
    if (uniqueIds.length < store.GROUP_MEMBER_MIN || uniqueIds.length > store.GROUP_MEMBER_MAX) {
      return reply.code(400).send({ error: "groups need 2–6 bots" });
    }
    for (const id of uniqueIds) {
      if (!store.getAgent(id)) return reply.code(400).send({ error: `unknown agent ${id}` });
    }
    const conv = store.createConversation("group", body.data.title, uniqueIds);
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

  app.get("/api/conversations/:id/approvals", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getConversation(id)) return reply.code(404).send({ error: "not found" });
    return store.listApprovalsByConversation(id);
  });

  app.post("/api/conversations/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    if (conv.kind === "agent_dm") return reply.code(400).send({ error: "agent-to-agent DMs are read-only for the user" });
    const body = z
      .object({
        text: z.string().max(20000).default(""),
        attachments: z
          .array(
            z.object({
              name: z.string().min(1).max(160),
              mime: z.string().max(120).default("application/octet-stream"),
              dataBase64: z.string().min(1),
            }),
          )
          .max(MAX_ATTACH_FILES)
          .optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const attachments = body.data.attachments?.length ? saveAttachments(body.data.attachments) : undefined;
    if (!body.data.text.trim() && !attachments?.length) {
      return reply.code(400).send({ error: "text or attachment required" });
    }

    const message = store.addMessage({
      conversationId: conv.id,
      sender: { kind: "user" },
      kind: "text",
      text: body.data.text.trim() || (attachments?.length ? `Attached ${attachments.map((a) => a.name).join(", ")}` : ""),
      attachments,
    });
    broadcast({ type: "message", message });
    dispatchUserMessage(conv, message);
    return message;
  });

  app.post("/api/conversations/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getConversation(id)) return reply.code(404).send({ error: "not found" });
    stopConversation(id);
    return { ok: true };
  });

  app.patch("/api/conversations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = store.getConversation(id);
    if (!conv) return reply.code(404).send({ error: "not found" });
    const body = z
      .object({ title: z.string().min(1).max(80).optional(), agentIds: z.array(z.string()).min(1).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    if (body.data.title) store.renameConversation(id, body.data.title);
    if (body.data.agentIds) {
      if (conv.kind !== "group") return reply.code(400).send({ error: "only group membership can be edited" });
      for (const agentId of body.data.agentIds) {
        if (!store.getAgent(agentId)) return reply.code(400).send({ error: `unknown agent ${agentId}` });
      }
      store.setConversationAgents(id, body.data.agentIds);
    }
    const updated = store.getConversation(id);
    if (updated) broadcast({ type: "conversation_updated", conversation: updated });
    return updated;
  });

  // ── skills ────────────────────────────────────────────────────────────
  app.get("/api/skills", async () => store.listSkills());

  app.post("/api/skills", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().max(400).default(""),
        instructions: z.string().min(1).max(20000),
        enableForAgentId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    if (store.getSkillByName(body.data.name)) {
      return reply.code(409).send({ error: `A skill named "${body.data.name}" already exists` });
    }
    const skill = store.createSkill({
      name: body.data.name,
      description: body.data.description,
      instructions: body.data.instructions,
      createdByAgentId: body.data.enableForAgentId,
    });
    if (body.data.enableForAgentId) store.setAgentSkill(body.data.enableForAgentId, skill.id, true);
    broadcast({ type: "skill_updated", skill });
    return skill;
  });

  app.patch("/api/skills/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(400).optional(),
        instructions: z.string().min(1).max(20000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const skill = store.updateSkill(id, body.data);
    if (!skill) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "skill_updated", skill });
    return skill;
  });

  app.delete("/api/skills/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getSkill(id)) return reply.code(404).send({ error: "not found" });
    store.deleteSkill(id);
    broadcast({ type: "skill_deleted", skillId: id });
    return { ok: true };
  });

  app.get("/api/agents/:id/skills", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    const all = store.listSkills();
    const enabled = new Set(store.listEnabledSkillsForAgent(id).map((s) => s.id));
    return all.map((s) => ({ ...s, enabled: enabled.has(s.id) }));
  });

  app.post("/api/agents/:id/skills", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    const body = z.object({ skillId: z.string(), enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    if (!store.getSkill(body.data.skillId)) return reply.code(404).send({ error: "skill not found" });
    store.setAgentSkill(id, body.data.skillId, body.data.enabled);
    return { ok: true, skills: store.listEnabledSkillsForAgent(id) };
  });

  // ── routines ──────────────────────────────────────────────────────────
  app.get("/api/routines", async (req) => {
    const { agentId } = req.query as { agentId?: string };
    return store.listRoutines(agentId);
  });

  app.post("/api/routines", async (req, reply) => {
    const body = z
      .object({
        agentId: z.string(),
        name: z.string().min(1).max(80),
        prompt: z.string().min(1).max(20000),
        intervalMinutes: z.number().min(1).max(60 * 24 * 30).optional(),
        schedule: z.string().min(1).max(200).optional(),
        skillId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    if (!store.getAgent(body.data.agentId)) return reply.code(400).send({ error: "unknown agent" });
    if (store.listRoutines(body.data.agentId).length >= 50) {
      return reply.code(400).send({ error: "this agent already has 50 routines" });
    }
    let routine;
    try {
      routine = store.createRoutine(body.data);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    broadcast({ type: "routine_updated", routine });
    return routine;
  });

  app.patch("/api/routines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        prompt: z.string().min(1).max(20000).optional(),
        intervalMinutes: z.number().min(1).max(60 * 24 * 30).optional(),
        schedule: z.string().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
        skillId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const patch = {
      ...body.data,
      skillId: body.data.skillId === null ? undefined : body.data.skillId,
    };
    const routine = store.updateRoutine(id, patch);
    if (!routine) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "routine_updated", routine });
    return routine;
  });

  app.delete("/api/routines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getRoutine(id)) return reply.code(404).send({ error: "not found" });
    store.deleteRoutine(id);
    broadcast({ type: "routine_deleted", routineId: id });
    return { ok: true };
  });

  app.post("/api/routines/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getRoutine(id)) return reply.code(404).send({ error: "not found" });
    const ok = runRoutineNow(id);
    return { ok };
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

  app.post("/api/conversations/:id/pin", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ pinned: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const conv = store.setConversationPinned(id, body.data.pinned);
    if (!conv) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "conversation_updated", conversation: conv });
    return conv;
  });

  app.post("/api/messages/:id/react", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ emoji: z.string().min(1).max(16) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const message = store.toggleMessageReaction(id, body.data.emoji);
    if (!message) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "message", message });
    return message;
  });

  app.get("/api/search", async (req) => {
    const q = String((req.query as { q?: string }).q ?? "");
    return store.searchMessages(q);
  });

  app.get("/api/plugins", async () => store.listPlugins());

  app.post("/api/plugins", async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(60),
        kind: z.enum(["mcp", "webhook"]),
        command: z.string().max(400).optional(),
        args: z.array(z.string().max(200)).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (parsed.data.kind === "mcp" && !parsed.data.command) {
      return reply.code(400).send({ error: "MCP plugins need a command" });
    }
    if (parsed.data.kind === "webhook" && !parsed.data.url) {
      return reply.code(400).send({ error: "Webhook plugins need a URL" });
    }
    const plugin = store.createPlugin(parsed.data);
    broadcast({ type: "plugin_updated", plugin });
    return plugin;
  });

  app.patch("/api/plugins/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).max(60).optional(),
        enabled: z.boolean().optional(),
        command: z.string().max(400).optional(),
        args: z.array(z.string().max(200)).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const plugin = store.updatePlugin(id, parsed.data);
    if (!plugin) return reply.code(404).send({ error: "not found" });
    broadcast({ type: "plugin_updated", plugin });
    return plugin;
  });

  app.delete("/api/plugins/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getPlugin(id)) return reply.code(404).send({ error: "not found" });
    forgetPlugin(id);
    store.deletePlugin(id);
    broadcast({ type: "plugin_deleted", pluginId: id });
    return { ok: true };
  });

  app.get("/api/agents/:id/teach", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    return { session: getTeachSession(id) ?? null };
  });

  app.post("/api/agents/:id/teach/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getAgent(id)) return reply.code(404).send({ error: "not found" });
    const body = z.object({ name: z.string().min(1).max(60), notes: z.string().max(4000).default("") }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    return startTeach(id, body.data.name, body.data.notes);
  });

  app.post("/api/agents/:id/teach/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ save: z.boolean().default(true) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const skill = await stopTeach(id, body.data.save);
    return { ok: true, skill, session: getTeachSession(id) };
  });
}
