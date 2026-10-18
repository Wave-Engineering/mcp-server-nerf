/**
 * Unit tests for darts.ts — nerf_darts tool handler.
 *
 * Darts are percentages of the context window used (#32), integers in 1-99.
 * Tests use real filesystem operations with temp config files.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configPath,
  readConfig,
  writeConfig,
  type NerfConfig,
} from "../config.ts";
import { handleDarts } from "../darts.ts";
import { computeIndicator } from "../indicator.ts";
import { getContextReading } from "../context.ts";

describe("nerf_darts", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-darts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.env.CLAUDE_SESSION_ID = testSessionId;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    const path = configPath(testSessionId);
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
  });

  test("darts uses explicit session_id param over env var", async () => {
    const overrideId = `override-darts-${Date.now()}`;
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts_pct: { soft: 30, hard: 45, ouch: 60 },
      session_id: overrideId,
    };
    writeConfig(overrideId, config);

    delete process.env.CLAUDE_SESSION_ID;
    const result = await handleDarts({ session_id: overrideId });

    expect(result).toContain("soft   30%   warning");
    expect(result).toContain("ouch   60%   compact or die");

    rmSync(configPath(overrideId), { force: true });
  });

  test("darts returns current positions (defaults)", async () => {
    const result = await handleDarts({});

    expect(result).toContain("Darts (percent of context window used):");
    expect(result).toContain("soft   51%   warning");
    expect(result).toContain("hard   63%   crystallize");
    expect(result).toContain("ouch   85%   compact or die");
  });

  test("darts sets valid thresholds", async () => {
    const result = await handleDarts({ soft: 40, hard: 60, ouch: 80 });

    expect(result).toContain("soft   40%   warning");
    expect(result).toContain("hard   60%   crystallize");
    expect(result).toContain("ouch   80%   compact or die");

    const config = readConfig(testSessionId);
    expect(config.darts_pct).toEqual({ soft: 40, hard: 60, ouch: 80 });
  });

  test("darts rejects bad ordering — soft >= hard", async () => {
    const result = await handleDarts({ soft: 70, hard: 60, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("soft (70%) must be less than hard (60%)");
  });

  test("darts rejects bad ordering — hard >= ouch", async () => {
    const result = await handleDarts({ soft: 40, hard: 90, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("hard (90%) must be less than ouch (80%)");
  });

  test("darts rejects bad ordering — soft == hard", async () => {
    const result = await handleDarts({ soft: 60, hard: 60, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("soft");
  });

  test("darts rejects out-of-range values: 0, 100, negative, old token counts", async () => {
    for (const bad of [0, 100, -1, 120_000]) {
      const result = await handleDarts({ soft: bad, hard: 60, ouch: 80 });
      expect(result).toContain("Error");
      expect(result).toContain("integer percentage from 1 to 99");
    }
  });

  test("darts rejects partial args", async () => {
    for (const partial of [{ soft: 40 }, { soft: 40, hard: 60 }, { ouch: 80 }]) {
      const result = await handleDarts(partial);
      expect(result).toContain("Error");
      expect(result).toContain("all three");
    }
  });

  test("darts rejects non-integer values", async () => {
    const result = await handleDarts({ soft: 40.5, hard: 60, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("integer percentage");
  });

  test("darts preserves mode when setting thresholds", async () => {
    writeConfig(testSessionId, {
      mode: "ultraviolence",
      darts_pct: { soft: 51, hard: 63, ouch: 85 },
      session_id: testSessionId,
    });

    await handleDarts({ soft: 40, hard: 60, ouch: 80 });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    expect(updated.darts_pct.soft).toBe(40);
  });

  // Regression: #13 — MCP clients that stringify numeric tool-call args
  // (observed from a cc-workflow Claude Code session, 2026-04-08) were blocked
  // because `params.soft as number` is a TS compile-time cast with no runtime
  // coercion. The handler must coerce string-form numbers before validating.
  test("darts accepts string-valued numeric inputs and normalizes to integers", async () => {
    const result = await handleDarts({ soft: "40", hard: "60", ouch: "80" });

    expect(result).not.toContain("Error");
    expect(result).toContain("soft   40%   warning");

    // Config must hold native numbers, not strings — downstream consumers
    // (the statusline indicator) rely on numeric comparison.
    const config = readConfig(testSessionId);
    expect(config.darts_pct).toEqual({ soft: 40, hard: 60, ouch: 80 });
    expect(typeof config.darts_pct.soft).toBe("number");
  });

  test("darts accepts a mix of string and number inputs", async () => {
    const result = await handleDarts({ soft: "40", hard: 60, ouch: "80" });
    expect(result).not.toContain("Error");
    expect(result).toContain("hard   60%   crystallize");
  });

  test("darts rejects non-numeric and suffix-notation strings", async () => {
    for (const bad of ["abc", "50%"]) {
      const result = await handleDarts({ soft: bad, hard: 60, ouch: 80 });
      expect(result).toContain("Error");
      expect(result).toContain("soft");
    }
  });

  test("darts rejects string values that parse to non-integer floats", async () => {
    const result = await handleDarts({ soft: "40.5", hard: 60, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("integer percentage");
  });

  test("darts rejects string zero and negative values", async () => {
    for (const bad of ["0", "-10"]) {
      const result = await handleDarts({ soft: bad, hard: 60, ouch: 80 });
      expect(result).toContain("Error");
      expect(result).toContain("integer percentage");
    }
  });

  test("darts treats explicit null as 'not provided' and triggers partial-args error", async () => {
    const result = await handleDarts({ soft: null, hard: 60, ouch: 80 });
    expect(result).toContain("Error");
    expect(result).toContain("all three");
  });

  test("darts accepts JSON-compliant scientific notation strings", async () => {
    // Number("4e1") === 40. A permissive but predictable side effect of using
    // `Number()` for coercion; locked in so a stricter parser doesn't silently
    // regress it.
    const result = await handleDarts({ soft: "4e1", hard: "6e1", ouch: "8e1" });
    expect(result).not.toContain("Error");
    expect(readConfig(testSessionId).darts_pct).toEqual({ soft: 40, hard: 60, ouch: 80 });
  });
});

/**
 * Percentage darts are correct on any window. The same session state — 70% of
 * the window used — must land in the same zone whether the window is 200k
 * tokens (140k used) or 1M (700k used). The persisted reading carries only
 * the window-aware percentage, which is exactly why darts are percentages.
 */
describe("percentage darts", () => {
  let stateDir: string;
  let original: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "nerf-darts-window-"));
    original = process.env.CLAUDE_CONTEXT_STATE_DIR;
    process.env.CLAUDE_CONTEXT_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONTEXT_STATE_DIR;
    else process.env.CLAUDE_CONTEXT_STATE_DIR = original;
    rmSync(stateDir, { recursive: true, force: true });
  });

  const config: NerfConfig = {
    mode: "hurt-me-plenty",
    darts_pct: { soft: 51, hard: 63, ouch: 85 },
    session_id: "window",
  };

  for (const { window, usedTokens } of [
    { window: 200_000, usedTokens: 140_000 },
    { window: 1_000_000, usedTokens: 700_000 },
  ]) {
    test(`thresholds evaluated as percent-of-window on a ${window / 1000}k window`, () => {
      const sid = `window-${window}`;
      const remaining = 100 - (usedTokens / window) * 100;
      writeFileSync(
        join(stateDir, `${sid}.json`),
        JSON.stringify({ session_id: sid, remaining_percentage: remaining, ts: Math.floor(Date.now() / 1000) }),
      );

      const state = computeIndicator(getContextReading(sid), config);
      expect(state.level).toBe("hard");
      expect(state.text).toContain("70%");
    });
  }

  test("a 1M session at 20% used is healthy (the old 200k token ouch called it critical)", () => {
    // Documents the bug #32 fixes: under the old absolute darts (ouch 200k
    // tokens), a 1M session with 200k tokens used was already "compact or die".
    const sid = "window-1m-20pct";
    writeFileSync(
      join(stateDir, `${sid}.json`),
      JSON.stringify({ session_id: sid, remaining_percentage: 80, ts: Math.floor(Date.now() / 1000) }),
    );
    expect(computeIndicator(getContextReading(sid), config).level).toBe("none");
  });
});
