import type { Agent, AgentStatus, Approval, Conversation, Message, Routine, Skill, Task } from "./entities.js";

/** WebSocket events pushed from server to UI. */
export type ServerEvent =
  | { type: "message"; message: Message }
  | { type: "agent_updated"; agent: Agent }
  | { type: "agent_status"; agentId: string; status: AgentStatus }
  | { type: "conversation_updated"; conversation: Conversation }
  | { type: "task_updated"; task: Task }
  | {
      type: "task_step";
      taskId: string;
      agentId: string;
      stepIndex: number;
      caption: string;
      screenshotUrl?: string;
    }
  | { type: "approval_created"; approval: Approval }
  | { type: "approval_resolved"; approval: Approval }
  | { type: "skill_updated"; skill: Skill }
  | { type: "skill_deleted"; skillId: string }
  | { type: "routine_updated"; routine: Routine }
  | { type: "routine_deleted"; routineId: string };
