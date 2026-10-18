/**
 * Tests for indicator.ts — Statusline indicator lifecycle module
 *
 * computeIndicator(): pure function tests — no filesystem needed.
 * updateStatuslineIndicator(): integration tests — a real temp statusline file
 *   and a real persisted context reading (the format claudecode-workflow's
 *   statusline writes), read from a temp CLAUDE_CONTEXT_STATE_DIR.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeIndicator, updateStatuslineIndicator, NERF_INDICATOR_PREFIX } from "../indicator.ts";
import { resolveProjectRoot } from "../statusline.ts";
import type { ContextReading } from "../context.ts";
import type { NerfConfig } from "../config.ts";

/**
 * Build a NerfConfig with the given dart positions (percent of window used).
 */
function makeConfig(soft: number, hard: number, ouch: number): NerfConfig {
  return {
    mode: "hurt-me-plenty",
    darts_pct: { soft, hard, ouch },
    session_id: "test",
  };
}

/** A fresh, usable reading at the given percent used. */
function used(pct: number): ContextReading {
  return { ok: true, usedPercent: pct, remainingPercent: 100 - pct, ts: 0, ageSec: 0 };
}

describe("computeIndicator", () => {
  const config = makeConfig(51, 63, 85);

  test("returns none when usage is below soft dart", () => {
    const result = computeIndicator(used(40), config);
    expect(result.level).toBe("none");
    expect(result.text).toBe("");
  });

  test("returns soft level with lightning emoji at soft threshold", () => {
    const result = computeIndicator(used(51), config);
    expect(result.level).toBe("soft");
    expect(result.text).toContain("\u{26A1}");
    expect(result.text).toContain("51%");
  });

  test("returns hard level with diamond emoji at hard threshold", () => {
    const result = computeIndicator(used(63), config);
    expect(result.level).toBe("hard");
    expect(result.text).toContain("\u{1F536}");
    expect(result.text).toContain("63%");
  });

  test("returns critical level with siren emoji at ouch threshold", () => {
    const result = computeIndicator(used(85), config);
    expect(result.level).toBe("critical");
    expect(result.text).toContain("\u{1F6A8}");
    expect(result.text).toContain("85%");
  });

  test("missing source is unknown, not none", () => {
    for (const reason of ["no-reading", "unreadable", "stale"] as const) {
      const result = computeIndicator({ ok: false, reason, detail: "x" }, config);
      expect(result.level).toBe("unknown");
      expect(result.text).toBe("ctx ?");
    }
  });

  test("rounds percentage correctly", () => {
    expect(computeIndicator(used(62.4), makeConfig(50, 70, 90)).text).toContain("62%");
    expect(computeIndicator(used(62.5), makeConfig(50, 70, 90)).text).toContain("63%");
    expect(computeIndicator(used(99.7), config).text).toContain("100%");
  });
});

describe("updateStatuslineIndicator", () => {
  let stateDir: string;
  let originalStateDir: string | undefined;
  let root: string;
  let devName: string;
  let suiteRootBefore: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "nerf-indicator-state-"));
    originalStateDir = process.env.CLAUDE_CONTEXT_STATE_DIR;
    process.env.CLAUDE_CONTEXT_STATE_DIR = stateDir;

    // A temp project root with its own durable identity, so the statusline
    // helpers resolve to a test-only file and never to the developer's own.
    root = mkdtempSync(join(tmpdir(), "nerf-indicator-root-"));
    suiteRootBefore = process.env.NERF_PROJECT_ROOT;
    process.env.NERF_PROJECT_ROOT = root;
    devName = `indicator-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mkdirSync(join(root, ".claude"));
    writeFileSync(
      join(root, ".claude", "agent-identity.json"),
      JSON.stringify({ dev_name: devName, dev_avatar: "\u{1F9EA}", dev_team: "test" }),
      "utf-8",
    );
    expect(resolveProjectRoot()).toBe(root);
  });

  afterEach(() => {
    if (originalStateDir === undefined) delete process.env.CLAUDE_CONTEXT_STATE_DIR;
    else process.env.CLAUDE_CONTEXT_STATE_DIR = originalStateDir;
    process.env.NERF_PROJECT_ROOT = suiteRootBefore;
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(`/tmp/claude-statusline-${devName}.json`, { force: true });
  });

  /** Persist a reading exactly as the statusline does. */
  function persistReading(sessionId: string, remaining: number): void {
    writeFileSync(
      join(stateDir, `${sessionId}.json`),
      JSON.stringify({
        session_id: sessionId,
        remaining_percentage: remaining,
        ts: Math.floor(Date.now() / 1000),
      }),
    );
  }

  /** Read the nerf indicators from the statusline file for the test agent. */
  function nerfIndicators(): string[] {
    try {
      const statusData = JSON.parse(
        readFileSync(`/tmp/claude-statusline-${devName}.json`, "utf-8"),
      ) as { indicators?: string[] };
      return (statusData.indicators ?? []).filter((i) => i.startsWith(NERF_INDICATOR_PREFIX));
    } catch {
      return [];
    }
  }

  test("removes old nerf indicator before adding new one", async () => {
    const sessionId = `indicator-removal-test-${Date.now()}`;
    const config = makeConfig(51, 63, 85);

    persistReading(sessionId, 45); // 55% used → soft
    expect((await updateStatuslineIndicator(sessionId, config)).level).toBe("soft");
    let indicators = nerfIndicators();
    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toContain("55%");

    persistReading(sessionId, 30); // 70% used → hard
    expect((await updateStatuslineIndicator(sessionId, config)).level).toBe("hard");
    indicators = nerfIndicators();
    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toContain("70%");
  });

  test("no indicator added when below soft threshold", async () => {
    const sessionId = `indicator-healthy-test-${Date.now()}`;
    persistReading(sessionId, 80); // 20% used

    const state = await updateStatuslineIndicator(sessionId, makeConfig(51, 63, 85));
    expect(state.level).toBe("none");
    expect(nerfIndicators()).toHaveLength(0);
  });

  test("no reading shows ctx ? on the statusline, never nothing", async () => {
    const sessionId = `indicator-missing-test-${Date.now()}`;

    const state = await updateStatuslineIndicator(sessionId, makeConfig(51, 63, 85));
    expect(state.level).toBe("unknown");
    expect(nerfIndicators()).toEqual([`${NERF_INDICATOR_PREFIX}ctx ?`]);
  });
});
