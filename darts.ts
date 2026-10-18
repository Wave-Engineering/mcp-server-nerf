/**
 * nerf_darts tool handler.
 *
 * Gets or sets individual dart thresholds (soft, hard, ouch) as percentages of
 * the context window used (#32). A percentage is correct on any window size;
 * the old absolute token counts were tuned for 200k and wrong on 1M.
 * All-or-nothing: must provide all three or none.
 * Validates integers in 1-99 with soft < hard < ouch.
 */

import { readConfig, writeConfig, type Darts, type NerfConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { updateStatuslineIndicator } from "./indicator.ts";
import { coerceNumericInput, formatRawValue } from "./numeric.ts";
import { log } from "./logger.ts";

/**
 * Validate one dart value. Returns an error string, or null when valid.
 */
export function validateDartValue(name: string, value: number | undefined, raw: unknown): string | null {
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 99) {
    return `Error: ${name} must be an integer percentage from 1 to 99, got ${formatRawValue(raw)}`;
  }
  return null;
}

/**
 * Validate ordering. Returns an error string, or null when valid.
 */
export function validateDartOrder(darts: Darts): string | null {
  if (darts.soft >= darts.hard) {
    return `Error: soft (${darts.soft}%) must be less than hard (${darts.hard}%)`;
  }
  if (darts.hard >= darts.ouch) {
    return `Error: hard (${darts.hard}%) must be less than ouch (${darts.ouch}%)`;
  }
  return null;
}

/**
 * Handle the nerf_darts tool call.
 *
 * - No args: return current dart positions with labels
 * - With args: validate all-or-nothing, range, ordering. Write to config.
 *
 * Accepts numeric arguments as either JS numbers or numeric strings; some
 * MCP clients stringify tool-call args despite the schema saying `type: number`.
 * Non-numeric or non-integer inputs are rejected with the original value
 * quoted in the error message for diagnosability. See issue #13.
 */
export async function handleDarts(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const config = readConfig(sessionId);

  // Preserve originals for error messages; coerce separately for validation.
  const softRaw = params.soft;
  const hardRaw = params.hard;
  const ouchRaw = params.ouch;

  const soft = coerceNumericInput(softRaw);
  const hard = coerceNumericInput(hardRaw);
  const ouch = coerceNumericInput(ouchRaw);

  // No args — return current positions
  if (soft === undefined && hard === undefined && ouch === undefined) {
    return formatDarts(config.darts_pct);
  }

  // Partial args — reject
  if (soft === undefined || hard === undefined || ouch === undefined) {
    return "Error: must provide all three darts (soft, hard, ouch) or none. Partial updates are not allowed.";
  }

  const rangeError =
    validateDartValue("soft", soft, softRaw) ??
    validateDartValue("hard", hard, hardRaw) ??
    validateDartValue("ouch", ouch, ouchRaw);
  if (rangeError) return rangeError;

  const darts: Darts = { soft, hard, ouch };
  const orderError = validateDartOrder(darts);
  if (orderError) return orderError;

  // Write to config
  const oldDarts = { ...config.darts_pct };
  const newConfig: NerfConfig = { ...config, darts_pct: darts };
  writeConfig(sessionId, newConfig);
  await updateStatuslineIndicator(sessionId, newConfig);
  log.info("state_change", {
    what: "darts",
    from: oldDarts,
    to: darts,
  });

  return formatDarts(darts);
}

/**
 * Format dart positions for display.
 */
export function formatDarts(darts: Darts): string {
  return [
    "Darts (percent of context window used):",
    `  soft   ${darts.soft}%   warning`,
    `  hard   ${darts.hard}%   crystallize`,
    `  ouch   ${darts.ouch}%   compact or die`,
  ].join("\n");
}
