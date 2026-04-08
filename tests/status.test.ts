/**
 * Unit tests for status.ts — nerf_status tool handler.
 *
 * Tests use real filesystem operations with temp config files.
 * No mocking of internal modules. Tests that exercise the context-usage
 * shell-out path inject a fake analyzer via NERF_ANALYZER_PATH (same
 * pattern as tests/context.test.ts).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
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

describe("nerf_status context line — issue #15 regression", () => {
  // These tests exercise the real shell-out path through context.ts via the
  // NERF_ANALYZER_PATH env var override, then assert that handleStatus renders
  // the percent against the LOCAL nerf config's ouch — not against whatever
  // `limit`/`percent` the analyzer returned. This is the bug argus surfaced
  // immediately after #13 shipped: with lifted darts, the analyzer's percent
  // (computed against its hardcoded global default) no longer matches the
  // displayed denominator.
  let testSessionId: string;
  let tempDir: string;
  let fakeProjectDir: string;
  let transcriptPath: string;
  let originalAnalyzerPath: string | undefined;

  /**
   * Helper: write a fake analyzer script and a fake transcript so getContextUsage
   * resolves to a controlled ContextUsage value. Returns the analyzer path so
   * the caller can set NERF_ANALYZER_PATH.
   */
  function installFakeAnalyzer(analyzerJson: string): string {
    const fakeAnalyzer = join(tempDir, "fake-analyzer.sh");
    writeFileSync(
      fakeAnalyzer,
      `#!/bin/bash
analyze_context() {
  cat <<'ENDJSON'
${analyzerJson}
ENDJSON
}
`,
    );
    chmodSync(fakeAnalyzer, 0o755);

    // Fake transcript at the path findTranscript() searches.
    mkdirSync(fakeProjectDir, { recursive: true });
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 1 } },
      }) + "\n",
    );

    return fakeAnalyzer;
  }

  beforeEach(() => {
    testSessionId = `test-status-pct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    process.env.CLAUDE_SESSION_ID = testSessionId;
    tempDir = mkdtempSync(join(tmpdir(), "nerf-status-pct-"));
    // Use the unique testSessionId as part of the directory name so concurrent
    // or rapid sequential test runs cannot collide on the same path.
    fakeProjectDir = join(homedir(), ".claude", "projects", `-tmp-${testSessionId}`);
    transcriptPath = join(fakeProjectDir, `${testSessionId}.jsonl`);
    originalAnalyzerPath = process.env.NERF_ANALYZER_PATH;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    if (originalAnalyzerPath === undefined) {
      delete process.env.NERF_ANALYZER_PATH;
    } else {
      process.env.NERF_ANALYZER_PATH = originalAnalyzerPath;
    }
    try { rmSync(configPath(testSessionId), { force: true }); } catch { /* ignore */ }
    try { rmSync(`${configPath(testSessionId)}.tmp`, { force: true }); } catch { /* ignore */ }
    try { rmSync(transcriptPath, { force: true }); } catch { /* ignore */ }
    try { rmSync(fakeProjectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("percent uses local config.darts.ouch as denominator, not analyzer's stale percent", async () => {
    // argus's exact case: lifted nerf ouch to 750k, context at 366k.
    // Analyzer (oblivious to lifted darts) reports its own stale percent
    // computed against its hardcoded 200k limit: 366/200 = 183%.
    // The displayed line should ignore the analyzer's percent and compute
    // its own against the lifted ouch: 366/750 = 49%.
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 500_000, hard: 650_000, ouch: 750_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const analyzerPath = installFakeAnalyzer(`{
  "tokens": { "total": 366000 },
  "limit": 200000,
  "percent": 183.0,
  "action": "compact"
}`);
    process.env.NERF_ANALYZER_PATH = analyzerPath;

    const result = await handleStatus({});

    // Numerator + denominator come from local config (366k context vs 750k ouch)
    expect(result).toContain("Context: 366k/750k");
    // Percent must be locally computed: 366/750 ≈ 0.488 → 49%
    expect(result).toContain("(49%)");
    // Must NOT carry through the analyzer's stale percent
    expect(result).not.toContain("183");
  });

  test("percent computes against local ouch even when context is below the analyzer limit", async () => {
    // Inverse case: nerf ouch lifted to 500k, context at 80k. Analyzer's
    // percent (80/200 = 40%) and the correct percent (80/500 = 16%) differ
    // and we should display the latter.
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 300_000, hard: 400_000, ouch: 500_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const analyzerPath = installFakeAnalyzer(`{
  "tokens": { "total": 80000 },
  "limit": 200000,
  "percent": 40.0,
  "action": "none"
}`);
    process.env.NERF_ANALYZER_PATH = analyzerPath;

    const result = await handleStatus({});

    expect(result).toContain("Context: 80k/500k");
    expect(result).toContain("(16%)");
    expect(result).not.toContain("(40%)");
  });

  test("percent renders correctly when context exceeds local ouch", async () => {
    // Context above ouch should display >100% (the user is in the ouch zone).
    // Lock in this behavior so the fix doesn't accidentally cap at 100.
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const analyzerPath = installFakeAnalyzer(`{
  "tokens": { "total": 240000 },
  "limit": 200000,
  "percent": 120.0,
  "action": "compact"
}`);
    process.env.NERF_ANALYZER_PATH = analyzerPath;

    const result = await handleStatus({});

    expect(result).toContain("Context: 240k/200k");
    // 240/200 = 120% — happens to match the analyzer in this case (same
    // limit as the local config), but the assertion is on the value our
    // code computes, not the value we forwarded.
    expect(result).toContain("(120%)");
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
