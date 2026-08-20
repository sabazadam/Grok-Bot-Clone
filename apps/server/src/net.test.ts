import { describe, it, expect } from "vitest";
import { isContainerSourceAddress } from "./net.js";

describe("isContainerSourceAddress", () => {
  it("flags Docker and OrbStack container ranges", () => {
    expect(isContainerSourceAddress("172.17.0.4")).toBe(true);
    expect(isContainerSourceAddress("172.18.0.2")).toBe(true);
    expect(isContainerSourceAddress("::ffff:172.17.0.4")).toBe(true);
    expect(isContainerSourceAddress("192.168.65.3")).toBe(true);
    expect(isContainerSourceAddress("192.168.205.2")).toBe(true);
    expect(isContainerSourceAddress("198.19.0.1")).toBe(true);
  });

  it("allows loopback, Tailscale, and typical LAN commanders", () => {
    expect(isContainerSourceAddress("127.0.0.1")).toBe(false);
    expect(isContainerSourceAddress("::1")).toBe(false);
    expect(isContainerSourceAddress("100.64.1.20")).toBe(false);
    expect(isContainerSourceAddress("192.168.1.40")).toBe(false);
    expect(isContainerSourceAddress("10.0.0.5")).toBe(false);
    expect(isContainerSourceAddress(undefined)).toBe(false);
  });
});
