import { describe, it, expect } from "vitest";
import { inferBrowseUrl, inferBrowseUrls, inferWeatherPlace, openBrowserCommand } from "./browse.js";

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

  it("does not treat local search or debugging as a web search", () => {
    expect(inferBrowseUrl("search my workspace notes for the Q3 brief")).toBeUndefined();
    expect(inferBrowseUrl("find out why the last run failed")).toBeUndefined();
    expect(inferBrowseUrl("look up the agent named Scout")).toBeUndefined();
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

  it("refuses non-http URLs", () => {
    expect(openBrowserCommand("javascript:alert(1)")).toBeUndefined();
    expect(openBrowserCommand("file:///etc/passwd")).toBeUndefined();
  });
});
