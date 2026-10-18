/**
 * Config I/O module for mcp-server-nerf.
 *
 * Manages the per-session nerf configuration file at /tmp/nerf-<session_id>.json.
 *
 * Darts are percentages of the context window USED (#32). They live under
 * `darts_pct`, not `darts`: claudecode-workflow's statusline reads `darts` as
 * absolute token counts, and percentages under that key would paint every
 * session red. A config that still carries the old absolute `darts` is
 * migrated on read: the token counts are ignored and the percentage defaults
 * apply (an absolute count cannot be converted without knowing the window).
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { log } from "./logger.ts";

export interface Darts {
  soft: number;
  hard: number;
  ouch: number;
}

export interface NerfConfig {
  mode: "not-too-rough" | "hurt-me-plenty" | "ultraviolence";
  /** Percent of the context window used, each an integer in 1-99. */
  darts_pct: Darts;
  session_id: string;
}

/** Ratios nerf_budget uses to place soft and hard below ouch. */
export const SOFT_RATIO = 0.6;
export const HARD_RATIO = 0.75;

/**
 * Default darts: nerf_budget's ratios applied to an ouch of 85% used, which is
 * where claudecode-workflow's reseed gate fires (15% remaining).
 */
export const DEFAULTS: NerfConfig = {
  mode: "hurt-me-plenty",
  darts_pct: { soft: 51, hard: 63, ouch: 85 },
  session_id: "",
};

/**
 * Maps doom-style mode names to crystallizer mode names.
 */
export const MODE_MAP: Record<string, string> = {
  "not-too-rough": "manual",
  "hurt-me-plenty": "prompt",
  ultraviolence: "yolo",
};

/**
 * Returns the config file path for a given session ID.
 */
export function configPath(sessionId: string): string {
  return `/tmp/nerf-${sessionId}.json`;
}

/**
 * Reads the config file for the given session, merging with defaults
 * for any missing keys.
 */
export function readConfig(sessionId: string): NerfConfig {
  const path = configPath(sessionId);
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NerfConfig> & { darts?: unknown };
    if (parsed.darts !== undefined && parsed.darts_pct === undefined) {
      log.info(
        "state_change",
        { what: "darts", from: parsed.darts, to: DEFAULTS.darts_pct },
        "Legacy absolute darts ignored; percentage defaults apply",
      );
    }
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      darts_pct: {
        soft: parsed.darts_pct?.soft ?? DEFAULTS.darts_pct.soft,
        hard: parsed.darts_pct?.hard ?? DEFAULTS.darts_pct.hard,
        ouch: parsed.darts_pct?.ouch ?? DEFAULTS.darts_pct.ouch,
      },
      session_id: parsed.session_id ?? DEFAULTS.session_id,
    };
  } catch {
    return { ...DEFAULTS, session_id: sessionId };
  }
}

/**
 * Writes the config file atomically (write to .tmp, rename). Only the current
 * schema is written, so a legacy `darts` key is dropped on the first write.
 */
export function writeConfig(sessionId: string, config: NerfConfig): void {
  const path = configPath(sessionId);
  const tmpPath = `${path}.tmp`;
  const out: NerfConfig = {
    mode: config.mode,
    darts_pct: config.darts_pct,
    session_id: config.session_id,
  };
  writeFileSync(tmpPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, path);
}
