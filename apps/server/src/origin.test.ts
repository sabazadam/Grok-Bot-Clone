import { describe, it, expect } from "vitest";
import { isAllowedBrowserOrigin, isPrivateHostname } from "./origin.js";

describe("isPrivateHostname", () => {
  it("allows loopback, LAN, and Tailscale", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("::1")).toBe(true);
    expect(isPrivateHostname("192.168.1.20")).toBe(true);
    expect(isPrivateHostname("10.0.0.4")).toBe(true);
    expect(isPrivateHostname("172.16.0.2")).toBe(true);
    expect(isPrivateHostname("100.64.1.2")).toBe(true);
    expect(isPrivateHostname("mac-mini.local")).toBe(true);
  });

  it("rejects public hosts", () => {
    expect(isPrivateHostname("example.com")).toBe(false);
    expect(isPrivateHostname("8.8.8.8")).toBe(false);
    expect(isPrivateHostname("1.1.1.1")).toBe(false);
  });
});

describe("isAllowedBrowserOrigin", () => {
  it("allows missing/null Origin (native clients) and private http(s)", () => {
    expect(isAllowedBrowserOrigin(undefined)).toBe(true);
    expect(isAllowedBrowserOrigin("null")).toBe(true);
    expect(isAllowedBrowserOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedBrowserOrigin("http://100.86.12.34:8484")).toBe(true);
  });

  it("rejects public websites that could subscribe to live events", () => {
    expect(isAllowedBrowserOrigin("https://evil.example")).toBe(false);
    expect(isAllowedBrowserOrigin("https://example.com")).toBe(false);
    expect(isAllowedBrowserOrigin("not a url")).toBe(false);
  });
});
