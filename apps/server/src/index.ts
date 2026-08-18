import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config, ensureDataDirs } from "./config.js";

async function main() {
  ensureDataDirs();

  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    name: "grokbot-server",
    time: Date.now(),
  }));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`GrokBot server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
