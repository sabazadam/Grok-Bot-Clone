import { describe, it, expect } from "vitest";
import { protectsComputerFromIdleStop } from "./service.js";

describe("protectsComputerFromIdleStop", () => {
  it("keeps starting desktops alive (boot can take longer than the idle sweep)", () => {
    expect(protectsComputerFromIdleStop("starting")).toBe(true);
    expect(protectsComputerFromIdleStop("working")).toBe(true);
    expect(protectsComputerFromIdleStop("waiting_approval")).toBe(true);
  });

  it("allows idle/off computers to be stopped", () => {
    expect(protectsComputerFromIdleStop("idle")).toBe(false);
    expect(protectsComputerFromIdleStop("off")).toBe(false);
    expect(protectsComputerFromIdleStop("error")).toBe(false);
  });
});
