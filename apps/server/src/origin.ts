/**
 * Browser-origin checks for the unauthenticated local API.
 *
 * GrokBot has no login. The API is meant to stay on loopback or a private
 * tailnet. CORS / WebSocket must not reflect arbitrary public websites, or a
 * visited page could subscribe to live chats and screenshot URLs.
 */

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
    return true;
  }
  if (host.endsWith(".local")) return true;

  const ip4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip4) {
    const [a, b] = [Number(ip4[1]), Number(ip4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Tailscale CGNAT
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  return false;
}

/** True when a browser Origin may talk to this process. Missing Origin (native clients) is allowed. */
export function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}
