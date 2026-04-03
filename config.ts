/**
 * Config I/O module for mcp-server-nerf.
 *
 * Manages the per-session nerf configuration file at /tmp/nerf-<session_id>.json.
 * The config schema matches what the crystallizer hook reads.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";

export interface NerfConfig {
  mode: "not-too-rough" | "hurt-me-plenty" | "ultraviolence";
  darts: {
    soft: number;
    hard: number;
    ouch: number;
  };
  session_id: string;
}

export const DEFAULTS: NerfConfig = {
  mode: "hurt-me-plenty",
  darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
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
    const parsed = JSON.parse(raw) as Partial<NerfConfig>;
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      darts: {
        soft: parsed.darts?.soft ?? DEFAULTS.darts.soft,
        hard: parsed.darts?.hard ?? DEFAULTS.darts.hard,
        ouch: parsed.darts?.ouch ?? DEFAULTS.darts.ouch,
      },
      session_id: parsed.session_id ?? DEFAULTS.session_id,
    };
  } catch {
    return { ...DEFAULTS, session_id: sessionId };
  }
}

/**
 * Writes the config file atomically (write to .tmp, rename).
 */
export function writeConfig(sessionId: string, config: NerfConfig): void {
  const path = configPath(sessionId);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, path);
}
