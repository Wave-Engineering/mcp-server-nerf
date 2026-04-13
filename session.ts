/**
 * Session ID resolution for mcp-server-nerf.
 *
 * Resolves the Claude Code session ID from the environment, filesystem
 * artifacts, or generates a stable fallback.
 */

import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { log } from "./logger.ts";

/**
 * Resolve the session ID from the Claude Code environment.
 *
 * Strategy:
 * 1. Check CLAUDE_SESSION_ID env var (set by some Claude Code configurations)
 * 2. Scan /tmp for claude session artifacts (transcript/output files)
 * 3. Fallback: generate a stable ID from PID + process start time
 */
export function resolveSessionId(override?: string): string {
  // 0. Explicit override from tool params
  if (override) {
    log.debug("state_change", { what: "session", to: override }, "Resolved via explicit override");
    return override;
  }

  // 1. Direct env var
  const envId = process.env.CLAUDE_SESSION_ID;
  if (envId) {
    log.debug("state_change", { what: "session", to: envId }, "Resolved via CLAUDE_SESSION_ID env var");
    return envId;
  }

  // 2. Scan /tmp for session artifacts
  const scanned = scanForSessionArtifacts();
  if (scanned) {
    log.debug("state_change", { what: "session", to: scanned }, "Resolved via artifact scan");
    return scanned;
  }

  // 3. Fallback: stable ID from PID + timestamp
  const stableId = generateStableId();
  log.debug("state_change", { what: "session", to: stableId }, "Resolved via stable ID fallback");
  return stableId;
}

/**
 * Scan /tmp for Claude session artifacts and extract a session ID.
 * Looks for files matching claude-session-* or similar patterns.
 */
function scanForSessionArtifacts(): string | null {
  try {
    const entries = readdirSync("/tmp");
    // Look for nerf config files first (nerf-<session_id>.json)
    for (const entry of entries) {
      const match = entry.match(/^nerf-([a-f0-9-]+)\.json$/);
      if (match) {
        return match[1];
      }
    }
    // Look for claude session markers
    for (const entry of entries) {
      const match = entry.match(/^claude-session-([a-f0-9-]+)/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // /tmp not readable — fall through
  }
  return null;
}

/**
 * Generate a stable ID from process characteristics.
 * Uses PID and a fixed seed so the ID is deterministic within a process.
 */
function generateStableId(): string {
  const seed = `${process.pid}-${process.ppid ?? 0}`;
  return createHash("md5").update(seed).digest("hex").slice(0, 12);
}
