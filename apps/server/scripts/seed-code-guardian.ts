/**
 * Create the permanent "Code Guardian" repo-health reviewer agent + its skill + a disabled hourly
 * routine. Idempotent — safe to re-run. Enable the routine in the Routines panel, or wire a git push
 * webhook (POST /api/hooks/git) to trigger reviews on push to main.
 *   npx tsx apps/server/scripts/seed-code-guardian.ts
 */
import { ensureCodeGuardian, CODE_GUARDIAN_NAME } from "../src/runtime/codeGuardian.js";

const { agentId, skillId, routineId } = ensureCodeGuardian();
console.log(JSON.stringify({ agent: CODE_GUARDIAN_NAME, agentId, skillId, routineId }, null, 2));
