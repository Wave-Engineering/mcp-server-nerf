/**
 * nerf_budget tool handler.
 *
 * Sets the ouch dart (percent of the context window used) and computes
 * proportional soft/hard thresholds:
 * soft = floor(ouch * 0.60), hard = floor(ouch * 0.75).
 */

import {
  readConfig,
  writeConfig,
  SOFT_RATIO,
  HARD_RATIO,
  type Darts,
  type NerfConfig,
} from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { updateStatuslineIndicator } from "./indicator.ts";
import { validateDartValue, validateDartOrder } from "./darts.ts";
import { coerceNumericInput } from "./numeric.ts";
import { log } from "./logger.ts";

/**
 * Handle the nerf_budget tool call.
 *
 * Requires `ouch` parameter. Computes soft and hard proportionally,
 * writes all three darts to config, returns new positions.
 *
 * Accepts `ouch` as either a JS number or a numeric string (see issue #13).
 */
export async function handleBudget(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const config = readConfig(sessionId);

  const ouchRaw = params.ouch;
  const ouch = coerceNumericInput(ouchRaw);

  // Validate ouch is provided
  if (ouch === undefined) {
    return "Error: ouch parameter is required";
  }

  const rangeError = validateDartValue("ouch", ouch, ouchRaw);
  if (rangeError) return rangeError;

  // Compute proportional darts
  const darts: Darts = {
    soft: Math.floor(ouch * SOFT_RATIO),
    hard: Math.floor(ouch * HARD_RATIO),
    ouch,
  };

  // A very low ouch rounds soft and hard onto each other (or to 0).
  if (darts.soft < 1) {
    return `Error: ouch ${ouch}% is too low to place soft and hard below it`;
  }
  const orderError = validateDartOrder(darts);
  if (orderError) {
    return `Error: ouch ${ouch}% is too low to place soft and hard below it (${orderError.replace(/^Error: /, "")})`;
  }

  // Write to config
  const oldDarts = { ...config.darts_pct };
  const newConfig: NerfConfig = { ...config, darts_pct: darts };
  writeConfig(sessionId, newConfig);
  await updateStatuslineIndicator(sessionId, newConfig);
  log.info("state_change", {
    what: "budget",
    from: oldDarts,
    to: darts,
  });

  return [
    "Budget set (percent of context window used):",
    `  soft   ${darts.soft}%   warning (60% of ouch)`,
    `  hard   ${darts.hard}%   reseed soon (75% of ouch)`,
    `  ouch   ${darts.ouch}%   reseed gate fires`,
  ].join("\n");
}
