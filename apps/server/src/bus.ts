/** In-process event bus: pushes ServerEvents to all connected WebSocket clients. */
import type { WebSocket } from "ws";
import type { ServerEvent } from "@grokbot/shared";

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
}

export function broadcast(event: ServerEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}
