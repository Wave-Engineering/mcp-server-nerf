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

import { getContextReading, type ContextReading } from "./context.ts";
import { type NerfConfig } from "./config.ts";
import { addIndicator, removeIndicator } from "./statusline.ts";

/** Prefix for all nerf indicators in the shared statusline file. */
export const NERF_INDICATOR_PREFIX = "nerf:";

export interface IndicatorState {
  level: "unknown" | "none" | "soft" | "hard" | "critical";
  text: string;
}

/**
 * Pure function: compute the indicator level and display text from a context
 * reading and dart configuration.
 *
 * Thresholds (percent of the window used, checked highest-first):
 *   used >= ouch  -> critical  🚨
 *   used >= hard  -> hard      🔶
 *   used >= soft  -> soft      ⚡
 *   otherwise     -> none      (no indicator)
 *
 * No usable reading is `unknown` and renders `ctx ?` — never `none`. A missing
 * measurement must not look like a healthy one (#32).
 */
export function computeIndicator(
  reading: ContextReading,
  config: NerfConfig,
): IndicatorState {
  if (!reading.ok) return { level: "unknown", text: "ctx ?" };

  const used = reading.usedPercent;
  const pct = Math.round(used);
  const { soft, hard, ouch } = config.darts_pct;

  if (used >= ouch) {
    return { level: "critical", text: `\u{1F6A8} ${pct}%` };
  }
  if (used >= hard) {
    return { level: "hard", text: `\u{1F536} ${pct}%` };
  }
  if (used >= soft) {
    return { level: "soft", text: `\u{26A1} ${pct}%` };
  }

  return { level: "none", text: "" };
}

/**
 * Async side-effecting function: read the current context, compute the
 * indicator, then atomically update the shared statusline file.
 *
 * 1. Calls getContextReading(sessionId) from context.ts
 * 2. Calls computeIndicator() for pure threshold logic
 * 3. Removes any existing `nerf:` prefixed indicator (prefix-based cleanup)
 * 4. Adds the new indicator if level !== "none" (so `unknown` is shown)
 *
 * `notBefore` is passed through to getContextReading (see context.ts).
 *
 * Returns the computed IndicatorState so callers can inspect it.
 */
export async function updateStatuslineIndicator(
  sessionId: string,
  config: NerfConfig,
  notBefore?: number,
): Promise<IndicatorState> {
  const reading = getContextReading(sessionId, undefined, notBefore);
  const state = computeIndicator(reading, config);

  // Remove any existing nerf indicator first (prefix match)
  removeIndicator(NERF_INDICATOR_PREFIX);

  // Add new indicator if above soft threshold, or if the reading is unknown
  if (state.level !== "none") {
    addIndicator(`${NERF_INDICATOR_PREFIX}${state.text}`);
  }

  return state;
}
