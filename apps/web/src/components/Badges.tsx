import type { Agent, ToolPolicyName } from "@grokbot/shared";

const POLICY_SHORT: Record<ToolPolicyName, string> = {
  full: "Full",
  research: "Research",
  coding: "Coding",
  browser_only: "Browser",
  review_only: "Review",
  custom: "Custom",
};

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      className="rounded-full px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

/**
 * Compact role + tool-policy badges. `compact` (sidebar) hides the tool policy chip when it's the
 * default "Full" to keep rows clean; the profile view shows everything.
 */
export function RoleBadges({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const pills: React.ReactNode[] = [];
  if (agent.isTeamLead) {
    pills.push(<Pill key="lead" label="Lead" bg="color-mix(in srgb, var(--accent) 18%, transparent)" fg="var(--accent)" />);
  }
  if (agent.agentKind === "specialist") {
    pills.push(<Pill key="spec" label="Specialist" bg="color-mix(in srgb, #7c5cbf 20%, transparent)" fg="#7c5cbf" />);
  }
  const showPolicy = !compact || agent.toolPolicy !== "full";
  if (showPolicy && agent.toolPolicy) {
    pills.push(
      <Pill
        key="pol"
        label={POLICY_SHORT[agent.toolPolicy]}
        bg="var(--surface)"
        fg="var(--muted)"
      />,
    );
  }
  if (pills.length === 0) return null;
  return <span className="flex flex-wrap items-center gap-1">{pills}</span>;
}

export { POLICY_SHORT };
