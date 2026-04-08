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

  test("budget uses explicit session_id param over env var", async () => {
    const overrideId = `override-budget-${Date.now()}`;
    delete process.env.CLAUDE_SESSION_ID;

    const result = await handleBudget({ ouch: 100_000, session_id: overrideId });

    expect(result).toContain("Budget set:");
    expect(result).toContain("ouch   100k");

    // Verify config was written to override session
    const config = readConfig(overrideId);
    expect(config.darts.ouch).toBe(100_000);

    try { rmSync(configPath(overrideId), { force: true }); } catch { /* ignore */ }
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

  // Regression: #13 — same root cause as darts handler. TS compile-time cast
  // at `budget.ts:25` does not coerce string JSON values, so stringified
  // numeric inputs were rejected with a misleading error.
  test("budget accepts string-valued ouch and normalizes to integer", async () => {
    const result = await handleBudget({ ouch: "200000" });

    expect(result).not.toContain("Error");
    expect(result).toContain("Budget set:");
    expect(result).toContain("soft   120k");
    expect(result).toContain("hard   150k");
    expect(result).toContain("ouch   200k");

    const config = readConfig(testSessionId);
    expect(config.darts.ouch).toBe(200_000);
    expect(config.darts.soft).toBe(120_000);
    expect(config.darts.hard).toBe(150_000);
    expect(typeof config.darts.ouch).toBe("number");
    expect(typeof config.darts.soft).toBe("number");
    expect(typeof config.darts.hard).toBe("number");
  });

  test("budget rejects non-numeric string ouch with clear error", async () => {
    const result = await handleBudget({ ouch: "abc" });

    expect(result).toContain("Error");
    expect(result).toContain("ouch");
  });

  test("budget rejects suffix-notation strings like '200k'", async () => {
    const result = await handleBudget({ ouch: "200k" });

    expect(result).toContain("Error");
    expect(result).toContain("ouch");
  });

  test("budget rejects string values that parse to non-integer floats", async () => {
    const result = await handleBudget({ ouch: "200000.5" });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("budget rejects string zero and negative values", async () => {
    const zero = await handleBudget({ ouch: "0" });
    expect(zero).toContain("Error");
    expect(zero).toContain("positive integer");

    const neg = await handleBudget({ ouch: "-100000" });
    expect(neg).toContain("Error");
    expect(neg).toContain("positive integer");
  });

  test("budget treats explicit null as 'not provided' and emits the missing-param error", async () => {
    // Same null-as-undefined treatment as darts. The "ouch is required" error
    // should fire instead of a "got null" type-violation message.
    const result = await handleBudget({ ouch: null });

    expect(result).toContain("Error");
    expect(result).toContain("ouch");
    expect(result).toContain("required");
  });

  test("budget accepts JSON-compliant scientific notation strings", async () => {
    // Number("2e5") === 200000, passes the existing isInteger check.
    // Locked in via test so a future stricter parser cannot silently regress it.
    const result = await handleBudget({ ouch: "2e5" });

    expect(result).not.toContain("Error");
    expect(result).toContain("Budget set:");
    expect(result).toContain("ouch   200k");

    const config = readConfig(testSessionId);
    expect(config.darts.ouch).toBe(200_000);
  });
});
