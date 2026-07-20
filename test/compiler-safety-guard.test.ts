import { describe, expect, it } from "vitest";
import { heuristicSafetyGuard } from "../src/compiler/safety-guard.js";

describe("heuristicSafetyGuard", () => {
  it("blocks 'save my whole paycheck'", () => {
    const result = heuristicSafetyGuard("save my whole paycheck every month");
    expect(result.blocked).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("blocks sweeping the entire balance", () => {
    expect(heuristicSafetyGuard("move my entire balance to savings").blocked).toBe(true);
  });

  it("blocks 100% of paycheck phrasing", () => {
    expect(heuristicSafetyGuard("save 100% of my paycheck").blocked).toBe(true);
  });

  it("does not block a reasonable percent-of-deposit request", () => {
    expect(heuristicSafetyGuard("save 10% of every paycheck").blocked).toBe(false);
  });

  it("does not block a reasonable round-up request", () => {
    expect(heuristicSafetyGuard("round up every purchase to the nearest dollar").blocked).toBe(false);
  });

  it("does not block a reasonable fixed-transfer request", () => {
    expect(heuristicSafetyGuard("save $5 every time I order coffee").blocked).toBe(false);
  });
});
