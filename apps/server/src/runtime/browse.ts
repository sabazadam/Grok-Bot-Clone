/** Infer a URL the agent's computer should open so the user can watch. */

export function inferBrowseUrl(prompt: string): string | undefined {
  return inferBrowseUrls(prompt)[0];
}

/** Only http(s) URLs with no shell metacharacters — these are interpolated into /bin/sh. */
export function isSafeBrowseUrl(url: string): boolean {
  if (!url || url.length > 2048 || /[\s'"\\`$|]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "")}'`;
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

export function inferBrowseUrls(prompt: string): string[] {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const urls: string[] = [];
  const rawUrl = text.match(/https?:\/\/[^\s)]+/i);
  if (rawUrl) {
    const cleaned = rawUrl[0].replace(/[.,;:]+$/, "");
    if (isSafeBrowseUrl(cleaned)) urls.push(cleaned);
  }

  const search =
    text.match(/(?:open\s+)?google(?:\.com)?(?:\s+and)?\s+search\s+(.+?)(?:[.!?]|$)/i) ||
    text.match(/search(?:\s+(?:on\s+)?google)?(?:\s+for)?\s+(.+?)(?:[.!?]|$)/i) ||
    text.match(/(?:look up|find out)\s+(.+?)(?:[.!?]|$)/i);
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
  return [...new Set(urls)].filter(isSafeBrowseUrl);
}

export function openBrowserCommand(url: string): string {
  if (!isSafeBrowseUrl(url)) {
    throw new Error("refusing to open a non-http(s) or shell-unsafe URL");
  }
  const quoted = shSingleQuote(url);
  return `DISPLAY=:0 nohup /usr/local/bin/browser ${quoted} >/dev/null 2>&1 & sleep 3; echo opened ${quoted}`;
}
