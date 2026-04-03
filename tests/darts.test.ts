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
});
