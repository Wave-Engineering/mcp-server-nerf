/**
 * cli.ts — Subcommand dispatcher for the nerf-server binary.
 *
 * Lets the same compiled binary run as either an MCP stdio server (default,
 * no args) or as a one-shot CLI for hook integrations (`clear-indicator`,
 * `refresh-indicator`). Hook scripts in claudecode-workflow shell out to
 * these subcommands at PreCompact and SessionStart:compact to keep the
 * statusline widget aligned with the real context size across compaction
 * boundaries.
 */

import { removeIndicator } from "./statusline.ts";
import { NERF_INDICATOR_PREFIX, updateStatuslineIndicator } from "./indicator.ts";
import { resolveSessionId } from "./session.ts";
import { readConfig } from "./config.ts";

export const KNOWN_SUBCOMMANDS = [
  "clear-indicator",
  "refresh-indicator",
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
 * Resolve the active session, run the analyzer, and write a fresh indicator
 * to the statusline. Mirrors what `nerf_status` does as a side-effect, but
 * without producing any human-facing text output.
 */
export async function refreshIndicatorCommand(args: string[]): Promise<void> {
  const explicitSessionId = parseSessionIdFlag(args);
  const sessionId = resolveSessionId(explicitSessionId);
  const config = readConfig(sessionId);
  await updateStatuslineIndicator(sessionId, config);
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
    default: {
      const exhaustive: never = name;
      throw new Error(`Unhandled subcommand: ${exhaustive}`);
    }
  }
}
