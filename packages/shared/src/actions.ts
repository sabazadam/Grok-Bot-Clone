/**
 * Normalized computer-use action schema.
 *
 * Every model provider adapter (Anthropic / OpenAI / Gemini / generic) translates its
 * provider-specific tool calls into these actions. Coordinates are always PIXELS at the
 * agent computer's native resolution (Gemini's normalized 0-1000 grid is scaled in its
 * adapter before it gets here).
 */

export type MouseButton = "left" | "right" | "middle";

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "left_click"; x: number; y: number }
  | { type: "double_click"; x: number; y: number }
  | { type: "triple_click"; x: number; y: number }
  | { type: "right_click"; x: number; y: number }
  | { type: "middle_click"; x: number; y: number }
  | { type: "mouse_move"; x: number; y: number }
  | { type: "left_click_drag"; startX: number; startY: number; x: number; y: number }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right"; amount: number }
  | { type: "type"; text: string }
  /** Press a key or chord, xdotool syntax after normalization, e.g. "Return", "ctrl+a" */
  | { type: "key"; key: string }
  | { type: "hold_key"; key: string; durationMs: number }
  | { type: "wait"; durationMs: number }
  | { type: "cursor_position" }
  /** Sequence of primitive actions executed in order (e.g. Gemini's type_text_at = click+clear+type+enter). */
  | { type: "batch"; steps: ComputerAction[]; description?: string };

/** Actions an agent can take beyond the computer (tools in the agent loop). */
export type AgentTool =
  | "computer"
  | "bash"
  | "send_message_to_user"
  | "send_message_to_agent"
  | "update_memory"
  | "request_approval"
  | "task_complete";

export interface ActionResult {
  ok: boolean;
  /** base64 PNG when the action produces/refreshes a screenshot */
  screenshotB64?: string;
  /** stdout/stderr for bash actions */
  output?: string;
  error?: string;
  cursor?: { x: number; y: number };
}

export interface Resolution {
  width: number;
  height: number;
}

export function parseResolution(s: string): Resolution {
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m) return { width: 1280, height: 800 };
  return { width: Number(m[1]), height: Number(m[2]) };
}
