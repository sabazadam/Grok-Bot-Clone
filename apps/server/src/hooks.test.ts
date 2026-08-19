import { describe, it, expect } from "vitest";
import { tokenMatches } from "./routes.js";

describe("git webhook token auth (tokenMatches)", () => {
  it("accepts an exact match", () => {
    expect(tokenMatches("s3cr3t", "s3cr3t")).toBe(true);
  });
  it("rejects wrong / missing / empty tokens", () => {
    expect(tokenMatches("nope", "s3cr3t")).toBe(false);
    expect(tokenMatches(undefined, "s3cr3t")).toBe(false);
    expect(tokenMatches("s3cr3t", "")).toBe(false);
    expect(tokenMatches("", "s3cr3t")).toBe(false);
  });
  it("rejects a token of different length (no partial match)", () => {
    expect(tokenMatches("s3cr3t-longer", "s3cr3t")).toBe(false);
  });
});
