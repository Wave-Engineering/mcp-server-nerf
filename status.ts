/**
 * nerf_status tool handler.
 *
 * Returns formatted display of current mode, dart thresholds, and context usage.
 * Updates statusline indicator based on context level.
 */

import { readConfig, MODE_MAP, type NerfConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { getContextUsage } from "./context.ts";
import { updateStatuslineIndicator } from "./indicator.ts";

/**
 * Format a token count for human-readable display.
 * e.g., 120000 -> "120k", 1500 -> "2k", 200000 -> "200k"
 */
export function formatTokenCount(value: number): string {
  return Math.round(value / 1000) + "k";
}

/**
 * Mode descriptions for display.
 */
const MODE_DESCRIPTIONS: Record<string, string> = {
  "not-too-rough": "manual crystallization — you decide when to save state",
  "hurt-me-plenty": "prompted crystallization — reminders at thresholds",
  ultraviolence: "auto-crystallize — yolo mode, saves state automatically",
};

/**
 * Handle the nerf_status tool call.
 */
export async function handleStatus(
  _params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId();
  const config = readConfig(sessionId);
  const modeName = config.mode;
  const modeDescription =
    MODE_DESCRIPTIONS[modeName] ?? "unknown mode";

  // Fetch context usage for display
  const contextUsage = await getContextUsage(sessionId);

  // Update statusline indicator (side-effect)
  await updateStatuslineIndicator(sessionId, config);

  // Format dart values
  const softStr = formatTokenCount(config.darts.soft);
  const hardStr = formatTokenCount(config.darts.hard);
  const ouchStr = formatTokenCount(config.darts.ouch);

  // Format context line
  let contextLine: string;
  if (contextUsage) {
    const pct = Math.round(contextUsage.percent);
    contextLine = `Context: ${formatTokenCount(contextUsage.total)}/${ouchStr} (${pct}%)`;
  } else {
    contextLine = "Context: unavailable";
  }

  return [
    `nerf — ${modeName} (${modeDescription})`,
    "",
    "Darts:",
    `  soft   ${softStr}   warning`,
    `  hard   ${hardStr}   crystallize`,
    `  ouch   ${ouchStr}   compact or die`,
    "",
    contextLine,
  ].join("\n");
}
