import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config, ensureDataDirs, liveModelConfig } from "./config.js";
import { registerRoutes } from "./routes.js";
import { getDb } from "./db.js";
import { computerManager } from "./computer/manager.js";
import * as store from "./store.js";
import * as service from "./agents/service.js";
import { broadcast } from "./bus.js";
import { startScheduler } from "./runtime/scheduler.js";
import { isContainerSourceAddress } from "./net.js";

async function main() {
  ensureDataDirs();
  getDb();
  service.reconcileStatuses();
  const live = liveModelConfig();
  if (live) {
    const promoted = store.promoteMockAgents(live.provider, live.model);
    for (const agent of promoted) {
      broadcast({ type: "agent_updated", agent });
    }
  }
  for (const agent of store.assignMissingFaceShapes()) {
    broadcast({ type: "agent_updated", agent });
  }
  void computerManager
    .reapOrphans(store.listAgents().map((a) => a.id))
    .then(() => computerManager.hydrateLastUsed())
    .catch(() => undefined);

  const app = Fastify({ logger: { level: "info" }, bodyLimit: 120 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url.startsWith("/health?")) return;
    if (isContainerSourceAddress(req.ip) || isContainerSourceAddress(req.socket.remoteAddress)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  app.get("/health", async () => ({ ok: true, name: "grokbot-server", time: Date.now() }));

  await registerRoutes(app);
  startScheduler();

  // Idle computer auto-stop sweep
  if (config.computerIdleStopMinutes > 0) {
    setInterval(async () => {
      const active = new Set(
        store
          .listAgents()
          .filter((a) => a.status === "working" || a.status === "waiting_approval")
          .map((a) => a.id),
      );
      const stopped = await computerManager.stopIdle(active);
      for (const agentId of stopped) {
        store.setAgentStatus(agentId, "off");
      }
    }, 60_000).unref();
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`GrokBot server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
