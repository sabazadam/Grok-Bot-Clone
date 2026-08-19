/** Infer a URL the agent's computer should open so the user can watch. */

export function inferBrowseUrl(prompt: string): string | undefined {
  return inferBrowseUrls(prompt)[0];
}

const WEATHER_STOP = new Set(["today", "now", "tomorrow", "this", "the", "what", "whats", "a", "is"]);

export function inferWeatherPlace(prompt: string): string | undefined {
  const text = prompt.replace(/\s+/g, " ").trim();
  const matches = [
    text.match(/\bweather\s+in\s+([A-Za-z][\w\s-]{1,40}?)(?:\s+today|\s+now|\s+tomorrow)?[.!?]?$/i),
    text.match(/\b([A-Za-z][\w-]{2,40})\s+weather\b/i),
  ];
  for (const m of matches) {
    const place = m?.[1]?.trim().replace(/^(what|whats|what's|the|is|a)\s+/i, "");
    if (place && !WEATHER_STOP.has(place.toLowerCase())) return place;
  }
  return undefined;
}

function sanitizeHttpUrl(raw: string): string | undefined {
  const trimmed = raw.replace(/[.,;:]+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function inferBrowseUrls(prompt: string): string[] {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const urls: string[] = [];
  const rawUrl = text.match(/https?:\/\/[^\s)]+/i);
  if (rawUrl) {
    const http = sanitizeHttpUrl(rawUrl[0]);
    if (http) urls.push(http);
  }

  // Require an explicit web intent. Bare "search my notes" / "find out why X failed"
  // must not boot a browser tab.
  const search =
    text.match(/(?:open\s+)?google(?:\.com)?(?:\s+and)?\s+search\s+(.+?)(?:[.!?]|$)/i) ||
    text.match(/search\s+(?:on\s+)?google(?:\s+for)?\s+(.+?)(?:[.!?]|$)/i) ||
    text.match(/(?:web|online|internet)\s+search(?:\s+for)?\s+(.+?)(?:[.!?]|$)/i);
  if (search?.[1]) {
    urls.push(`https://www.google.com/search?q=${encodeURIComponent(search[1].trim())}`);
  } else if (/\b(weather|forecast|news|browse)\b/i.test(text)) {
    const q = text
      .replace(/^(please|can you|could you|open google and)\s+/i, "")
      .slice(0, 160);
    urls.push(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
  }

  const place = inferWeatherPlace(text);
  if (place) urls.push(`https://wttr.in/${encodeURIComponent(place)}`);
  return [...new Set(urls)];
}

export function openBrowserCommand(url: string): string | undefined {
  const http = sanitizeHttpUrl(url);
  if (!http) return undefined;
  const safe = http.replace(/['\\]/g, "");
  return `DISPLAY=:0 nohup /usr/local/bin/browser '${safe}' >/dev/null 2>&1 & sleep 3; echo opened ${safe}`;
}
