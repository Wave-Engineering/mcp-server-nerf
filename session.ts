/**
 * Session ID resolution for mcp-server-nerf.
 *
 * Resolves the Claude Code session ID from the environment, the project
 * transcript directory, or generates a fallback identifier of last resort.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { log } from "./logger.ts";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * UUID-shaped basename (case-insensitive). Claude Code transcript filenames
 * are lowercase v4 UUIDs in current builds, but the `i` flag costs nothing
 * and protects against a hypothetical future generator that uses uppercase.
 */
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the session ID from the Claude Code environment.
 *
 * Strategy, in order:
 * 1. Explicit `override` from tool params.
 * 2. `CLAUDE_SESSION_ID` env var (set by some Claude Code configurations).
 * 3. Most-recently-modified transcript in this project's transcript dir.
 *    Claude Code writes per-project transcripts at
 *      ~/.claude/projects/<slug>/<session_uuid>.jsonl
 *    where <slug> = process.cwd() with `/` replaced by `-`. Scoping to the
 *    calling CC's own project dir disambiguates correctly when the user has
 *    multiple concurrent CC sessions in different projects.
 * 4. Fallback: stable ID from `md5(pid-ppid)`. Logged at `warn` level so the
 *    fleet sees this gap if it fires.
 *
 * Returns the resolved session ID. Never throws.
 *
 * `projectsDir` and `cwd` are exposed for testability; production callers pass
 * neither and get the real Claude Code paths.
 */
export function resolveSessionId(
  override?: string,
  projectsDir: string = PROJECTS_DIR,
  cwd: string = process.cwd(),
): string {
  if (override) {
    log.debug("state_change", { what: "session", to: override }, "Resolved via explicit override");
    return override;
  }

  const envId = process.env.CLAUDE_SESSION_ID;
  if (envId) {
    log.debug("state_change", { what: "session", to: envId }, "Resolved via CLAUDE_SESSION_ID env var");
    return envId;
  }

  const fromTranscripts = resolveFromTranscripts(projectsDir, cwd);
  if (fromTranscripts) {
    log.debug("state_change", { what: "session", to: fromTranscripts }, "Resolved via newest transcript");
    return fromTranscripts;
  }

  const stableId = generateStableId();
  log.warn(
    "session_resolution",
    { cause: "fallback_used", to: stableId },
    "Resolved via md5(pid-ppid) fallback — no transcript found in project's transcript dir",
  );
  return stableId;
}

/**
 * Derive the per-project transcript directory name from a project root.
 * Claude Code uses the absolute path with `/` replaced by `-`.
 *
 *   /home/bakerb/sandbox/github/foo  →  -home-bakerb-sandbox-github-foo
 *
 * Exported for testing.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/**
 * Find the newest UUID-named `.jsonl` transcript in this project's transcript
 * directory. Scans only `<projectsDir>/<slug>/`, where `slug` is derived from
 * `cwd` (defaults to `process.cwd()`).
 *
 * Returns the basename (without `.jsonl`) of the newest match, or null when
 * the directory is missing/empty/unreadable. Exported for testing.
 */
export function resolveFromTranscripts(
  projectsDir: string = PROJECTS_DIR,
  cwd: string = process.cwd(),
): string | null {
  const slug = projectSlug(cwd);
  const projectDir = join(projectsDir, slug);

  if (!existsSync(projectDir)) {
    return null;
  }

  let newest: { sessionId: string; mtimeMs: number } | null = null;

  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch (err) {
    // Directory existed (existsSync passed) but was unreadable — permissions,
    // symlink loop, FS error. Log so an operator diagnosing a fallback can
    // see the actual cause, not just "no transcript found."
    log.debug(
      "session_resolution",
      { projectDir, err: String(err) },
      "readdirSync failed on existing project dir",
    );
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const sessionId = entry.slice(0, -".jsonl".length);
    if (!SESSION_UUID_RE.test(sessionId)) continue;
    try {
      const mtimeMs = statSync(join(projectDir, entry)).mtimeMs;
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { sessionId, mtimeMs };
      }
    } catch {
      // Unreadable file — skip silently
    }
  }

  return newest?.sessionId ?? null;
}

/**
 * Generate a stable ID from process characteristics. Last-resort fallback —
 * never collides with the UUID shape used by real Claude Code sessions, so
 * this ID cannot be confused for a transcript-derived one downstream.
 */
function generateStableId(): string {
  const seed = `${process.pid}-${process.ppid ?? 0}`;
  return createHash("md5").update(seed).digest("hex").slice(0, 12);
}
