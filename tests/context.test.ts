/**
 * Tests for context.ts — Context usage estimation module
 *
 * Testing strategy:
 *   - "returns null when no transcript" and "returns null when analyzer missing":
 *     Test real behavior with nonexistent paths/sessions.
 *   - "parses valid analyzer output": Create a temp shell script that echoes
 *     known JSON, point the function at it via NERF_ANALYZER_PATH env var.
 *   - "handles malformed output": Same approach with bad JSON.
 */

import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { getContextUsage } from "../context";

describe("getContextUsage", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment after each test
    process.env.NERF_ANALYZER_PATH = originalEnv.NERF_ANALYZER_PATH;
  });

  test("returns null when no transcript exists", async () => {
    // Use a session ID that cannot possibly exist
    const result = await getContextUsage("nonexistent-session-id-000000");
    expect(result).toBeNull();
  });

  test("returns null when analyzer script is missing", async () => {
    // Point NERF_ANALYZER_PATH at a nonexistent file
    process.env.NERF_ANALYZER_PATH = "/tmp/nonexistent-analyzer-script.sh";
    const result = await getContextUsage("any-session-id");
    expect(result).toBeNull();
  });

  test("parses valid analyzer output", async () => {
    // Create a temp directory with a fake analyzer and transcript
    const tempDir = mkdtempSync(join(tmpdir(), "nerf-test-"));
    const sessionId = "test-valid-parse-session";

    try {
      // Create a fake analyzer script that echoes known JSON
      const fakeAnalyzer = join(tempDir, "fake-analyzer.sh");
      writeFileSync(
        fakeAnalyzer,
        `#!/bin/bash
analyze_context() {
  cat <<'ENDJSON'
{
  "tokens": {
    "input": 40000,
    "cache_create": 8000,
    "cache_read": 2000,
    "output": 1500,
    "total": 50000
  },
  "limit": 200000,
  "percent": 40.0,
  "action": "none"
}
ENDJSON
}
`,
      );
      chmodSync(fakeAnalyzer, 0o755);

      // Create a fake transcript at the expected location
      const projectsDir = join(homedir(), ".claude", "projects");
      // Find an existing project slug directory to place our transcript
      // (or create a temp one under projects)
      const fakeProjectDir = join(projectsDir, "-tmp-nerf-test");
      const transcriptPath = join(fakeProjectDir, `${sessionId}.jsonl`);

      // Create the directory and transcript
      const { mkdirSync } = await import("node:fs");
      mkdirSync(fakeProjectDir, { recursive: true });
      writeFileSync(
        transcriptPath,
        JSON.stringify({
          type: "assistant",
          message: {
            model: "claude-sonnet-4-20250514",
            usage: {
              input_tokens: 40000,
              cache_creation_input_tokens: 8000,
              cache_read_input_tokens: 2000,
              output_tokens: 1500,
            },
          },
        }) + "\n",
      );

      // Point the function at our fake analyzer
      process.env.NERF_ANALYZER_PATH = fakeAnalyzer;

      const result = await getContextUsage(sessionId);

      expect(result).not.toBeNull();
      expect(result!.total).toBe(50000);
      expect(result!.limit).toBe(200000);
      expect(result!.percent).toBe(40.0);

      // Cleanup transcript and directory
      rmSync(transcriptPath, { force: true });
      rmSync(fakeProjectDir, { recursive: true, force: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("handles malformed analyzer output", async () => {
    // Create a fake analyzer that outputs invalid JSON
    const tempDir = mkdtempSync(join(tmpdir(), "nerf-test-malformed-"));
    const sessionId = "test-malformed-session";

    try {
      const fakeAnalyzer = join(tempDir, "bad-analyzer.sh");
      writeFileSync(
        fakeAnalyzer,
        `#!/bin/bash
analyze_context() {
  echo "THIS IS NOT JSON {{{{"
}
`,
      );
      chmodSync(fakeAnalyzer, 0o755);

      // Create a fake transcript so we get past the transcript-finding step
      const projectsDir = join(homedir(), ".claude", "projects");
      const fakeProjectDir = join(projectsDir, "-tmp-nerf-test-malformed");
      const transcriptPath = join(fakeProjectDir, `${sessionId}.jsonl`);

      const { mkdirSync } = await import("node:fs");
      mkdirSync(fakeProjectDir, { recursive: true });
      writeFileSync(transcriptPath, '{"type":"assistant"}\n');

      process.env.NERF_ANALYZER_PATH = fakeAnalyzer;

      const result = await getContextUsage(sessionId);
      expect(result).toBeNull();

      // Cleanup
      rmSync(transcriptPath, { force: true });
      rmSync(fakeProjectDir, { recursive: true, force: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
