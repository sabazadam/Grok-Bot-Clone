import express from 'express';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  deleteAgent, getAgent, getSetting, insertAgent, listAgents, listMessages,
  insertMessage, setSetting, toPublicAgent, updateAgent,
} from './db.js';
import { checkDocker, destroyComputer, restartComputer, startComputer, takeScreenshot } from './computers.js';
import { addClient, broadcast, broadcastAgent, broadcastMessage } from './events.js';
import { isRunning, stopRun, triggerRun } from './loop.js';
import { PROVIDERS, getProviderMeta, resolveApiKey } from './providers/index.js';

const PORT = Number(process.env.PORT ?? 4400);
const here = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '2mb' }));

const asyncRoute =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };

// ---------- agents ----------

app.get('/api/agents', (_req, res) => {
  res.json(listAgents().map(toPublicAgent));
});

app.post('/api/agents', asyncRoute(async (req, res) => {
  const { name, title = '', description = '', provider, model, color = '#7c5cff' } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!provider || !getProviderMeta(provider)) {
    res.status(400).json({ error: `unknown provider: ${provider}` });
    return;
  }
  if (!model || typeof model !== 'string') {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  const agent = insertAgent({
    name: name.trim(),
    title: String(title),
    description: String(description),
    provider,
    model,
    color: String(color),
  });
  broadcastAgent(agent, 'agent_created');
  insertAndBroadcastSystem(agent.id, 'Agent created. The computer boots on the first task.');
  // Boot the computer in the background so the first message is fast.
  startComputer(agent.id).catch((err) => {
    insertAndBroadcastSystem(agent.id, `Computer failed to start: ${err instanceof Error ? err.message : err}`);
  });
  res.json(toPublicAgent(agent));
}));

app.get('/api/agents/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return void res.status(404).json({ error: 'agent not found' });
  res.json(toPublicAgent(agent));
});

app.patch('/api/agents/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return void res.status(404).json({ error: 'agent not found' });
  const allowed = ['name', 'title', 'description', 'provider', 'model', 'color'] as const;
  const fields: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof req.body?.[key] === 'string') fields[key] = req.body[key];
  }
  if (fields.provider && !getProviderMeta(fields.provider)) {
    return void res.status(400).json({ error: `unknown provider: ${fields.provider}` });
  }
  const updated = updateAgent(agent.id, fields)!;
  broadcastAgent(updated);
  res.json(toPublicAgent(updated));
});

app.delete('/api/agents/:id', asyncRoute(async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  stopRun(agent.id);
  await destroyComputer(agent.id);
  deleteAgent(agent.id);
  broadcast({ type: 'agent_deleted', agentId: agent.id });
  res.json({ ok: true });
}));

// ---------- messages ----------

app.get('/api/agents/:id/messages', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return void res.status(404).json({ error: 'agent not found' });
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000);
  res.json(listMessages(agent.id, limit));
});

app.post('/api/agents/:id/messages', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return void res.status(404).json({ error: 'agent not found' });
  const content = String(req.body?.content ?? '').trim();
  if (!content) return void res.status(400).json({ error: 'content is required' });
  broadcastMessage(insertMessage({ agentId: agent.id, role: 'user', content }));
  triggerRun(agent.id);
  res.json({ ok: true });
});

app.post('/api/agents/:id/stop', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return void res.status(404).json({ error: 'agent not found' });
  if (isRunning(agent.id)) stopRun(agent.id);
  res.json({ ok: true });
});

// ---------- computer ----------

app.post('/api/agents/:id/computer/restart', asyncRoute(async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  res.json({ ok: true });
  try {
    await restartComputer(agent.id);
    insertAndBroadcastSystem(agent.id, 'Computer restarted (files in the home folder survived).');
  } catch (err) {
    insertAndBroadcastSystem(agent.id, `Computer restart failed: ${err instanceof Error ? err.message : err}`);
  }
}));

app.get('/api/agents/:id/screenshot', asyncRoute(async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  try {
    const png = await takeScreenshot(agent);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch {
    res.status(404).json({ error: 'computer is not running' });
  }
}));

// ---------- providers & settings ----------

app.get('/api/providers', (_req, res) => {
  res.json(
    PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      models: p.models,
      needsKey: p.needsKey,
      needsBaseUrl: p.needsBaseUrl,
      hasKey: p.needsKey ? Boolean(resolveApiKey(p.id)) : true,
    })),
  );
});

function settingsPayload() {
  const keys: Record<string, { set: boolean }> = {};
  const baseUrls: Record<string, string> = {};
  for (const p of PROVIDERS) {
    if (p.needsKey) keys[p.id] = { set: Boolean(resolveApiKey(p.id)) };
    if (p.needsBaseUrl) baseUrls[p.id] = getSetting(`baseurl:${p.id}`) ?? p.defaultBaseUrl ?? '';
  }
  return { keys, baseUrls };
}

app.get('/api/settings', (_req, res) => res.json(settingsPayload()));

app.put('/api/settings', (req, res) => {
  const { keys, baseUrls } = req.body ?? {};
  if (keys && typeof keys === 'object') {
    for (const [id, value] of Object.entries(keys as Record<string, string>)) {
      if (getProviderMeta(id)) setSetting(`apikey:${id}`, String(value));
    }
  }
  if (baseUrls && typeof baseUrls === 'object') {
    for (const [id, value] of Object.entries(baseUrls as Record<string, string>)) {
      if (getProviderMeta(id)) setSetting(`baseurl:${id}`, String(value));
    }
  }
  res.json(settingsPayload());
});

// ---------- static dashboard (production) ----------

const webDist = join(here, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/|ws$).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

// ---------- HTTP + WebSocket ----------

function insertAndBroadcastSystem(agentId: string, content: string): void {
  broadcastMessage(insertMessage({ agentId, role: 'system', content }));
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const vncMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/vnc$/);

  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      addClient(ws, { type: 'hello', agents: listAgents().map(toPublicAgent) });
    });
    return;
  }

  if (vncMatch) {
    const agent = getAgent(vncMatch[1]);
    if (!agent || agent.computerState !== 'running' || !agent.vncPort) {
      socket.destroy();
      return;
    }
    const vncPort = agent.vncPort;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const tcp = connect({ host: '127.0.0.1', port: vncPort });
      tcp.on('data', (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });
      tcp.on('close', () => ws.close());
      tcp.on('error', () => ws.close());
      ws.on('message', (data) => {
        tcp.write(data as Buffer);
      });
      ws.on('close', () => tcp.destroy());
      ws.on('error', () => tcp.destroy());
    });
    return;
  }

  socket.destroy();
});

// ---------- boot ----------

server.listen(PORT, () => {
  console.log(`[botbox] orchestrator listening on http://localhost:${PORT}`);
  checkDocker()
    .then(() => {
      console.log('[botbox] docker + computer image OK');
      // Bring existing agents' computers back up in the background.
      for (const agent of listAgents()) {
        startComputer(agent.id).catch((err) => {
          console.error(`[botbox] failed to start computer for ${agent.name}:`, err.message ?? err);
          insertAndBroadcastSystem(agent.id, `Computer failed to start: ${err instanceof Error ? err.message : err}`);
        });
      }
    })
    .catch((err) => console.warn(`[botbox] WARNING: ${err.message}`));
});
