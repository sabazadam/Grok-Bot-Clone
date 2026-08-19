/**
 * Teach-a-task: record a short demo on an agent's computer, then save a skill.
 * Official Grok Bot records up to 10 minutes; we keep a lighter local version.
 */
import type { Skill } from "@grokbot/shared";
import { computerManager } from "../computer/manager.js";
import * as store from "../store.js";
import { broadcast } from "../bus.js";
import { setTakeover } from "./takeover.js";
import * as service from "../agents/service.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

interface TeachSession {
  agentId: string;
  name: string;
  notes: string;
  startedAt: number;
  shots: string[];
  timer?: ReturnType<typeof setInterval>;
}

const sessions = new Map<string, TeachSession>();
const MAX_MS = 10 * 60 * 1000;

function saveShot(agentId: string, png: Buffer): string {
  const file = `teach_${agentId}_${Date.now()}.png`;
  fs.mkdirSync(path.join(config.dataDir, "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(config.dataDir, "screenshots", file), png);
  return `/screenshots/${file}`;
}

export function getTeachSession(agentId: string): Omit<TeachSession, "timer"> | undefined {
  const s = sessions.get(agentId);
  if (!s) return undefined;
  return { agentId: s.agentId, name: s.name, notes: s.notes, startedAt: s.startedAt, shots: s.shots };
}

export async function startTeach(agentId: string, name: string, notes: string): Promise<Omit<TeachSession, "timer">> {
  const existing = sessions.get(agentId);
  if (existing?.timer) clearInterval(existing.timer);
  await service.makeRoomForComputer(agentId);
  await computerManager.ensureRunning(agentId);
  setTakeover(agentId, true);
  service.setStatus(agentId, "idle");
  const session: TeachSession = {
    agentId,
    name: name.trim() || "Taught task",
    notes: notes.trim(),
    startedAt: Date.now(),
    shots: [],
  };
  try {
    const png = await computerManager.screenshot(agentId);
    session.shots.push(saveShot(agentId, png));
  } catch {
    /* computer may still be coming up */
  }
  session.timer = setInterval(() => {
    void (async () => {
      const cur = sessions.get(agentId);
      if (!cur) return;
      if (Date.now() - cur.startedAt > MAX_MS) {
        await stopTeach(agentId, true);
        return;
      }
      try {
        const png = await computerManager.screenshot(agentId);
        cur.shots.push(saveShot(agentId, png));
        if (cur.shots.length > 40) cur.shots = cur.shots.slice(-40);
      } catch {
        /* ignore */
      }
    })();
  }, 8000);
  sessions.set(agentId, session);
  return getTeachSession(agentId)!;
}

export async function stopTeach(agentId: string, save: boolean): Promise<Skill | undefined> {
  const session = sessions.get(agentId);
  if (!session) return undefined;
  if (session.timer) clearInterval(session.timer);
  sessions.delete(agentId);
  setTakeover(agentId, false);
  if (!save) return undefined;
  const steps = session.shots.map((url, i) => `${i + 1}. Screenshot ${url}`).join("\n");
  const skill = store.createSkill({
    name: session.name,
    description: session.notes.slice(0, 160) || "Taught from a recorded demo",
    instructions: [
      `This skill was taught from a live demo on the agent's computer.`,
      session.notes ? `Teacher notes:\n${session.notes}` : "",
      `Replay the same UI path. Key frames from the demo:`,
      steps || "(no frames captured)",
      `Validate the same end state the teacher showed. Ask for approval before sending, purchasing, deleting, or publishing.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    createdByAgentId: agentId,
  });
  store.setAgentSkill(agentId, skill.id, true);
  broadcast({ type: "skill_updated", skill });
  return skill;
}
