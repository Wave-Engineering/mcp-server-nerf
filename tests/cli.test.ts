/**
 * Tests for cli.ts — Subcommand dispatch surface.
 *
 * Pure tests cover flag parsing and subcommand recognition. Smoke tests
 * verify the dispatch wrapper doesn't throw under common edge cases — the
 * substantive indicator-write behavior is already covered in
 * indicator.test.ts and statusline.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isSubcommand,
  parseSessionIdFlag,
  KNOWN_SUBCOMMANDS,
  runSubcommand,
  clearIndicatorCommand,
  parseIntervalFlag,
  parseNotBeforeFlag,
  renderWatchFrame,
} from "../cli.ts";
import { resolveProjectRoot } from "../statusline.ts";
import type { NerfConfig } from "../config.ts";

describe("isSubcommand", () => {
  test("returns true for known subcommands", () => {
    expect(isSubcommand("clear-indicator")).toBe(true);
    expect(isSubcommand("refresh-indicator")).toBe(true);
  });

  test("returns false for unknown strings", () => {
    expect(isSubcommand("foo")).toBe(false);
    expect(isSubcommand("")).toBe(false);
    expect(isSubcommand("clear")).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isSubcommand(undefined)).toBe(false);
  });
});

describe("parseSessionIdFlag", () => {
  test("returns undefined when flag is absent", () => {
    expect(parseSessionIdFlag([])).toBeUndefined();
    expect(parseSessionIdFlag(["foo", "bar"])).toBeUndefined();
  });

  test("returns the value following --session-id", () => {
    expect(parseSessionIdFlag(["--session-id", "abc-123"])).toBe("abc-123");
  });

  test("returns the value when other args precede --session-id", () => {
    expect(parseSessionIdFlag(["foo", "--session-id", "xyz"])).toBe("xyz");
  });

  test("returns undefined when --session-id is the last arg", () => {
    expect(parseSessionIdFlag(["--session-id"])).toBeUndefined();
  });

  test("returns the first value when --session-id appears more than once", () => {
    expect(parseSessionIdFlag(["--session-id", "a", "--session-id", "b"]))
      .toBe("a");
  });

  test("returns undefined when --session-id has an empty-string value", () => {
    // Empty session IDs are useless to resolveSessionId and break the
    // override-present-or-not contract. Treat them as absent.
    expect(parseSessionIdFlag(["--session-id", ""])).toBeUndefined();
  });
});

describe("KNOWN_SUBCOMMANDS", () => {
  test("includes the expected commands", () => {
    expect(KNOWN_SUBCOMMANDS).toContain("clear-indicator");
    expect(KNOWN_SUBCOMMANDS).toContain("refresh-indicator");
    expect(KNOWN_SUBCOMMANDS).toContain("watch");
  });
});

describe("parseNotBeforeFlag", () => {
  test("reads a numeric epoch; undefined when absent, empty or not a number", () => {
    expect(parseNotBeforeFlag(["--not-before", "1760000000"])).toBe(1760000000);
    expect(parseNotBeforeFlag(["--session-id", "x"])).toBeUndefined();
    expect(parseNotBeforeFlag(["--not-before"])).toBeUndefined();
    expect(parseNotBeforeFlag(["--not-before", ""])).toBeUndefined();
    expect(parseNotBeforeFlag(["--not-before", "soon"])).toBeUndefined();
  });
});

describe("parseIntervalFlag", () => {
  test("reads the value after --interval, undefined when absent", () => {
    expect(parseIntervalFlag(["--session-id", "x", "--interval", "2000"])).toBe("2000");
    expect(parseIntervalFlag(["--session-id", "x"])).toBeUndefined();
    expect(parseIntervalFlag(["--interval"])).toBeUndefined();
  });
});

describe("renderWatchFrame", () => {
  const config: NerfConfig = {
    mode: "hurt-me-plenty",
    darts_pct: { soft: 51, hard: 63, ouch: 85 },
    session_id: "s",
  };

  test("shows the reading, darts and level", () => {
    const frame = renderWatchFrame(
      "sess-1",
      config,
      { ok: true, usedPercent: 70, remainingPercent: 30, ts: 0, ageSec: 3 },
    );
    expect(frame).toContain("nerf scope — session sess-1");
    expect(frame).toContain("Context: 70% used (30% remaining), as of 3s ago");
    expect(frame).toContain("Darts: soft 51% · hard 63% · ouch 85%");
    expect(frame).toContain("Level: hard");
  });

  test("an unknown reading is shown as unknown with its reason", () => {
    const frame = renderWatchFrame("sess-1", config, { ok: false, reason: "no-reading", detail: "no reading for this session" });
    expect(frame).toContain("Context: unknown — no reading for this session");
    expect(frame).toContain("Level: unknown  ctx ?");
  });
});

/**
 * The smoke tests below exercise the production code paths with no agent
 * identity, which forces resolveStatuslineFile() to return null and turns the
 * indicator helpers into graceful no-ops. NERF_PROJECT_ROOT points nerf at an
 * empty temp root, so neither a developer's real `.claude/agent-identity.json`
 * nor a cached /tmp copy can make these tests write into a live statusline.
 */
describe("subcommand smoke tests (no-agent-file path)", () => {
  let root: string;
  let suiteRootBefore: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nerf-cli-root-"));
    suiteRootBefore = process.env.NERF_PROJECT_ROOT;
    process.env.NERF_PROJECT_ROOT = root;
    expect(resolveProjectRoot()).toBe(root);
  });

  afterEach(() => {
    process.env.NERF_PROJECT_ROOT = suiteRootBefore;
    rmSync(root, { recursive: true, force: true });
  });

  test("clearIndicatorCommand does not throw without an agent file", () => {
    expect(() => clearIndicatorCommand()).not.toThrow();
  });

  test("runSubcommand('clear-indicator') resolves without throwing", async () => {
    await expect(runSubcommand("clear-indicator", [])).resolves.toBeUndefined();
  });

  test("runSubcommand('refresh-indicator') resolves without throwing when no reading exists", async () => {
    // resolveSessionId may fall through to the synthetic fallback. With no
    // persisted reading the indicator would be `nerf:ctx ?`, but with no
    // agent identity file for this project root (guarded above) there is no
    // statusline file to write, so the helpers are graceful no-ops.
    await expect(runSubcommand("refresh-indicator", [])).resolves.toBeUndefined();
  });

  test("runSubcommand('refresh-indicator') accepts --not-before", async () => {
    await expect(
      runSubcommand("refresh-indicator", ["--session-id", "x-1", "--not-before", "1760000000"]),
    ).resolves.toBeUndefined();
  });

  test("runSubcommand('refresh-indicator') accepts an explicit --session-id", async () => {
    await expect(
      runSubcommand("refresh-indicator", ["--session-id", "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12)]),
    ).resolves.toBeUndefined();
  });
});
