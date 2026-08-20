/** Cancel in-flight work so a new user message (or Stop now) takes priority. */
import * as store from "../store.js";
import * as service from "../agents/service.js";
import { computerManager } from "../computer/manager.js";
import { cancelTask, hasLiveTask } from "./cancel.js";
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
    // Live runners set idle in their finally. Orphans left by a restart have
    // no runner, so Stop must clear the ghost working/waiting status here.
    if (!hasLiveTask(id)) {
      const agent = store.getAgent(id);
      if (agent && (agent.status === "working" || agent.status === "waiting_approval")) {
        service.setStatus(id, "idle");
      }
    }
  }
}
