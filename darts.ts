/**
 * nerf_darts tool handler.
 *
 * Gets or sets individual dart thresholds (soft, hard, ouch).
 * All-or-nothing: must provide all three or none.
 * Validates soft < hard < ouch, all positive integers.
 */

import { readConfig, writeConfig, type NerfConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { formatTokenCount } from "./status.ts";
import { updateStatuslineIndicator } from "./indicator.ts";
import { coerceNumericInput, formatRawValue } from "./numeric.ts";
import { log } from "./logger.ts";

/**
 * Handle the nerf_darts tool call.
 *
 * - No args: return current dart positions with labels
 * - With args: validate all-or-nothing, ordering, positivity. Write to config.
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
    return formatDarts(config);
  }

  // Partial args — reject
  if (soft === undefined || hard === undefined || ouch === undefined) {
    return "Error: must provide all three darts (soft, hard, ouch) or none. Partial updates are not allowed.";
  }

  // Validate positive integers (rejects NaN, Infinity, floats, non-numeric strings)
  if (!Number.isInteger(soft) || soft <= 0) {
    return `Error: soft must be a positive integer, got ${formatRawValue(softRaw)}`;
  }
  if (!Number.isInteger(hard) || hard <= 0) {
    return `Error: hard must be a positive integer, got ${formatRawValue(hardRaw)}`;
  }
  if (!Number.isInteger(ouch) || ouch <= 0) {
    return `Error: ouch must be a positive integer, got ${formatRawValue(ouchRaw)}`;
  }

  // Validate ordering: soft < hard < ouch
  if (soft >= hard) {
    return `Error: soft (${soft}) must be less than hard (${hard})`;
  }
  if (hard >= ouch) {
    return `Error: hard (${hard}) must be less than ouch (${ouch})`;
  }

  // Write to config
  const oldDarts = { ...config.darts };
  const newConfig: NerfConfig = {
    ...config,
    darts: { soft, hard, ouch },
  };
  writeConfig(sessionId, newConfig);
  await updateStatuslineIndicator(sessionId, newConfig);
  log.info("state_change", {
    what: "darts",
    from: oldDarts,
    to: { soft, hard, ouch },
  });

  return formatDarts(newConfig);
}

/**
 * Format dart positions for display.
 */
function formatDarts(config: NerfConfig): string {
  const { soft, hard, ouch } = config.darts;
  return [
    "Darts:",
    `  soft   ${formatTokenCount(soft)}   warning`,
    `  hard   ${formatTokenCount(hard)}   crystallize`,
    `  ouch   ${formatTokenCount(ouch)}   compact or die`,
  ].join("\n");
}
