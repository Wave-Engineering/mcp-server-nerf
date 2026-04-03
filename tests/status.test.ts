/**
 * Unit tests for status.ts — nerf_status tool handler.
 *
 * Tests use real filesystem operations with temp config files.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { configPath, writeConfig, DEFAULTS, type NerfConfig } from "../config.ts";
import { handleStatus, formatTokenCount } from "../status.ts";

describe("nerf_status", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Set env so resolveSessionId() returns our test session ID
    process.env.CLAUDE_SESSION_ID = testSessionId;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    const path = configPath(testSessionId);
    try { rmSync(path, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${path}.tmp`, { force: true }); } catch { /* ignore */ }
  });

  test("status returns formatted output with known config", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 100_000, hard: 130_000, ouch: 180_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleStatus({});

    expect(result).toContain("nerf — ultraviolence");
    expect(result).toContain("auto-crystallize");
    expect(result).toContain("Darts:");
    expect(result).toContain("soft   100k   warning");
    expect(result).toContain("hard   130k   crystallize");
    expect(result).toContain("ouch   180k   compact or die");
  });

  test("status shows defaults when no config exists", async () => {
    // No config file written — should use defaults
    const result = await handleStatus({});

    expect(result).toContain("nerf — hurt-me-plenty");
    expect(result).toContain("prompted crystallization");
    expect(result).toContain("soft   120k   warning");
    expect(result).toContain("hard   150k   crystallize");
    expect(result).toContain("ouch   200k   compact or die");
  });

  test("status includes context usage as unavailable when module missing", async () => {
    // context.ts doesn't exist yet (#223), so usage should be unavailable
    const result = await handleStatus({});

    expect(result).toContain("Context: unavailable");
  });

  test("status uses explicit session_id param over env var", async () => {
    const overrideId = `override-status-${Date.now()}`;
    // Write config to the override session, not the env session
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 50_000, hard: 75_000, ouch: 100_000 },
      session_id: overrideId,
    };
    writeConfig(overrideId, config);

    const result = await handleStatus({ session_id: overrideId });

    expect(result).toContain("nerf — ultraviolence");
    expect(result).toContain("ouch   100k   compact or die");

    // Clean up
    try { rmSync(configPath(overrideId), { force: true }); } catch { /* ignore */ }
  });

  test("status output format matches spec", async () => {
    const config: NerfConfig = {
      mode: "not-too-rough",
      darts: { soft: 80_000, hard: 100_000, ouch: 150_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleStatus({});
    const lines = result.split("\n");

    // First line: mode header
    expect(lines[0]).toMatch(/^nerf — not-too-rough \(/);
    // Empty separator line
    expect(lines[1]).toBe("");
    // Darts header
    expect(lines[2]).toBe("Darts:");
    // Dart lines
    expect(lines[3]).toContain("soft");
    expect(lines[4]).toContain("hard");
    expect(lines[5]).toContain("ouch");
    // Empty separator
    expect(lines[6]).toBe("");
    // Context line
    expect(lines[7]).toMatch(/^Context:/);
  });
});

describe("formatTokenCount", () => {
  test("formats large numbers with k suffix", () => {
    expect(formatTokenCount(120_000)).toBe("120k");
    expect(formatTokenCount(150_000)).toBe("150k");
    expect(formatTokenCount(200_000)).toBe("200k");
  });

  test("rounds to nearest k", () => {
    expect(formatTokenCount(120_500)).toBe("121k");
    expect(formatTokenCount(99_499)).toBe("99k");
    expect(formatTokenCount(1_000)).toBe("1k");
  });

  test("handles zero", () => {
    expect(formatTokenCount(0)).toBe("0k");
  });
});
