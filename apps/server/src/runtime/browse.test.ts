import { describe, it, expect } from "vitest";
import { inferBrowseUrl, inferBrowseUrls, inferWeatherPlace, isSafeBrowseUrl, openBrowserCommand } from "./browse.js";

describe("inferBrowseUrl", () => {
  it("opens a Google search for the Izmir weather phrasing", () => {
    expect(inferBrowseUrl("open google and search what is izmir weather today")).toBe(
      "https://www.google.com/search?q=what%20is%20izmir%20weather%20today",
    );
  });

  it("keeps an explicit URL", () => {
    expect(inferBrowseUrl("open https://status.deepseek.com/ please")).toBe("https://status.deepseek.com/");
  });

  it("ignores ordinary chat", () => {
    expect(inferBrowseUrl("Remember this preference: short briefs")).toBeUndefined();
  });

  it("does not auto-open a URL that embeds shell command substitution", () => {
    expect(inferBrowseUrl("open https://evil.example/$(reboot) please")).toBeUndefined();
  });

  it("also opens wttr.in for a weather place", () => {
    expect(inferWeatherPlace("open google and search what is izmir weather today")).toBe("izmir");
    expect(inferBrowseUrls("open google and search what is izmir weather today")).toEqual([
      "https://www.google.com/search?q=what%20is%20izmir%20weather%20today",
      "https://wttr.in/izmir",
    ]);
  });
});

describe("openBrowserCommand", () => {
  it("launches the GUI browser on DISPLAY :0", () => {
    expect(openBrowserCommand("https://www.google.com/search?q=izmir")).toMatch(/\/usr\/local\/bin\/browser/);
  });

  it("keeps the URL inside single quotes so shell metacharacters cannot run", () => {
    const url = "https://example.com/path;reboot";
    const cmd = openBrowserCommand(url);
    expect(cmd).toContain(`'${url}'`);
    expect(cmd).not.toMatch(/echo opened https:/);
    expect(cmd).toMatch(/echo opened 'https:\/\/example.com\/path;reboot'/);
  });

  it("refuses command-substitution URLs", () => {
    expect(isSafeBrowseUrl("https://example.com/$(id)")).toBe(false);
    expect(() => openBrowserCommand("https://example.com/$(id)")).toThrow(/unsafe/);
  });
});

describe("isSafeBrowseUrl", () => {
  it("accepts ordinary http(s) links and rejects other schemes", () => {
    expect(isSafeBrowseUrl("https://status.deepseek.com/")).toBe(true);
    expect(isSafeBrowseUrl("http://127.0.0.1/")).toBe(true);
    expect(isSafeBrowseUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeBrowseUrl("file:///etc/passwd")).toBe(false);
  });
});
