/**
 * context.ts — Context usage reading module
 *
 * Reads the per-session context reading that claudecode-workflow's statusline
 * persists (claudecode-workflow#1225). Claude Code hands ONLY the statusline
 * the authoritative, window-aware `context_window.remaining_percentage`; the
 * statusline writes it atomically to:
 *
 *   ${CLAUDE_CONTEXT_STATE_DIR:-~/.claude/state/context}/<session_id>.json
 *   { "session_id": "...", "remaining_percentage": 42, "ts": 1760000000 }
 *
 * The directory variable is the statusline's own, not a nerf test hook: both
 * sides resolve the same path from the same variable.
 *
 * A missing, unreadable or stale reading is reported as such — never as a
 * healthy zero. Before #32 a missing measurement returned null and every
 * consumer rendered it as "under every threshold", which hid a five-month
 * outage.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "./logger.ts";

/** A reading older than this is reported as stale rather than used. */
export const STALE_AFTER_SEC = 3600;

export type ContextReading =
  | {
      ok: true;
      /** Percent of the context window in use, 0-100. */
      usedPercent: number;
      /** Percent of the context window remaining, 0-100. */
      remainingPercent: number;
      /** Unix seconds when the statusline wrote the reading. */
      ts: number;
      /** Seconds between the reading and `now`. */
      ageSec: number;
    }
  | {
      ok: false;
      reason: "no-reading" | "unreadable" | "stale";
      /** Human-readable explanation, safe to show in nerf_status. */
      detail: string;
    };

/**
 * Directory the statusline persists readings into. Resolved at call time (not
 * module load) so HOME and CLAUDE_CONTEXT_STATE_DIR are honoured as they are
 * when the call happens. `$HOME` comes first because that is what the bash
 * writer expands; Bun's `os.homedir()` does not follow a changed HOME.
 */
export function contextStateDir(): string {
  // `||`, not `??`: like the writer's `${VAR:-default}`, an empty value means unset.
  return (
    process.env.CLAUDE_CONTEXT_STATE_DIR ||
    join(process.env.HOME || homedir(), ".claude", "state", "context")
  );
}

/** Session IDs become filenames; anything else is refused, as the writer does. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Read the persisted context reading for a session.
 *
 * `notBefore` (Unix seconds) rejects a reading written before that moment.
 * The SessionStart:compact hook passes it: right after a compaction the
 * statusline has not redrawn yet, so the newest reading on disk is the
 * pre-compaction figure, seconds old and otherwise "fresh".
 *
 * `now` is injectable for tests; production callers omit it. This function
 * NEVER throws.
 */
export function getContextReading(
  sessionId: string,
  now: number = Math.floor(Date.now() / 1000),
  notBefore?: number,
): ContextReading {
  if (!SESSION_ID_RE.test(sessionId)) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `session id "${sessionId}" is not a valid reading filename`,
    };
  }

  const path = join(contextStateDir(), `${sessionId}.json`);

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    log.debug("context", { path, found: false });
    return {
      ok: false,
      reason: "no-reading",
      detail: `no reading for this session at ${path} — the claudecode-workflow statusline writes it; is it installed and has it rendered?`,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "unreadable", detail: `${path} is not valid JSON` };
  }

  const remaining = (data as { remaining_percentage?: unknown }).remaining_percentage;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0 || remaining > 100) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `${path} has no remaining_percentage in 0-100`,
    };
  }

  // The writer always records ts; fall back to the file's mtime if a reading
  // somehow lacks it, rather than treating it as fresh.
  let ts = (data as { ts?: unknown }).ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    try {
      ts = Math.floor(statSync(path).mtimeMs / 1000);
    } catch {
      ts = 0;
    }
  }
  const tsNum = ts as number;
  const ageSec = Math.max(0, now - tsNum);

  if (notBefore !== undefined && tsNum < notBefore) {
    return {
      ok: false,
      reason: "stale",
      detail: `reading predates ${new Date(notBefore * 1000).toISOString()} (written before the last compaction); repainted on the next fresh reading or nerf call`,
    };
  }

  if (ageSec > STALE_AFTER_SEC) {
    return {
      ok: false,
      reason: "stale",
      detail: `reading stale since ${new Date(tsNum * 1000).toISOString()} (${remaining}% remaining then)`,
    };
  }

  return {
    ok: true,
    usedPercent: 100 - remaining,
    remainingPercent: remaining,
    ts: tsNum,
    ageSec,
  };
}
