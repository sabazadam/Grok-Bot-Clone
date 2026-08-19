import { describe, it, expect } from "vitest";
import { camouConfig, normalizeEngine } from "./browserEngine.js";

describe("normalizeEngine", () => {
  it("defaults unknown values to chromium", () => {
    expect(normalizeEngine("camoufox")).toBe("camoufox");
    expect(normalizeEngine("chromium")).toBe("chromium");
    expect(normalizeEngine("")).toBe("chromium");
    expect(normalizeEngine(undefined)).toBe("chromium");
    expect(normalizeEngine("firefox")).toBe("chromium");
  });
});

describe("camouConfig", () => {
  it("assembles a CAMOU_CONFIG JSON from UA/timezone/locale", () => {
    const json = camouConfig({
      userAgent: "Mozilla/5.0 (Macintosh) Firefox/135.0",
      timezone: "America/New_York",
      locale: "en-US",
    });
    const cfg = JSON.parse(json);
    expect(cfg["navigator.userAgent"]).toContain("Firefox/135.0");
    expect(cfg["timezone"]).toBe("America/New_York");
    expect(cfg["navigator.language"]).toBe("en-US");
    expect(cfg["navigator.languages"]).toEqual(["en-US", "en"]);
  });

  it("produces valid JSON even with empty inputs", () => {
    const cfg = JSON.parse(camouConfig({ userAgent: "", timezone: "", locale: "" }));
    // no UA/timezone keys, but still an object
    expect(typeof cfg).toBe("object");
    expect(cfg["navigator.userAgent"]).toBeUndefined();
  });
});
