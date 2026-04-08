/**
 * Unit tests for darts.ts — nerf_darts tool handler.
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
import { handleDarts } from "../darts.ts";

describe("nerf_darts", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-darts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.env.CLAUDE_SESSION_ID = testSessionId;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    const path = configPath(testSessionId);
    try { rmSync(path, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${path}.tmp`, { force: true }); } catch { /* ignore */ }
  });

  test("darts uses explicit session_id param over env var", async () => {
    const overrideId = `override-darts-${Date.now()}`;
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 50_000, hard: 75_000, ouch: 100_000 },
      session_id: overrideId,
    };
    writeConfig(overrideId, config);

    delete process.env.CLAUDE_SESSION_ID;
    const result = await handleDarts({ session_id: overrideId });

    expect(result).toContain("soft   50k   warning");
    expect(result).toContain("ouch   100k   compact or die");

    try { rmSync(configPath(overrideId), { force: true }); } catch { /* ignore */ }
  });

  test("darts returns current positions", async () => {
    const result = await handleDarts({});

    expect(result).toContain("Darts:");
    expect(result).toContain("soft   120k   warning");
    expect(result).toContain("hard   150k   crystallize");
    expect(result).toContain("ouch   200k   compact or die");
  });

  test("darts returns current positions from existing config", async () => {
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 80_000, hard: 100_000, ouch: 150_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleDarts({});

    expect(result).toContain("soft   80k   warning");
    expect(result).toContain("hard   100k   crystallize");
    expect(result).toContain("ouch   150k   compact or die");
  });

  test("darts sets valid thresholds", async () => {
    const result = await handleDarts({
      soft: 90_000,
      hard: 120_000,
      ouch: 160_000,
    });

    expect(result).toContain("soft   90k   warning");
    expect(result).toContain("hard   120k   crystallize");
    expect(result).toContain("ouch   160k   compact or die");

    // Verify config was actually written
    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(90_000);
    expect(config.darts.hard).toBe(120_000);
    expect(config.darts.ouch).toBe(160_000);
  });

  test("darts rejects bad ordering — soft >= hard", async () => {
    const result = await handleDarts({
      soft: 150_000,
      hard: 100_000,
      ouch: 200_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("soft");
    expect(result).toContain("hard");
  });

  test("darts rejects bad ordering — hard >= ouch", async () => {
    const result = await handleDarts({
      soft: 90_000,
      hard: 200_000,
      ouch: 150_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("hard");
    expect(result).toContain("ouch");
  });

  test("darts rejects bad ordering — soft == hard", async () => {
    const result = await handleDarts({
      soft: 100_000,
      hard: 100_000,
      ouch: 200_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("soft");
    expect(result).toContain("hard");
  });

  test("darts rejects negative values", async () => {
    const result = await handleDarts({
      soft: -1,
      hard: 100_000,
      ouch: 200_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("darts rejects zero values", async () => {
    const result = await handleDarts({
      soft: 0,
      hard: 100_000,
      ouch: 200_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("darts rejects partial args — only soft", async () => {
    const result = await handleDarts({ soft: 100_000 });

    expect(result).toContain("Error");
    expect(result).toContain("all three");
  });

  test("darts rejects partial args — only soft and hard", async () => {
    const result = await handleDarts({ soft: 100_000, hard: 150_000 });

    expect(result).toContain("Error");
    expect(result).toContain("all three");
  });

  test("darts rejects partial args — only ouch", async () => {
    const result = await handleDarts({ ouch: 200_000 });

    expect(result).toContain("Error");
    expect(result).toContain("all three");
  });

  test("darts rejects non-integer values", async () => {
    const result = await handleDarts({
      soft: 100_000.5,
      hard: 150_000,
      ouch: 200_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("darts preserves mode when setting thresholds", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    await handleDarts({
      soft: 90_000,
      hard: 120_000,
      ouch: 160_000,
    });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    expect(updated.darts.soft).toBe(90_000);
  });

  // Regression: #13 — MCP clients that stringify numeric tool-call args
  // (observed from a cc-workflow Claude Code session, 2026-04-08) were blocked
  // because `params.soft as number` is a TS compile-time cast with no runtime
  // coercion. The handler must coerce string-form numbers before validating.
  test("darts accepts string-valued numeric inputs and normalizes to integers", async () => {
    const result = await handleDarts({
      soft: "90000",
      hard: "120000",
      ouch: "160000",
    });

    expect(result).not.toContain("Error");
    expect(result).toContain("soft   90k   warning");
    expect(result).toContain("hard   120k   crystallize");
    expect(result).toContain("ouch   160k   compact or die");

    // Config must hold native numbers, not strings — downstream consumers
    // (crystallizer hook, statusline indicator) rely on integer math.
    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(90_000);
    expect(config.darts.hard).toBe(120_000);
    expect(config.darts.ouch).toBe(160_000);
    expect(typeof config.darts.soft).toBe("number");
    expect(typeof config.darts.hard).toBe("number");
    expect(typeof config.darts.ouch).toBe("number");
  });

  test("darts accepts a mix of string and number inputs", async () => {
    const result = await handleDarts({
      soft: "90000",
      hard: 120_000,
      ouch: "160000",
    });

    expect(result).not.toContain("Error");
    expect(result).toContain("soft   90k   warning");
    expect(result).toContain("hard   120k   crystallize");
    expect(result).toContain("ouch   160k   compact or die");
  });

  test("darts rejects non-numeric string inputs with a clear error", async () => {
    const result = await handleDarts({
      soft: "abc",
      hard: 120_000,
      ouch: 160_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("soft");
  });

  test("darts rejects suffix-notation strings like '500k' — suffix parsing is client-side", async () => {
    const result = await handleDarts({
      soft: "500k",
      hard: 650_000,
      ouch: 750_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("soft");
  });

  test("darts rejects string values that parse to non-integer floats", async () => {
    const result = await handleDarts({
      soft: "90000.5",
      hard: 120_000,
      ouch: 160_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("positive integer");
  });

  test("darts rejects string zero and negative values", async () => {
    const zero = await handleDarts({
      soft: "0",
      hard: 120_000,
      ouch: 160_000,
    });
    expect(zero).toContain("Error");
    expect(zero).toContain("positive integer");

    const neg = await handleDarts({
      soft: "-100",
      hard: 120_000,
      ouch: 160_000,
    });
    expect(neg).toContain("Error");
    expect(neg).toContain("positive integer");
  });

  test("darts treats explicit null as 'not provided' and triggers partial-args error", async () => {
    // JSON allows explicit null distinct from missing field. The handler's
    // "all or none" semantic should still apply when null appears as a
    // sentinel for absence — emit the partial-args error, not a misleading
    // "got null" type error.
    const result = await handleDarts({
      soft: null,
      hard: 120_000,
      ouch: 160_000,
    });

    expect(result).toContain("Error");
    expect(result).toContain("all three");
  });

  test("darts accepts JSON-compliant scientific notation strings", async () => {
    // Number("9e4") === 90000, Number.isInteger(90000) === true. This is a
    // permissive but predictable side effect of using `Number()` for coercion;
    // locked in via this test so a future stricter parser doesn't silently
    // regress it.
    const result = await handleDarts({
      soft: "9e4",
      hard: "1.2e5",
      ouch: "1.6e5",
    });

    expect(result).not.toContain("Error");
    expect(result).toContain("soft   90k   warning");
    expect(result).toContain("hard   120k   crystallize");
    expect(result).toContain("ouch   160k   compact or die");

    const config = readConfig(testSessionId);
    expect(config.darts.soft).toBe(90_000);
    expect(config.darts.hard).toBe(120_000);
    expect(config.darts.ouch).toBe(160_000);
  });
});
