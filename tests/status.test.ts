/**
 * Unit tests for status.ts — nerf_status tool handler.
 *
 * Tests use real filesystem operations with temp config files and a temp
 * CLAUDE_CONTEXT_STATE_DIR holding readings in the statusline's persisted
 * format. No mocking of internal modules.
 *
 * The old #15 regression (analyzer percent vs local ouch denominator) is gone
 * with the analyzer: the reading is the harness's own window-aware percentage,
 * and darts are percentages of the same window.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configPath, writeConfig, type NerfConfig } from "../config.ts";
import { handleStatus, formatAge, formatContextLine } from "../status.ts";

describe("nerf_status", () => {
  let testSessionId: string;
  let stateDir: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    testSessionId = `test-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.env.CLAUDE_SESSION_ID = testSessionId;
    stateDir = mkdtempSync(join(tmpdir(), "nerf-status-state-"));
    originalStateDir = process.env.CLAUDE_CONTEXT_STATE_DIR;
    process.env.CLAUDE_CONTEXT_STATE_DIR = stateDir;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    if (originalStateDir === undefined) delete process.env.CLAUDE_CONTEXT_STATE_DIR;
    else process.env.CLAUDE_CONTEXT_STATE_DIR = originalStateDir;
    rmSync(stateDir, { recursive: true, force: true });
    const path = configPath(testSessionId);
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
  });

  function persistReading(sessionId: string, remaining: number, ageSec = 0): void {
    writeFileSync(
      join(stateDir, `${sessionId}.json`),
      JSON.stringify({
        session_id: sessionId,
        remaining_percentage: remaining,
        ts: Math.floor(Date.now() / 1000) - ageSec,
      }),
    );
  }

  test("status returns formatted output with known config", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts_pct: { soft: 40, hard: 55, ouch: 70 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleStatus({});

    expect(result).toContain("nerf — ultraviolence");
    expect(result).toContain("reseed automatically at the ouch dart");
    expect(result.toLowerCase()).not.toContain("crystalliz");
    expect(result).toContain("soft   40%   warning");
    expect(result).toContain("hard   55%   reseed soon");
    expect(result).toContain("ouch   70%   reseed gate fires");
  });

  test("status shows defaults when no config exists", async () => {
    const result = await handleStatus({});

    expect(result).toContain("nerf — ultraviolence");
    expect(result).toContain("soft   51%   warning");
    expect(result).toContain("hard   63%   reseed soon");
    expect(result).toContain("ouch   85%   reseed gate fires");
  });

  test("status shows a real reading in percent used and remaining", async () => {
    persistReading(testSessionId, 42);

    const result = await handleStatus({});

    expect(result).toContain("Context: 58% used (42% remaining), as of");
  });

  test("status says why when there is no reading — never a number", async () => {
    const result = await handleStatus({});

    expect(result).toContain("Context: unknown — no reading for this session");
    expect(result).toContain(join(stateDir, `${testSessionId}.json`));
  });

  test("status says why when the reading is stale", async () => {
    persistReading(testSessionId, 42, 7200);

    const result = await handleStatus({});

    expect(result).toContain("Context: unknown — reading stale since");
  });

  test("status uses explicit session_id param over env var", async () => {
    const overrideId = `override-status-${Date.now()}`;
    writeConfig(overrideId, {
      mode: "ultraviolence",
      darts_pct: { soft: 30, hard: 45, ouch: 60 },
      session_id: overrideId,
    });
    persistReading(overrideId, 90);

    const result = await handleStatus({ session_id: overrideId });

    expect(result).toContain("nerf — ultraviolence");
    expect(result).toContain("ouch   60%   reseed gate fires");
    expect(result).toContain("Context: 10% used");

    rmSync(configPath(overrideId), { force: true });
  });

  test("status output format matches spec", async () => {
    writeConfig(testSessionId, {
      mode: "not-too-rough",
      darts_pct: { soft: 40, hard: 55, ouch: 70 },
      session_id: testSessionId,
    });

    const lines = (await handleStatus({})).split("\n");

    expect(lines[0]).toMatch(/^nerf — not-too-rough \(/);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Darts (percent of context window used):");
    expect(lines[3]).toContain("soft");
    expect(lines[4]).toContain("hard");
    expect(lines[5]).toContain("ouch");
    expect(lines[6]).toBe("");
    expect(lines[7]).toMatch(/^Context:/);
  });
});

describe("formatContextLine", () => {
  test("rounds used and remaining", () => {
    expect(
      formatContextLine({ ok: true, usedPercent: 57.6, remainingPercent: 42.4, ts: 0, ageSec: 5 }),
    ).toBe("Context: 58% used (42% remaining), as of 5s ago");
  });

  test("passes the failure detail through", () => {
    expect(formatContextLine({ ok: false, reason: "unreadable", detail: "bad json" })).toBe(
      "Context: unknown — bad json",
    );
  });
});

describe("formatAge", () => {
  test("seconds, minutes, hours", () => {
    expect(formatAge(0)).toBe("0s");
    expect(formatAge(59)).toBe("59s");
    expect(formatAge(60)).toBe("1m");
    expect(formatAge(3599)).toBe("59m");
    expect(formatAge(3600)).toBe("1h");
  });
});
