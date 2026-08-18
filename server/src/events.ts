import type { WebSocket } from 'ws';
import type { AgentRow, Message, WsEvent } from './types.js';
import { toPublicAgent } from './db.js';

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket, hello: WsEvent): void {
  clients.add(ws);
  ws.send(JSON.stringify(hello));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcast(event: WsEvent): void {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

export function broadcastAgent(row: AgentRow, kind: 'agent_created' | 'agent_updated' = 'agent_updated'): void {
  broadcast({ type: kind, agent: toPublicAgent(row) });
}

export function broadcastMessage(message: Message): void {
  broadcast({ type: 'message', message });
}
