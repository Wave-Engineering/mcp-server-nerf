/**
 * Tests for context.ts — reading the statusline's persisted context.
 *
 * No fake analyzer and no nerf-only path override. The reading lives where
 * claudecode-workflow's statusline writes it:
 *
 *   ${CLAUDE_CONTEXT_STATE_DIR:-~/.claude/state/context}/<session_id>.json
 *
 * "reads persisted context" exercises the DEFAULT layout (HOME pointed at a
 * temp dir, CLAUDE_CONTEXT_STATE_DIR unset), so it fails if nerf and the
 * statusline ever disagree about where the file lives. The fixture is written
 * in the exact shape the statusline's jq emits:
 *   {session_id: $s, remaining_percentage: $p, ts: $t}
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getContextReading, contextStateDir, STALE_AFTER_SEC } from "../context";

const NOW = 1_760_000_000;

function writeReading(dir: string, sessionId: string, body: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.json`), typeof body === "string" ? body : JSON.stringify(body));
}

describe("getContextReading — default layout", () => {
  let home: string;
  let originalHome: string | undefined;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "nerf-home-"));
    originalHome = process.env.HOME;
    originalStateDir = process.env.CLAUDE_CONTEXT_STATE_DIR;
    process.env.HOME = home;
    delete process.env.CLAUDE_CONTEXT_STATE_DIR;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalStateDir !== undefined) process.env.CLAUDE_CONTEXT_STATE_DIR = originalStateDir;
    rmSync(home, { recursive: true, force: true });
  });

  test("resolves to ~/.claude/state/context with no override", () => {
    expect(contextStateDir()).toBe(join(home, ".claude", "state", "context"));
  });

  test("reads persisted context", () => {
    const sid = "4f2c9a10-1b2c-4d3e-8f90-abcdef012345";
    writeReading(join(home, ".claude", "state", "context"), sid, {
      session_id: sid,
      remaining_percentage: 42,
      ts: NOW - 30,
    });

    const reading = getContextReading(sid, NOW);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.usedPercent).toBe(58);
    expect(reading.remainingPercent).toBe(42);
    expect(reading.ts).toBe(NOW - 30);
    expect(reading.ageSec).toBe(30);
  });
});

describe("getContextReading — failure modes are named, never null", () => {
  let stateDir: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "nerf-context-state-"));
    originalStateDir = process.env.CLAUDE_CONTEXT_STATE_DIR;
    process.env.CLAUDE_CONTEXT_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (originalStateDir === undefined) delete process.env.CLAUDE_CONTEXT_STATE_DIR;
    else process.env.CLAUDE_CONTEXT_STATE_DIR = originalStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("no file → no-reading, with the path in the detail", () => {
    const reading = getContextReading("no-such-session", NOW);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe("no-reading");
    expect(reading.detail).toContain(join(stateDir, "no-such-session.json"));
  });

  test("malformed JSON → unreadable", () => {
    writeReading(stateDir, "bad-json", "THIS IS NOT JSON {{{{");
    const reading = getContextReading("bad-json", NOW);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe("unreadable");
  });

  test("missing or out-of-range remaining_percentage → unreadable", () => {
    for (const [sid, remaining] of [["no-pct", undefined], ["neg-pct", -1], ["big-pct", 101], ["str-pct", "42"]] as const) {
      writeReading(stateDir, sid, { session_id: sid, remaining_percentage: remaining, ts: NOW });
      const reading = getContextReading(sid, NOW);
      expect(reading.ok).toBe(false);
      if (reading.ok) return;
      expect(reading.reason).toBe("unreadable");
    }
  });

  test("older than STALE_AFTER_SEC → stale, naming when", () => {
    writeReading(stateDir, "old", { session_id: "old", remaining_percentage: 42, ts: NOW - STALE_AFTER_SEC - 1 });
    const reading = getContextReading("old", NOW);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe("stale");
    expect(reading.detail).toContain("reading stale since");
  });

  test("exactly STALE_AFTER_SEC old is still fresh", () => {
    writeReading(stateDir, "edge", { session_id: "edge", remaining_percentage: 42, ts: NOW - STALE_AFTER_SEC });
    expect(getContextReading("edge", NOW).ok).toBe(true);
  });

  test("a session id that cannot be a filename is refused, not read", () => {
    const reading = getContextReading("../../etc/passwd", NOW);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe("unreadable");
  });

  test("notBefore: a reading written before the cutoff is stale, after it is fresh", () => {
    writeReading(stateDir, "compacted", { session_id: "compacted", remaining_percentage: 12, ts: NOW - 5 });
    const before = getContextReading("compacted", NOW, NOW - 2);
    expect(before.ok).toBe(false);
    if (before.ok) return;
    expect(before.reason).toBe("stale");
    expect(before.detail).toContain("before the last compaction");
    expect(getContextReading("compacted", NOW, NOW - 10).ok).toBe(true);
  });

  test("an empty CLAUDE_CONTEXT_STATE_DIR means unset, as in the writer's ${VAR:-default}", () => {
    process.env.CLAUDE_CONTEXT_STATE_DIR = "";
    expect(contextStateDir()).toBe(join(process.env.HOME || "", ".claude", "state", "context"));
  });

  test("boundary values 0 and 100 remaining are valid", () => {
    writeReading(stateDir, "full", { session_id: "full", remaining_percentage: 0, ts: NOW });
    writeReading(stateDir, "empty", { session_id: "empty", remaining_percentage: 100, ts: NOW });
    const full = getContextReading("full", NOW);
    const empty = getContextReading("empty", NOW);
    expect(full.ok && full.usedPercent).toBe(100);
    expect(empty.ok && empty.usedPercent).toBe(0);
  });
});
