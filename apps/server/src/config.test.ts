import { describe, it, expect } from "vitest";
import { isAllowedCorsOrigin } from "./config.js";

describe("isAllowedCorsOrigin", () => {
  it("allows missing origin, localhost, Tailscale, and LAN", () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8484")).toBe(true);
    expect(isAllowedCorsOrigin("http://100.64.1.2:5173")).toBe(true);
    expect(isAllowedCorsOrigin("https://mac-mini.tail1234.ts.net")).toBe(true);
    expect(isAllowedCorsOrigin("http://192.168.1.10:5173")).toBe(true);
  });

  it("rejects public websites", () => {
    expect(isAllowedCorsOrigin("https://evil.example")).toBe(false);
    expect(isAllowedCorsOrigin("https://google.com")).toBe(false);
    expect(isAllowedCorsOrigin("not a url")).toBe(false);
  });
});
