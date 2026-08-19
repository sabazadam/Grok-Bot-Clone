/** Cancel in-flight work so a new user message (or Stop now) takes priority. */
import * as store from "../store.js";
import { computerManager } from "../computer/manager.js";
import { cancelTask } from "./cancel.js";
import { clearPending } from "./queue.js";
import { rejectOpenApprovalsForAgents } from "./approvals.js";

export function interruptAgents(agentIds: string[]): void {
  rejectOpenApprovalsForAgents(agentIds);
  for (const id of agentIds) {
    clearPending(id);
    for (const task of store.listActiveTasksForAgent(id)) {
      cancelTask(task.id);
    }
    void computerManager.abortExec(id);
  }
}
