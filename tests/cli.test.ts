/**
 * Tests for cli.ts — Subcommand dispatch surface.
 *
 * Pure tests cover flag parsing and subcommand recognition. Smoke tests
 * verify the dispatch wrapper doesn't throw under common edge cases — the
 * substantive indicator-write behavior is already covered in
 * indicator.test.ts and statusline.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  isSubcommand,
  parseSessionIdFlag,
  KNOWN_SUBCOMMANDS,
  runSubcommand,
  clearIndicatorCommand,
} from "../cli.ts";
import { resolveProjectRoot } from "../statusline.ts";

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
  test("includes both expected commands", () => {
    expect(KNOWN_SUBCOMMANDS).toContain("clear-indicator");
    expect(KNOWN_SUBCOMMANDS).toContain("refresh-indicator");
  });
});

/**
 * The smoke tests below exercise the production code paths but rely on the
 * absence of an agent identity file for THIS project root, which forces
 * resolveStatuslineFile() to return null and turns indicator helpers into
 * graceful no-ops. We guard the agent file at the start of each test and
 * restore it at the end so a developer who happens to have one cached in
 * /tmp doesn't see flaky failures.
 */
describe("subcommand smoke tests (no-agent-file path)", () => {
  let agentFile: string;
  let savedAgentContent: string | null = null;

  beforeEach(() => {
    const projectRoot = resolveProjectRoot();
    const dirHash = createHash("md5").update(projectRoot).digest("hex");
    agentFile = `/tmp/claude-agent-${dirHash}.json`;
    if (existsSync(agentFile)) {
      savedAgentContent = readFileSync(agentFile, "utf-8");
      rmSync(agentFile, { force: true });
    } else {
      savedAgentContent = null;
    }
  });

  afterEach(() => {
    if (savedAgentContent !== null) {
      writeFileSync(agentFile, savedAgentContent, "utf-8");
    }
  });

  test("clearIndicatorCommand does not throw without an agent file", () => {
    expect(() => clearIndicatorCommand()).not.toThrow();
  });

  test("runSubcommand('clear-indicator') resolves without throwing", async () => {
    await expect(runSubcommand("clear-indicator", [])).resolves.toBeUndefined();
  });

  test("runSubcommand('refresh-indicator') resolves without throwing when no transcript exists", async () => {
    // resolveSessionId may fall through to the synthetic fallback. With no
    // transcript at the resolved path, getContextUsage returns null and
    // updateStatuslineIndicator collapses to a removeIndicator-only no-op.
    await expect(runSubcommand("refresh-indicator", [])).resolves.toBeUndefined();
  });

  test("runSubcommand('refresh-indicator') accepts an explicit --session-id", async () => {
    await expect(
      runSubcommand("refresh-indicator", ["--session-id", "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12)]),
    ).resolves.toBeUndefined();
  });
});
