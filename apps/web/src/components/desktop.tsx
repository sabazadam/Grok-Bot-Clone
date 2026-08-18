"use client";

import type { PointerEvent } from "react";
import type { WorkstationState } from "@/lib/types";

export function Desktop({
  state,
  botName,
  onPointer,
}: {
  state: WorkstationState;
  botName: string;
  onPointer?: (type: "move" | "click", x: number, y: number) => void;
}) {
  const focused = state.windows.find((win) => win.focused && !win.minimized);

  function coords(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.width;
    const y = ((event.clientY - rect.top) / rect.height) * state.height;
    return { x, y };
  }

  return (
    <div
      className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
      style={{
        background: `radial-gradient(1200px 600px at 20% 0%, ${state.wallpaper}33, transparent 50%),
          linear-gradient(180deg, #141821 0%, #0b0d12 100%)`,
      }}
      onPointerMove={(event) => {
        if (!state.takeover || !onPointer) return;
        const { x, y } = coords(event);
        onPointer("move", x, y);
      }}
      onPointerDown={(event) => {
        if (!state.takeover || !onPointer) return;
        const { x, y } = coords(event);
        onPointer("click", x, y);
      }}
    >
      <div className="absolute inset-x-0 top-0 z-20 flex h-8 items-center justify-between bg-black/35 px-3 text-[11px] text-white/85 backdrop-blur-md">
        <span className="font-medium">{botName} OS</span>
        <span className="text-white/60">{state.lastAction}</span>
        <span>
          {new Date(state.updatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {state.windows
        .filter((win) => !win.minimized)
        .map((win) => (
          <div
            key={win.id}
            className="absolute overflow-hidden rounded-lg border border-white/10 bg-[#12141a]/95 shadow-2xl"
            style={{
              left: `${(win.x / state.width) * 100}%`,
              top: `${(win.y / state.height) * 100}%`,
              width: `${(win.w / state.width) * 100}%`,
              height: `${(win.h / state.height) * 100}%`,
              outline: win.focused ? "1px solid rgba(244,185,66,0.7)" : undefined,
            }}
          >
            <div className="flex h-8 items-center gap-2 border-b border-white/10 bg-black/40 px-2 text-[11px]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b7a]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f4b942]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#7ee0a8]" />
              <span className="ml-1 truncate text-white/80">{win.title}</span>
            </div>
            <div className="h-[calc(100%-2rem)] overflow-auto p-3 text-[11px] leading-5 text-white/85">
              {win.kind === "files" && (
                <ul className="space-y-1">
                  {state.files.map((file) => (
                    <li key={file.name} className="flex justify-between gap-4">
                      <span>{file.kind === "dir" ? "📁" : "📄"} {file.name}</span>
                      <span className="text-white/40">
                        {file.size !== undefined ? `${file.size} B` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {win.kind === "browser" && (
                <div>
                  <div className="mb-2 truncate rounded-md bg-black/40 px-2 py-1 text-white/60">
                    {state.browser.loading ? "Loading…" : state.browser.url}
                  </div>
                  <div className="whitespace-pre-wrap">{state.browser.body}</div>
                </div>
              )}
              {win.kind === "terminal" && (
                <pre className="font-mono whitespace-pre-wrap text-[#9be28c]">
                  {state.terminal.lines.join("\n")}
                  {focused?.kind === "terminal" ? `\n$ ${state.terminal.input}▊` : ""}
                </pre>
              )}
            </div>
          </div>
        ))}

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-md">
        {[
          { id: "files", label: "Files" },
          { id: "browser", label: "Web" },
          { id: "terminal", label: "Term" },
        ].map((app) => (
          <div
            key={app.id}
            className="flex h-10 w-12 flex-col items-center justify-center rounded-xl bg-white/8 text-[10px] text-white/80"
          >
            {app.label}
          </div>
        ))}
      </div>

      <div
        className="desktop-cursor pointer-events-none absolute z-30"
        style={{
          left: `${(state.cursor.x / state.width) * 100}%`,
          top: `${(state.cursor.y / state.height) * 100}%`,
        }}
      />

      {state.takeover && (
        <div className="absolute right-3 top-10 z-30 rounded-full bg-danger px-2 py-0.5 text-[10px] font-medium text-white">
          You have the keyboard
        </div>
      )}
    </div>
  );
}
