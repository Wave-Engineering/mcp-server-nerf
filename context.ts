/**
 * context.ts — Context usage estimation module
 *
 * Shells out to context-analyzer.sh to estimate token usage for a Claude Code
 * session. Returns { total, limit, percent } or null on any error.
 *
 * This module is standalone — consumed by nerf_status but not wired into
 * index.ts directly.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ContextUsage {
  total: number;
  limit: number;
  percent: number;
}

/** Path to the context-analyzer.sh script. */
const ANALYZER_PATH = join(
  homedir(),
  ".claude",
  "context-crystallizer",
  "lib",
  "context-analyzer.sh",
);

/** Directory containing Claude Code project transcript files. */
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Locate the transcript JSONL file for a given session ID.
 *
 * Claude Code stores transcripts as `<session_id>.jsonl` under
 * `~/.claude/projects/<project-slug>/`. We search all project directories
 * for a matching file.
 *
 * Returns the absolute path or null if not found.
 */
function findTranscript(sessionId: string): string | null {
  if (!existsSync(PROJECTS_DIR)) {
    return null;
  }

  try {
    // Use find to locate the transcript — same approach as cc-context
    const result = execSync(
      `find "${PROJECTS_DIR}" -name "${sessionId}.jsonl" -type f 2>/dev/null | head -1`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Parse the JSON output from context-analyzer.sh into a ContextUsage.
 *
 * The analyzer returns nested JSON:
 *   { tokens: { total: N }, limit: N, percent: N }
 *
 * We map tokens.total -> total.
 */
function parseAnalyzerOutput(raw: string): ContextUsage | null {
  try {
    const data = JSON.parse(raw);

    // Reject error responses from the analyzer
    if (data.error) {
      return null;
    }

    const total = data?.tokens?.total;
    const limit = data?.limit;
    const percent = data?.percent;

    if (typeof total !== "number" || typeof limit !== "number" || typeof percent !== "number") {
      return null;
    }

    return { total, limit, percent };
  } catch {
    return null;
  }
}

/**
 * Estimate context usage for a Claude Code session.
 *
 * Shells out to context-analyzer.sh with the session's transcript path.
 * Returns { total, limit, percent } on success, or null if estimation is
 * unavailable for any reason (missing transcript, missing analyzer, parse
 * error, etc.).
 *
 * This function NEVER throws.
 */
export async function getContextUsage(
  sessionId: string,
): Promise<ContextUsage | null> {
  try {
    // Resolve the analyzer script path — allow override for testing
    const analyzerPath =
      process.env.NERF_ANALYZER_PATH ?? ANALYZER_PATH;

    // Verify the analyzer script exists
    if (!existsSync(analyzerPath)) {
      return null;
    }

    // Find the transcript for this session
    const transcript = findTranscript(sessionId);
    if (!transcript) {
      return null;
    }

    // Shell out to the analyzer
    // The analyzer is a bash library — source it and call analyze_context
    const cmd = `bash -c 'source "${analyzerPath}" && analyze_context "${transcript}"'`;

    const raw = execSync(cmd, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return parseAnalyzerOutput(raw);
  } catch {
    return null;
  }
}
