import { describe, it, expect } from "vitest";
import { isAbortError, requestSignal } from "./abort.js";

describe("requestSignal", () => {
  it("aborts when the task signal aborts", async () => {
    const controller = new AbortController();
    const combined = requestSignal(30_000, controller.signal);
    expect(combined.aborted).toBe(false);
    controller.abort();
    expect(combined.aborted).toBe(true);
  });

  it("is already aborted if the task signal already is", () => {
    const controller = new AbortController();
    controller.abort();
    expect(requestSignal(30_000, controller.signal).aborted).toBe(true);
  });
});

describe("isAbortError", () => {
  it("recognizes AbortError and TimeoutError", () => {
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
    expect(isAbortError(new Error("Model API 500"))).toBe(false);
  });
});
