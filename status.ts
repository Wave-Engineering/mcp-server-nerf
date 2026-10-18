/**
 * nerf_status tool handler.
 *
 * Returns formatted display of current mode, dart thresholds, and context usage.
 * Updates statusline indicator based on context level.
 */

import { readConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { getContextReading, type ContextReading } from "./context.ts";
import { updateStatuslineIndicator } from "./indicator.ts";

/**
 * Mode descriptions for display.
 */
const MODE_DESCRIPTIONS: Record<string, string> = {
  "not-too-rough": "manual crystallization — you decide when to save state",
  "hurt-me-plenty": "prompted crystallization — reminders at thresholds",
  ultraviolence: "auto-crystallize — yolo mode, saves state automatically",
};

/**
 * Format a reading's age for display: "12s", "4m", "1h".
 */
export function formatAge(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  return `${Math.floor(ageSec / 3600)}h`;
}

/**
 * Format the context line. A missing or stale reading says why; it is never
 * rendered as a number.
 */
export function formatContextLine(reading: ContextReading): string {
  if (!reading.ok) {
    return `Context: unknown — ${reading.detail}`;
  }
  const used = Math.round(reading.usedPercent);
  const remaining = Math.round(reading.remainingPercent);
  return `Context: ${used}% used (${remaining}% remaining), as of ${formatAge(reading.ageSec)} ago`;
}

/**
 * Handle the nerf_status tool call.
 */
export async function handleStatus(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const config = readConfig(sessionId);
  const modeName = config.mode;
  const modeDescription =
    MODE_DESCRIPTIONS[modeName] ?? "unknown mode";

  const reading = getContextReading(sessionId);

  // Update statusline indicator (side-effect)
  await updateStatuslineIndicator(sessionId, config);

  const { soft, hard, ouch } = config.darts_pct;

  return [
    `nerf — ${modeName} (${modeDescription})`,
    "",
    "Darts (percent of context window used):",
    `  soft   ${soft}%   warning`,
    `  hard   ${hard}%   crystallize`,
    `  ouch   ${ouch}%   compact or die`,
    "",
    formatContextLine(reading),
  ].join("\n");
}
