/**
 * Tests for indicator.ts — Statusline indicator lifecycle module
 *
 * Tests 1-6: Pure function tests for computeIndicator() — no mocking needed.
 * Tests 7-8: Integration tests for updateStatuslineIndicator() — use a real
 *   temp statusline file, fake analyzer script, and fake transcript.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { computeIndicator, updateStatuslineIndicator, NERF_INDICATOR_PREFIX } from "../indicator.ts";
import { resolveProjectRoot, addIndicatorToFile } from "../statusline.ts";
import type { NerfConfig } from "../config.ts";

/**
 * Build a NerfConfig with the given dart positions.
 */
function makeConfig(
  soft: number,
  hard: number,
  ouch: number,
): NerfConfig {
  return {
    mode: "hurt-me-plenty",
    darts: { soft, hard, ouch },
    session_id: "test",
  };
}

describe("computeIndicator", () => {
  const config = makeConfig(120_000, 150_000, 200_000);

  test("returns none when usage is below soft dart", () => {
    const usage = { total: 100_000, limit: 200_000, percent: 50.0 };
    const result = computeIndicator(usage, config);

    expect(result.level).toBe("none");
    expect(result.text).toBe("");
  });

  test("returns soft level with lightning emoji at soft threshold", () => {
    const usage = { total: 120_000, limit: 200_000, percent: 60.0 };
    const result = computeIndicator(usage, config);

    expect(result.level).toBe("soft");
    expect(result.text).toContain("\u{26A1}");
    expect(result.text).toContain("60%");
  });

  test("returns hard level with diamond emoji at hard threshold", () => {
    const usage = { total: 150_000, limit: 200_000, percent: 75.0 };
    const result = computeIndicator(usage, config);

    expect(result.level).toBe("hard");
    expect(result.text).toContain("\u{1F536}");
    expect(result.text).toContain("75%");
  });

  test("returns critical level with siren emoji at ouch threshold", () => {
    const usage = { total: 200_000, limit: 200_000, percent: 100.0 };
    const result = computeIndicator(usage, config);

    expect(result.level).toBe("critical");
    expect(result.text).toContain("\u{1F6A8}");
    expect(result.text).toContain("100%");
  });

  test("returns none when usage is null", () => {
    const result = computeIndicator(null, config);

    expect(result.level).toBe("none");
    expect(result.text).toBe("");
  });

  test("rounds percentage correctly", () => {
    // 62.4% should round to 62, 62.5% should round to 63
    const usage1 = { total: 130_000, limit: 200_000, percent: 62.4 };
    const result1 = computeIndicator(usage1, config);
    expect(result1.text).toContain("62%");

    const usage2 = { total: 130_000, limit: 200_000, percent: 62.5 };
    const result2 = computeIndicator(usage2, config);
    expect(result2.text).toContain("63%");

    // Edge case: 99.7% rounds to 100
    const usage3 = { total: 200_000, limit: 200_000, percent: 99.7 };
    const result3 = computeIndicator(usage3, config);
    expect(result3.text).toContain("100%");
  });
});

describe("updateStatuslineIndicator", () => {
  let tempDir: string;
  let fakeProjectDir: string;
  let originalEnv: Record<string, string | undefined>;
  let agentFile: string;
  let originalAgentContent: string | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nerf-indicator-test-"));
    originalEnv = {
      NERF_ANALYZER_PATH: process.env.NERF_ANALYZER_PATH,
      CLAUDE_SESSION_ID: process.env.CLAUDE_SESSION_ID,
    };

    // Set up agent identity file so statusline helpers resolve to a known path
    const projectRoot = resolveProjectRoot();
    const dirHash = createHash("md5").update(projectRoot).digest("hex");
    agentFile = `/tmp/claude-agent-${dirHash}.json`;

    // Preserve existing agent file
    try {
      originalAgentContent = readFileSync(agentFile, "utf-8");
    } catch {
      originalAgentContent = null;
    }

    // Write test agent file with a unique dev name for this test
    const testDevName = `indicator-test-${Date.now()}`;
    writeFileSync(
      agentFile,
      JSON.stringify({
        dev_name: testDevName,
        dev_avatar: "\u{1F9EA}",
        dev_team: "test",
      }),
      "utf-8",
    );
  });

  afterEach(() => {
    // Restore environment
    process.env.NERF_ANALYZER_PATH = originalEnv.NERF_ANALYZER_PATH;
    process.env.CLAUDE_SESSION_ID = originalEnv.CLAUDE_SESSION_ID;

    // Restore agent file
    if (originalAgentContent !== null) {
      writeFileSync(agentFile, originalAgentContent, "utf-8");
    } else {
      try { rmSync(agentFile, { force: true }); } catch { /* ignore */ }
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });

    // Clean up fake project dir
    if (fakeProjectDir) {
      try { rmSync(fakeProjectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // Clean up statusline file (resolve from current agent file)
    try {
      const raw = readFileSync(agentFile, "utf-8");
      const data = JSON.parse(raw) as { dev_name?: string };
      if (data.dev_name) {
        const statusFile = `/tmp/claude-statusline-${data.dev_name}.json`;
        rmSync(statusFile, { force: true });
      }
    } catch { /* ignore */ }
  });

  /**
   * Helper: create a fake analyzer script and transcript so
   * getContextUsage() returns known values.
   */
  function setupFakeAnalyzer(
    sessionId: string,
    total: number,
    limit: number,
    percent: number,
  ): void {
    const fakeAnalyzer = join(tempDir, "fake-analyzer.sh");
    writeFileSync(
      fakeAnalyzer,
      `#!/bin/bash
analyze_context() {
  cat <<'ENDJSON'
{
  "tokens": { "total": ${total} },
  "limit": ${limit},
  "percent": ${percent}
}
ENDJSON
}
`,
    );
    chmodSync(fakeAnalyzer, 0o755);
    process.env.NERF_ANALYZER_PATH = fakeAnalyzer;

    // Create a fake transcript at the expected location
    const projectsDir = join(homedir(), ".claude", "projects");
    fakeProjectDir = join(projectsDir, `-tmp-nerf-indicator-test-${Date.now()}`);
    mkdirSync(fakeProjectDir, { recursive: true });
    writeFileSync(
      join(fakeProjectDir, `${sessionId}.jsonl`),
      '{"type":"assistant"}\n',
    );

    process.env.CLAUDE_SESSION_ID = sessionId;
  }

  /**
   * Helper: read the statusline file for the current test agent.
   */
  function readStatuslineIndicators(): string[] {
    try {
      const raw = readFileSync(agentFile, "utf-8");
      const agentData = JSON.parse(raw) as { dev_name?: string };
      if (!agentData.dev_name) return [];
      const statusFile = `/tmp/claude-statusline-${agentData.dev_name}.json`;
      const statusRaw = readFileSync(statusFile, "utf-8");
      const statusData = JSON.parse(statusRaw) as { indicators?: string[] };
      return statusData.indicators ?? [];
    } catch {
      return [];
    }
  }

  test("removes old nerf indicator before adding new one", async () => {
    const sessionId = `indicator-removal-test-${Date.now()}`;
    const config = makeConfig(120_000, 150_000, 200_000);

    // Set up analyzer to return usage at soft level
    setupFakeAnalyzer(sessionId, 130_000, 200_000, 65.0);

    // First call: should add soft indicator
    const state1 = await updateStatuslineIndicator(sessionId, config);
    expect(state1.level).toBe("soft");

    let indicators = readStatuslineIndicators();
    const nerfIndicators1 = indicators.filter((i) => i.startsWith(NERF_INDICATOR_PREFIX));
    expect(nerfIndicators1).toHaveLength(1);
    expect(nerfIndicators1[0]).toContain("65%");

    // Now change analyzer output to hard level and call again
    setupFakeAnalyzer(sessionId, 160_000, 200_000, 80.0);
    const state2 = await updateStatuslineIndicator(sessionId, config);
    expect(state2.level).toBe("hard");

    indicators = readStatuslineIndicators();
    const nerfIndicators2 = indicators.filter((i) => i.startsWith(NERF_INDICATOR_PREFIX));
    // Should have exactly ONE nerf indicator (old one removed)
    expect(nerfIndicators2).toHaveLength(1);
    expect(nerfIndicators2[0]).toContain("80%");
  });

  test("no indicator added when below soft threshold", async () => {
    const sessionId = `indicator-healthy-test-${Date.now()}`;
    const config = makeConfig(120_000, 150_000, 200_000);

    // Set up analyzer to return usage below soft
    setupFakeAnalyzer(sessionId, 80_000, 200_000, 40.0);

    const state = await updateStatuslineIndicator(sessionId, config);
    expect(state.level).toBe("none");
    expect(state.text).toBe("");

    const indicators = readStatuslineIndicators();
    const nerfIndicators = indicators.filter((i) => i.startsWith(NERF_INDICATOR_PREFIX));
    expect(nerfIndicators).toHaveLength(0);
  });
});
