/**
 * Unit tests for budget.ts — nerf_budget tool handler.
 *
 * Tests use real filesystem operations with temp config files.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import {
  configPath,
  readConfig,
  writeConfig,
  DEFAULTS,
  type NerfConfig,
} from "../config.ts";
import { handleBudget } from "../budget.ts";

describe("nerf_budget", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.env.CLAUDE_SESSION_ID = testSessionId;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    const path = configPath(testSessionId);
    try { rmSync(path, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${path}.tmp`, { force: true }); } catch { /* ignore */ }
  });

  test("budget computes proportional darts", async () => {
    const result = await handleBudget({ ouch: 200_000 });

    // soft = floor(200000 * 0.60) = 120000
    // hard = floor(200000 * 0.75) = 150000
    expect(result).toContain("Budget set:");
    expect(result).toContain("soft   120k");
    expect(result).toContain("hard   150k");
    expect(result).toContain("ouch   200k");
  });

  test("budget writes config", async () => {
    await handleBudget({ ouch: 200_000 });

    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(120_000);
    expect(config.darts.hard).toBe(150_000);
    expect(config.darts.ouch).toBe(200_000);
  });

  test("budget uses Math.floor for non-round values", async () => {
    // 170_000 * 0.60 = 102_000 (exact)
    // 170_000 * 0.75 = 127_500 → floor = 127_500 (exact)
    await handleBudget({ ouch: 170_000 });

    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(102_000);
    expect(config.darts.hard).toBe(127_500);
    expect(config.darts.ouch).toBe(170_000);
  });

  test("budget uses Math.floor for values producing fractions", async () => {
    // 133_333 * 0.60 = 79_999.8 → floor = 79_999
    // 133_333 * 0.75 = 99_999.75 → floor = 99_999
    await handleBudget({ ouch: 133_333 });

    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(79_999);
    expect(config.darts.hard).toBe(99_999);
    expect(config.darts.ouch).toBe(133_333);
  });

  test("budget rejects zero", async () => {
    const result = await handleBudget({ ouch: 0 });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("budget rejects negative values", async () => {
    const result = await handleBudget({ ouch: -100_000 });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("budget rejects non-integer values", async () => {
    const result = await handleBudget({ ouch: 200_000.5 });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("budget rejects missing ouch parameter", async () => {
    const result = await handleBudget({});

    expect(result).toContain("Error");
    expect(result).toContain("ouch");
  });

  test("budget preserves mode when setting thresholds", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    await handleBudget({ ouch: 180_000 });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    // Darts should be updated proportionally
    expect(updated.darts.soft).toBe(Math.floor(180_000 * 0.60));
    expect(updated.darts.hard).toBe(Math.floor(180_000 * 0.75));
    expect(updated.darts.ouch).toBe(180_000);
  });

  test("budget display includes percentage labels", async () => {
    const result = await handleBudget({ ouch: 200_000 });

    expect(result).toContain("60%");
    expect(result).toContain("75%");
  });
});
