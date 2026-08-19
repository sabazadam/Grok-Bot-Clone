/**
 * Browser-engine helpers. The agent's computer runs a real desktop browser driven by OS-level input
 * (xdotool), so navigator.webdriver stays false regardless of engine. Camoufox reads its
 * fingerprint-spoofing config from the CAMOU_CONFIG env var (JSON) at the C++ level — no Playwright
 * or remote-debugging needed. We assemble that JSON here (server-side) so it is unit-testable and
 * write it into the in-container browser.env for the launcher wrapper to export.
 */
import type { BrowserEngine } from "@grokbot/shared";

export function normalizeEngine(value: string | undefined | null): BrowserEngine {
  return value === "camoufox" ? "camoufox" : "chromium";
}

/**
 * Build the CAMOU_CONFIG JSON from the agent's UA / timezone / locale. Keys mirror Camoufox's
 * documented config properties. Kept intentionally small; BrowserForge fills the rest at launch.
 */
export function camouConfig(opts: { userAgent: string; timezone: string; locale: string }): string {
  const locales = opts.locale
    ? [opts.locale, opts.locale.split("-")[0]].filter((v, i, a) => v && a.indexOf(v) === i)
    : ["en-US", "en"];
  const config: Record<string, unknown> = {};
  if (opts.userAgent) config["navigator.userAgent"] = opts.userAgent;
  if (locales.length) {
    config["navigator.language"] = locales[0];
    config["navigator.languages"] = locales;
    config["locale:all"] = locales.join(",");
  }
  if (opts.timezone) config["timezone"] = opts.timezone;
  return JSON.stringify(config);
}
