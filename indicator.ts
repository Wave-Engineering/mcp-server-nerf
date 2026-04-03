/**
 * indicator.ts — Statusline indicator lifecycle module
 *
 * Computes context pressure indicators based on dart thresholds and pushes
 * them to the shared statusline file. Indicators use the `nerf:` prefix
 * for namespacing in the shared indicators array.
 *
 * Pure logic in computeIndicator(), side-effecting push in
 * updateStatuslineIndicator().
 */

import { getContextUsage, type ContextUsage } from "./context.ts";
import { type NerfConfig } from "./config.ts";
import { addIndicator, removeIndicator } from "./statusline.ts";

/** Prefix for all nerf indicators in the shared statusline file. */
export const NERF_INDICATOR_PREFIX = "nerf:";

export interface IndicatorState {
  level: "none" | "soft" | "hard" | "critical";
  text: string;
}

/**
 * Pure function: compute the indicator level and display text from context
 * usage and dart configuration.
 *
 * Thresholds (checked highest-first):
 *   usage.total >= ouch  -> critical  🚨
 *   usage.total >= hard  -> hard      🔶
 *   usage.total >= soft  -> soft      ⚡
 *   otherwise            -> none      (no indicator)
 *
 * Percentage is taken directly from context-analyzer output (usage.percent),
 * rounded to the nearest integer.
 */
export function computeIndicator(
  usage: ContextUsage | null,
  config: NerfConfig,
): IndicatorState {
  if (!usage) return { level: "none", text: "" };

  const pct = Math.round(usage.percent);

  if (usage.total >= config.darts.ouch) {
    return { level: "critical", text: `\u{1F6A8} ${pct}%` };
  }
  if (usage.total >= config.darts.hard) {
    return { level: "hard", text: `\u{1F536} ${pct}%` };
  }
  if (usage.total >= config.darts.soft) {
    return { level: "soft", text: `\u{26A1} ${pct}%` };
  }

  return { level: "none", text: "" };
}

/**
 * Async side-effecting function: fetch current context usage, compute the
 * indicator, then atomically update the shared statusline file.
 *
 * 1. Calls getContextUsage(sessionId) from context.ts
 * 2. Calls computeIndicator() for pure threshold logic
 * 3. Removes any existing `nerf:` prefixed indicator (prefix-based cleanup)
 * 4. Adds the new indicator if level !== "none"
 *
 * Returns the computed IndicatorState so callers can inspect it.
 */
export async function updateStatuslineIndicator(
  sessionId: string,
  config: NerfConfig,
): Promise<IndicatorState> {
  const usage = await getContextUsage(sessionId);
  const state = computeIndicator(usage, config);

  // Remove any existing nerf indicator first (prefix match)
  removeIndicator(NERF_INDICATOR_PREFIX);

  // Add new indicator if above soft threshold
  if (state.level !== "none") {
    addIndicator(`${NERF_INDICATOR_PREFIX}${state.text}`);
  }

  return state;
}
