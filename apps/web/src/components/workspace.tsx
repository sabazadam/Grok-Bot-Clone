"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Desktop } from "@/components/desktop";
import { MODEL_CATALOG, PROVIDERS, type Bot, type ChatMessage, type ProviderId, type Skill, type Thread, type WorkstationState } from "@/lib/types";

type Snapshot = {
  bots: Bot[];
  threads: Thread[];
  skills: Skill[];
  approvals: { id: string; status: string; summary: string; botId: string; threadId: string }[];
  settings: {
    timezone: string;
    providers: Record<string, { hasKey: boolean; baseUrl: string }>;
  };
};

async function readSSE(
  response: Response,
  onEvent: (type: string, data: unknown) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const type = chunk.match(/^event: (.+)$/m)?.[1];
      const raw = chunk.match(/^data: (.*)$/m)?.[1];
      if (!type || raw === undefined) continue;
      onEvent(type, raw ? JSON.parse(raw) : null);
    }
  }
}

export function Workspace({
  initial,
  initialThreadId,
  initialMessages,
  initialWorkstation,
}: {
  initial: Snapshot;
  initialThreadId: string | null;
  initialMessages: ChatMessage[];
  initialWorkstation: WorkstationState | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [computerOpen, setComputerOpen] = useState(true);
  const [workstation, setWorkstation] = useState<WorkstationState | null>(
    initialWorkstation,
  );
  const [modal, setModal] = useState<"bot" | "group" | "settings" | "skill" | null>(null);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const loadSnapshot = useCallback(async () => {
    const response = await fetch("/api/state");
    const data = (await response.json()) as Snapshot;
    setSnapshot(data);
    return data;
  }, []);

  const thread = snapshot?.threads.find((item) => item.id === threadId) || null;
  const visibleBots = useMemo(
    () => (snapshot?.bots || []).filter((bot) => !bot.hidden),
    [snapshot],
  );
  const threadBots = useMemo(
    () => visibleBots.filter((bot) => thread?.botIds.includes(bot.id)),
    [visibleBots, thread],
  );
  const activeBot = threadBots[0] || null;

  const loadThread = useCallback(async (id: string) => {
    const response = await fetch(`/api/threads/${id}`);
    const data = (await response.json()) as { messages?: ChatMessage[] };
    setMessages(data.messages || []);
    setThreadId(id);
    await fetch(`/api/threads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unread: false }),
    });
  }, []);

  const loadWorkstation = useCallback(async (botId: string) => {
    const response = await fetch(`/api/workstations/${botId}`);
    if (!response.ok) return;
    const data = (await response.json()) as { workstation: WorkstationState };
    setWorkstation(data.workstation);
  }, []);

  async function openThread(id: string, botId?: string) {
    await loadThread(id);
    if (botId) await loadWorkstation(botId);
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy]);

  async function send() {
    if (!threadId || !draft.trim() || busy) return;
    const content = draft.trim();
    setDraft("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      {
        id: `local_${Date.now()}`,
        threadId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch(`/api/threads/${threadId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await readSSE(response, (type, data) => {
        if (type === "message" || type === "error") {
          const message = data as ChatMessage;
          if (message?.id) {
            setMessages((current) =>
              current.some((item) => item.id === message.id)
                ? current
                : [...current, message],
            );
          }
        }
        if (type === "computer") {
          setWorkstation(data as WorkstationState);
          setComputerOpen(true);
        }
        if (type === "handoff") {
          const message = data as ChatMessage;
          if (message?.threadId === threadId) {
            setMessages((current) => [...current, message]);
          }
        }
      });
      await loadSnapshot();
      await loadThread(threadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(id: string, status: "approved" | "denied") {
    await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (threadId) await loadThread(threadId);
    await loadSnapshot();
  }

  async function inputDesktop(type: "move" | "click", x: number, y: number) {
    if (!activeBot || !workstation?.takeover) return;
    const response = await fetch(`/api/workstations/${activeBot.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, x, y }),
    });
    const data = (await response.json()) as { workstation?: WorkstationState };
    if (data.workstation) setWorkstation(data.workstation);
  }

  async function toggleTakeover() {
    if (!activeBot) return;
    const response = await fetch(`/api/workstations/${activeBot.id}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "takeover", takeover: !workstation?.takeover }),
    });
    const data = (await response.json()) as { workstation?: WorkstationState };
    if (data.workstation) setWorkstation(data.workstation);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-sm font-semibold text-black">
            F
          </div>
          <div>
            <div className="text-sm font-semibold">Forge</div>
            <div className="text-[11px] text-muted">Multi-model agent OS</div>
          </div>
        </div>
        <div className="flex gap-2 px-3 pb-3">
          <button
            className="flex-1 rounded-lg bg-gold px-3 py-1.5 text-xs font-medium text-black"
            onClick={() => setModal("bot")}
          >
            New Bot
          </button>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink"
            onClick={() => setModal("group")}
          >
            Group
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted">Bots</p>
          {visibleBots.map((bot) => {
            const dm = snapshot.threads.find(
              (item) => item.kind === "dm" && item.botIds[0] === bot.id,
            );
            return (
              <button
                key={bot.id}
                onClick={() => dm && void openThread(dm.id, bot.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${
                  thread?.kind === "dm" && thread.botIds[0] === bot.id
                    ? "bg-raised"
                    : "hover:bg-raised/60"
                }`}
              >
                <Avatar bot={bot} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{bot.name}</div>
                  <div className="truncate text-[11px] text-muted">{bot.title}</div>
                </div>
                <StatusDot status={bot.status} />
              </button>
            );
          })}
          <p className="mt-3 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted">
            Groups
          </p>
          {snapshot.threads
            .filter((item) => item.kind === "group")
            .map((item) => (
              <button
                key={item.id}
                onClick={() => void openThread(item.id, item.botIds[0])}
                className={`mb-1 w-full rounded-xl px-3 py-2 text-left text-sm ${
                  threadId === item.id ? "bg-raised" : "hover:bg-raised/60"
                }`}
              >
                {item.title}
              </button>
            ))}
        </div>
        <div className="border-t border-border p-3">
          <button
            className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-muted hover:text-ink"
            onClick={() => setModal("settings")}
          >
            Models & keys
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <div className="text-sm font-medium">{thread?.title || "Select a Bot"}</div>
            <div className="text-[12px] text-muted">
              {threadBots.map((bot) => `${bot.name} · ${bot.provider}/${bot.model}`).join("  ·  ")}
            </div>
          </div>
          <div className="flex gap-2">
            {thread?.kind === "dm" && activeBot && (
              <button
                className="rounded-lg border border-border px-3 py-1.5 text-xs"
                onClick={async () => {
                  await fetch(`/api/threads/${thread.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      allowCollaboration: !thread.allowCollaboration,
                    }),
                  });
                  await loadSnapshot();
                }}
              >
                {thread.allowCollaboration ? "Collaboration on" : "Collaboration off"}
              </button>
            )}
            <button
              className="rounded-lg border border-border px-3 py-1.5 text-xs"
              onClick={() => setModal("skill")}
            >
              Skills
            </button>
            <button
              className="rounded-lg bg-raised px-3 py-1.5 text-xs"
              onClick={() => setComputerOpen((value) => !value)}
            >
              {computerOpen ? "Hide computer" : "Agent computer"}
            </button>
          </div>
        </header>

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              bots={visibleBots}
              onApprove={resolveApproval}
            />
          ))}
          {busy && <p className="text-xs text-muted">Working on the OS…</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <form
          className="border-t border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="rounded-2xl border border-border bg-panel p-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                thread?.kind === "group"
                  ? "Ask the group, or @ a Bot by name…"
                  : "Message like a teammate. Ask them to use the OS, or to talk to another Bot."
              }
              className="h-20 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] text-muted">
                Enter to send · Shift+Enter for a newline
              </span>
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-gold px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </form>
      </main>

      {computerOpen && activeBot && workstation && (
        <section className="flex w-[520px] shrink-0 flex-col border-l border-border bg-sidebar p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{activeBot.name}&apos;s computer</div>
              <div className="text-[11px] text-muted">
                Isolated OS · live view, not a recording
              </div>
            </div>
            <button
              onClick={() => void toggleTakeover()}
              className={`rounded-lg px-3 py-1.5 text-xs ${
                workstation.takeover ? "bg-danger text-white" : "border border-border"
              }`}
            >
              {workstation.takeover ? "Return control" : "Take over"}
            </button>
          </div>
          <Desktop
            state={workstation}
            botName={activeBot.name}
            onPointer={(type, x, y) => {
              void inputDesktop(type, x, y);
            }}
          />
          <p className="mt-3 text-[11px] leading-5 text-muted">
            Passwords, 2FA, and CAPTCHAs stay with you. Take over, finish the
            step, then return control. This Bot cannot see another Bot&apos;s
            desktop.
          </p>
        </section>
      )}

      {modal === "bot" && (
        <CreateBotModal
          onClose={() => setModal(null)}
          onCreated={async (bot) => {
            await loadSnapshot();
            const dm = (await fetch("/api/state").then((r) => r.json())) as Snapshot;
            const threadNext = dm.threads.find(
              (item) => item.kind === "dm" && item.botIds[0] === bot.id,
            );
            if (threadNext) await openThread(threadNext.id, bot.id);
            setModal(null);
          }}
        />
      )}
      {modal === "group" && (
        <GroupModal
          bots={visibleBots}
          onClose={() => setModal(null)}
          onCreated={async (id) => {
            await loadSnapshot();
            await openThread(id);
            setModal(null);
          }}
        />
      )}
      {modal === "settings" && (
        <SettingsModal
          snapshot={snapshot}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await loadSnapshot();
            setModal(null);
          }}
        />
      )}
      {modal === "skill" && (
        <SkillModal
          skills={snapshot.skills}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await loadSnapshot();
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function Avatar({ bot }: { bot: Bot }) {
  return (
    <div
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-black"
      style={{ background: bot.color }}
    >
      {bot.initials}
    </div>
  );
}

function StatusDot({ status }: { status: Bot["status"] }) {
  const color =
    status === "working"
      ? "bg-gold"
      : status === "needs_attention"
        ? "bg-danger"
        : "bg-white/25";
  return <span className={`h-2 w-2 rounded-full ${color}`} />;
}

function MessageBubble({
  message,
  bots,
  onApprove,
}: {
  message: ChatMessage;
  bots: Bot[];
  onApprove: (id: string, status: "approved" | "denied") => void;
}) {
  const bot = bots.find((item) => item.id === message.botId);
  if (message.role === "approval") {
    return (
      <div className="rounded-2xl border border-gold/40 bg-gold/10 p-3">
        <div className="text-xs font-medium text-gold">Needs approval</div>
        <p className="mt-1 text-sm">{message.content}</p>
        <div className="mt-2 flex gap-2">
          <button
            className="rounded-lg bg-gold px-3 py-1 text-xs text-black"
            onClick={() => onApprove(String(message.meta?.approvalId || ""), "approved")}
          >
            Allow once
          </button>
          <button
            className="rounded-lg border border-border px-3 py-1 text-xs"
            onClick={() => onApprove(String(message.meta?.approvalId || ""), "denied")}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }
  if (message.role === "user") {
    return (
      <div className="ml-12 rounded-2xl bg-raised px-4 py-3 text-sm leading-6">
        {message.content}
      </div>
    );
  }
  return (
    <div className="mr-8 rounded-2xl border border-border bg-panel px-4 py-3">
      <div className="mb-1 text-[11px] text-muted">
        {message.role === "handoff"
          ? "Handoff"
          : message.role === "computer"
            ? "Computer"
            : bot?.name || "Forge"}
      </div>
      <div className="text-sm leading-6 whitespace-pre-wrap">{message.content}</div>
    </div>
  );
}

function CreateBotModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (bot: Bot) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<ProviderId>("rehearsal");
  const [model, setModel] = useState("rehearsal");
  const models =
    provider === "rehearsal" ? ["rehearsal"] : MODEL_CATALOG[provider].models;

  return (
    <Modal title="Create a Bot" onClose={onClose}>
      <Field label="Name" value={name} onChange={setName} placeholder="Scout" />
      <Field label="Role" value={title} onChange={setTitle} placeholder="Researcher" />
      <label className="mb-3 block text-xs text-muted">
        Standing rules
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 h-7 min-h-24 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
          placeholder="Own the research brief. Never contact anyone. Cite sources."
        />
      </label>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Model provider
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value as ProviderId;
              setProvider(next);
              setModel(next === "rehearsal" ? "rehearsal" : MODEL_CATALOG[next].models[0]);
            }}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm text-ink"
          >
            {PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Model
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm text-ink"
          >
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="w-full rounded-lg bg-gold py-2 text-sm font-medium text-black"
        onClick={async () => {
          const response = await fetch("/api/bots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, title, description, provider, model }),
          });
          const data = (await response.json()) as { bot?: Bot; error?: string };
          if (!data.bot) throw new Error(data.error || "Could not create Bot");
          await onCreated(data.bot);
        }}
      >
        Create teammate
      </button>
    </Modal>
  );
}

function GroupModal({
  bots,
  onClose,
  onCreated,
}: {
  bots: Bot[];
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  return (
    <Modal title="New group chat" onClose={onClose}>
      <Field label="Group name" value={title} onChange={setTitle} placeholder="Website launch" />
      <div className="mb-3 space-y-1">
        {bots.map((bot) => (
          <label key={bot.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(bot.id)}
              onChange={(event) => {
                setSelected((current) =>
                  event.target.checked
                    ? [...current, bot.id]
                    : current.filter((id) => id !== bot.id),
                );
              }}
            />
            {bot.name} — {bot.title}
          </label>
        ))}
      </div>
      <button
        className="w-full rounded-lg bg-gold py-2 text-sm font-medium text-black disabled:opacity-40"
        disabled={selected.length < 2 || selected.length > 6}
        onClick={async () => {
          const response = await fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botIds: selected, title }),
          });
          const data = (await response.json()) as { thread?: Thread };
          if (data.thread) await onCreated(data.thread.id);
        }}
      >
        Open group
      </button>
    </Modal>
  );
}

function SettingsModal({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(snapshot.settings.providers).map(([id, value]) => [id, value.baseUrl]),
    ),
  );
  return (
    <Modal title="Models & keys" onClose={onClose}>
      <p className="mb-3 text-xs leading-5 text-muted">
        Grok Bot hides the model picker. Forge does the opposite: each Bot can
        run Claude, GPT, Gemini, Grok, OpenRouter, or any OpenAI-compatible
        endpoint. Keys stay on this machine.
      </p>
      {PROVIDERS.filter((id) => id !== "rehearsal").map((id) => (
        <div key={id} className="mb-3">
          <div className="mb-1 text-xs capitalize text-muted">
            {id}
            {snapshot.settings.providers[id]?.hasKey ? " · key saved" : ""}
          </div>
          <input
            type="password"
            placeholder="API key"
            value={keys[id] || ""}
            onChange={(event) => setKeys((current) => ({ ...current, [id]: event.target.value }))}
            className="mb-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          />
          <input
            placeholder="Base URL (optional)"
            value={urls[id] || ""}
            onChange={(event) => setUrls((current) => ({ ...current, [id]: event.target.value }))}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          />
        </div>
      ))}
      <button
        className="w-full rounded-lg bg-gold py-2 text-sm font-medium text-black"
        onClick={async () => {
          const providers = Object.fromEntries(
            PROVIDERS.filter((id) => id !== "rehearsal").map((id) => [
              id,
              { apiKey: keys[id], baseUrl: urls[id] },
            ]),
          );
          await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers }),
          });
          await onSaved();
        }}
      >
        Save keys
      </button>
    </Modal>
  );
}

function SkillModal({
  skills,
  onClose,
  onSaved,
}: {
  skills: Skill[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  return (
    <Modal title="Written skills" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        No screen recording. Save a playbook from text, the way you would brief a teammate.
      </p>
      <ul className="mb-3 space-y-2 text-sm">
        {skills.map((skill) => (
          <li key={skill.id} className="rounded-lg border border-border p-2">
            <div className="font-medium">{skill.name}</div>
            <div className="text-xs text-muted">{skill.body}</div>
          </li>
        ))}
      </ul>
      <Field label="Skill name" value={name} onChange={setName} />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="mb-3 h-24 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
        placeholder="When to use, steps, validation, what needs approval."
      />
      <button
        className="w-full rounded-lg bg-gold py-2 text-sm font-medium text-black"
        onClick={async () => {
          await fetch("/api/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, body }),
          });
          await onSaved();
        }}
      >
        Save skill
      </button>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-xs text-muted">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="mb-3 block text-xs text-muted">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink"
      />
    </label>
  );
}
