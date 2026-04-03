/**
 * nerf_budget tool handler.
 *
 * Sets the ouch dart and computes proportional soft/hard thresholds.
 * soft = floor(ouch * 0.60), hard = floor(ouch * 0.75).
 */

import { readConfig, writeConfig, type NerfConfig } from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { formatTokenCount } from "./status.ts";

/**
 * Handle the nerf_budget tool call.
 *
 * Requires `ouch` parameter. Computes soft and hard proportionally,
 * writes all three darts to config, returns new positions.
 */
export async function handleBudget(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId();
  const config = readConfig(sessionId);

  const ouch = params.ouch as number | undefined;

  // Validate ouch is provided
  if (ouch === undefined) {
    return "Error: ouch parameter is required";
  }

  // Validate positive integer
  if (!Number.isInteger(ouch) || ouch <= 0) {
    return `Error: ouch must be a positive integer, got ${ouch}`;
  }

  // Compute proportional darts
  const soft = Math.floor(ouch * 0.60);
  const hard = Math.floor(ouch * 0.75);

  // Write to config
  const newConfig: NerfConfig = {
    ...config,
    darts: { soft, hard, ouch },
  };
  writeConfig(sessionId, newConfig);

  return [
    "Budget set:",
    `  soft   ${formatTokenCount(soft)}   warning (60%)`,
    `  hard   ${formatTokenCount(hard)}   crystallize (75%)`,
    `  ouch   ${formatTokenCount(ouch)}   compact or die`,
  ].join("\n");
}
