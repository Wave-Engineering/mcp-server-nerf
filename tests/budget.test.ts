/**
 * Unit tests for budget.ts — nerf_budget tool handler.
 *
 * ouch is a percentage of the context window used (#32); soft and hard are
 * placed at 60% and 75% of it. Tests use real filesystem operations with temp
 * config files. No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import {
  configPath,
  readConfig,
  writeConfig,
  DEFAULTS,
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
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
  });

  test("budget uses explicit session_id param over env var", async () => {
    const overrideId = `override-budget-${Date.now()}`;
    delete process.env.CLAUDE_SESSION_ID;

    const result = await handleBudget({ ouch: 80, session_id: overrideId });

    expect(result).toContain("Budget set");
    expect(result).toContain("ouch   80%");
    expect(readConfig(overrideId).darts_pct.ouch).toBe(80);

    rmSync(configPath(overrideId), { force: true });
  });

  test("budget computes proportional darts", async () => {
    const result = await handleBudget({ ouch: 80 });

    // soft = floor(80 * 0.60) = 48, hard = floor(80 * 0.75) = 60
    expect(result).toContain("soft   48%");
    expect(result).toContain("hard   60%");
    expect(result).toContain("ouch   80%");
  });

  test("budget(85) reproduces the defaults", async () => {
    await handleBudget({ ouch: 85 });
    expect(readConfig(testSessionId).darts_pct).toEqual(DEFAULTS.darts_pct);
  });

  test("budget writes config", async () => {
    await handleBudget({ ouch: 90 });
    expect(readConfig(testSessionId).darts_pct).toEqual({ soft: 54, hard: 67, ouch: 90 });
  });

  test("budget uses Math.floor for values producing fractions", async () => {
    // 77 * 0.60 = 46.2 -> 46, 77 * 0.75 = 57.75 -> 57
    await handleBudget({ ouch: 77 });
    expect(readConfig(testSessionId).darts_pct).toEqual({ soft: 46, hard: 57, ouch: 77 });
  });

  test("budget rejects out-of-range values: 0, 100, negative, old token counts", async () => {
    for (const bad of [0, 100, -5, 200_000]) {
      const result = await handleBudget({ ouch: bad });
      expect(result).toContain("Error");
      expect(result).toContain("integer percentage from 1 to 99");
    }
  });

  test("budget rejects an ouch too low to place soft and hard below it", async () => {
    // 2 * 0.60 -> 1, 2 * 0.75 -> 1: soft == hard
    const result = await handleBudget({ ouch: 2 });
    expect(result).toContain("Error");
    expect(result).toContain("too low");
    // 1 * 0.60 -> 0
    expect(await handleBudget({ ouch: 1 })).toContain("too low");
  });

  test("budget rejects non-integer values", async () => {
    const result = await handleBudget({ ouch: 80.5 });
    expect(result).toContain("Error");
    expect(result).toContain("integer percentage");
  });

  test("budget rejects missing ouch parameter", async () => {
    const result = await handleBudget({});
    expect(result).toContain("Error");
    expect(result).toContain("ouch parameter is required");
  });

  test("budget preserves mode when setting thresholds", async () => {
    writeConfig(testSessionId, { ...DEFAULTS, mode: "ultraviolence", session_id: testSessionId });

    await handleBudget({ ouch: 80 });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    expect(updated.darts_pct.ouch).toBe(80);
  });

  test("budget display includes the ratio labels", async () => {
    const result = await handleBudget({ ouch: 80 });
    expect(result).toContain("60% of ouch");
    expect(result).toContain("75% of ouch");
  });

  // Regression: #13 — MCP clients may stringify numeric tool-call args.
  test("budget accepts string-valued ouch and normalizes to integer", async () => {
    const result = await handleBudget({ ouch: "80" });
    expect(result).not.toContain("Error");
    const config = readConfig(testSessionId);
    expect(config.darts_pct.ouch).toBe(80);
    expect(typeof config.darts_pct.ouch).toBe("number");
  });

  test("budget rejects non-numeric and suffix-notation strings", async () => {
    for (const bad of ["abc", "80%"]) {
      const result = await handleBudget({ ouch: bad });
      expect(result).toContain("Error");
      expect(result).toContain("ouch");
    }
  });

  test("budget rejects string values that parse to non-integer floats", async () => {
    const result = await handleBudget({ ouch: "80.5" });
    expect(result).toContain("Error");
    expect(result).toContain("integer percentage");
  });

  test("budget rejects string zero and negative values", async () => {
    for (const bad of ["0", "-80"]) {
      const result = await handleBudget({ ouch: bad });
      expect(result).toContain("Error");
      expect(result).toContain("integer percentage");
    }
  });

  test("budget treats explicit null as 'not provided' and emits the missing-param error", async () => {
    const result = await handleBudget({ ouch: null });
    expect(result).toContain("Error");
    expect(result).toContain("ouch parameter is required");
  });

  test("budget accepts JSON-compliant scientific notation strings", async () => {
    const result = await handleBudget({ ouch: "8e1" });
    expect(result).not.toContain("Error");
    expect(readConfig(testSessionId).darts_pct.ouch).toBe(80);
  });
});
