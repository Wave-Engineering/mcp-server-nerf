/**
 * nerf_status tool handler.
 *
 * Returns formatted display of current mode, dart thresholds, and context usage.
 * Updates statusline indicator based on context level.
 */

import { readConfig, MODE_MAP, type NerfConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { addIndicator, removeIndicator } from "./statusline.ts";

/**
 * Format a token count for human-readable display.
 * e.g., 120000 → "120k", 1500 → "2k", 200000 → "200k"
 */
export function formatTokenCount(value: number): string {
  return Math.round(value / 1000) + "k";
}

/**
 * Attempt to get context usage. Returns null if the context module
 * is not available (#223 may not be merged yet).
 *
 * Uses a runtime-only path string to avoid TypeScript compile-time errors
 * when context.ts does not exist.
 */
async function getContextUsage(): Promise<{
  used: number;
  total: number;
} | null> {
  try {
    // Build the path at runtime so tsc doesn't resolve it at compile time
    const contextModule = "./context" + ".ts";
    const mod = await import(/* @vite-ignore */ contextModule);
    if (typeof mod.getContextUsage === "function") {
      const result = mod.getContextUsage();
      return result ?? null;
    }
  } catch {
    // context.ts not available — #223 not merged yet
  }
  return null;
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
 * Update statusline indicator based on context usage level.
 * Removes any existing nerf context indicator first, then adds the
 * appropriate one (if any).
 */
function updateStatuslineIndicator(
  contextUsage: { used: number; total: number } | null,
  config: NerfConfig,
): void {
  // Remove any existing nerf context indicators
  removeIndicator("⚡");
  removeIndicator("🔶");
  removeIndicator("🚨");

  if (!contextUsage) return;

  const { used } = contextUsage;
  const { soft, hard, ouch } = config.darts;

  if (used >= ouch * 0.85) {
    const pct = Math.round((used / ouch) * 100);
    addIndicator(`🚨 ${pct}%`);
  } else if (used >= hard) {
    const pct = Math.round((used / ouch) * 100);
    addIndicator(`🔶 ${pct}%`);
  } else if (used >= soft) {
    const pct = Math.round((used / ouch) * 100);
    addIndicator(`⚡ ${pct}%`);
  }
  // Below soft: no indicator (no clutter when healthy)
}

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

  const contextUsage = await getContextUsage();

  // Update statusline indicator
  updateStatuslineIndicator(contextUsage, config);

  // Format dart values
  const softStr = formatTokenCount(config.darts.soft);
  const hardStr = formatTokenCount(config.darts.hard);
  const ouchStr = formatTokenCount(config.darts.ouch);

  // Format context line
  let contextLine: string;
  if (contextUsage) {
    const pct = Math.round((contextUsage.used / config.darts.ouch) * 100);
    contextLine = `Context: ${formatTokenCount(contextUsage.used)}/${ouchStr} (${pct}%)`;
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
