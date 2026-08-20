/**
 * Identify source IPs that belong to Docker / OrbStack container networks.
 *
 * In server+commander mode the Vite proxy (and a HOST=0.0.0.0 API) is reachable
 * from agent desktops. An agent that can POST /api/plugins would spawn an MCP
 * command on the host. Reject those clients; commanders arrive via Tailscale
 * (100.64/10) or the LAN, not the container bridge.
 */
export function isContainerSourceAddress(addr?: string | null): boolean {
  if (!addr) return false;
  const ip = addr.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  // 172.16.0.0/12 — default docker0 and most custom bridges
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Docker Desktop Linux VM
  if (a === 192 && b === 168 && c === 65) return true;
  // OrbStack default / VPNKit userland net
  if (a === 192 && b === 168 && c === 205) return true;
  if (a === 198 && b === 19) return true;
  return false;
}
