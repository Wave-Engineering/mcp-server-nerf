/**
 * cli.ts — Subcommand dispatcher for the nerf-server binary.
 *
 * Lets the same compiled binary run as either an MCP stdio server (default,
 * no args) or as a one-shot CLI for hook integrations (`clear-indicator`,
 * `refresh-indicator`). Hook scripts in claudecode-workflow shell out to
 * these subcommands at PreCompact and SessionStart:compact to keep the
 * statusline widget aligned with the real context size across compaction
 * boundaries. `watch` is the long-running live view nerf_scope opens in a
 * terminal.
 */

import { removeIndicator } from "./statusline.ts";
import {
  NERF_INDICATOR_PREFIX,
  computeIndicator,
  updateStatuslineIndicator,
} from "./indicator.ts";
import { resolveSessionId } from "./session.ts";
import { readConfig, type NerfConfig } from "./config.ts";
import { getContextReading, type ContextReading } from "./context.ts";
import { formatContextLine } from "./status.ts";
import { resolveInterval } from "./scope.ts";

export const KNOWN_SUBCOMMANDS = [
  "clear-indicator",
  "refresh-indicator",
  "watch",
] as const;
export type Subcommand = (typeof KNOWN_SUBCOMMANDS)[number];

export function isSubcommand(arg: string | undefined): arg is Subcommand {
  return (
    arg !== undefined &&
    (KNOWN_SUBCOMMANDS as readonly string[]).includes(arg)
  );
}

/**
 * Parse `--session-id <value>` from a flat argv tail. Returns undefined when
 * the flag is absent, has no value following it, or has an empty-string
 * value — empty session IDs are useless to downstream resolvers and would
 * cause the boundary contract (override-present-or-not) to leak across the
 * `parseSessionIdFlag` → `resolveSessionId` seam.
 */
export function parseSessionIdFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session-id" && i + 1 < args.length) {
      const value = args[i + 1];
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Remove all `nerf:`-prefixed entries from the shared statusline file.
 * Idempotent and safe to call when the statusline file does not exist.
 */
export function clearIndicatorCommand(): void {
  removeIndicator(NERF_INDICATOR_PREFIX);
}

/**
 * Parse `--not-before <unix-seconds>` from a flat argv tail. Undefined when
 * absent or not a finite number.
 */
export function parseNotBeforeFlag(args: string[]): number | undefined {
  const i = args.indexOf("--not-before");
  if (i < 0 || i + 1 >= args.length) return undefined;
  const n = Number(args[i + 1]);
  return args[i + 1] !== "" && Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve the active session, read its persisted context, and write a fresh
 * indicator to the statusline. Mirrors what `nerf_status` does as a
 * side-effect, but without producing any human-facing text output.
 *
 * `--not-before <epoch>` makes a reading written before that moment count as
 * unknown (`ctx ?`); the SessionStart:compact hook passes it so a
 * pre-compaction figure is never repainted as current.
 */
export async function refreshIndicatorCommand(args: string[]): Promise<void> {
  const explicitSessionId = parseSessionIdFlag(args);
  const sessionId = resolveSessionId(explicitSessionId);
  const config = readConfig(sessionId);
  await updateStatuslineIndicator(sessionId, config, parseNotBeforeFlag(args));
}

/**
 * Parse `--interval <ms>` from a flat argv tail. Undefined when absent.
 */
export function parseIntervalFlag(args: string[]): string | undefined {
  const i = args.indexOf("--interval");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * Render one frame of the watch view. Pure: the caller supplies the reading.
 */
export function renderWatchFrame(
  sessionId: string,
  config: NerfConfig,
  reading: ContextReading,
): string {
  const state = computeIndicator(reading, config);
  const { soft, hard, ouch } = config.darts_pct;
  return [
    `nerf scope — session ${sessionId}`,
    "",
    formatContextLine(reading),
    `Darts: soft ${soft}% · hard ${hard}% · ouch ${ouch}%`,
    `Level: ${state.level}${state.text ? `  ${state.text}` : ""}`,
    "",
    "Ctrl-C to close.",
  ].join("\n");
}

/**
 * Live view of a session's context reading against its darts, redrawn every
 * interval until interrupted. This is what nerf_scope opens in a terminal.
 */
export async function watchCommand(args: string[]): Promise<void> {
  const sessionId = resolveSessionId(parseSessionIdFlag(args));
  const intervalMs = resolveInterval(parseIntervalFlag(args));
  for (;;) {
    const frame = renderWatchFrame(sessionId, readConfig(sessionId), getContextReading(sessionId));
    process.stdout.write(`\x1b[2J\x1b[H${frame}\n`);
    await Bun.sleep(intervalMs);
  }
}

export async function runSubcommand(
  name: Subcommand,
  args: string[],
): Promise<void> {
  switch (name) {
    case "clear-indicator":
      clearIndicatorCommand();
      return;
    case "refresh-indicator":
      await refreshIndicatorCommand(args);
      return;
    case "watch":
      await watchCommand(args);
      return;
    default: {
      const exhaustive: never = name;
      throw new Error(`Unhandled subcommand: ${exhaustive}`);
    }
  }
}
