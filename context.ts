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
import { log } from "./logger.ts";

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

  const start = performance.now();
  try {
    // Use find to locate the transcript — same approach as cc-context
    const result = execSync(
      `find "${PROJECTS_DIR}" -name "${sessionId}.jsonl" -type f 2>/dev/null | head -1`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    const ms = Math.round(performance.now() - start);
    const found = result.length > 0;
    log.debug("subprocess", { cmd: "find", exit_code: 0, ms, found });
    return found ? result : null;
  } catch {
    const ms = Math.round(performance.now() - start);
    log.debug("subprocess", { cmd: "find", exit_code: 1, ms, found: false });
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
  // Resolve the analyzer script path — allow override for testing
  const analyzerPath =
    process.env.NERF_ANALYZER_PATH ?? ANALYZER_PATH;

  // Verify the analyzer script exists
  if (!existsSync(analyzerPath)) {
    log.debug("subprocess", { cmd: "context-analyzer", exit_code: -1, ms: 0 }, "Analyzer script not found");
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

  // NOTE: We use Node's `execSync` here, which inherits the parent process's
  // environment by default. If we ever migrate this call to `Bun.spawnSync`
  // for performance, env inheritance behaves differently — Bun does NOT
  // automatically forward runtime mutations of `process.env` to the child,
  // so we'd need to pass `env: { ...process.env }` explicitly. Surfaced as
  // a gotcha by the cc-workflow team during a multi-agent wave; preventive
  // note for whoever touches this next.
  const analyzerStart = performance.now();
  try {
    const raw = execSync(cmd, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const ms = Math.round(performance.now() - analyzerStart);
    log.info("subprocess", { cmd: "context-analyzer", exit_code: 0, ms });

    return parseAnalyzerOutput(raw);
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - analyzerStart);
    const stderr = err instanceof Error ? err.message.slice(0, 200) : "";
    log.warn("subprocess", { cmd: "context-analyzer", exit_code: 1, ms, stderr });
    return null;
  }
}
