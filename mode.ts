/**
 * nerf_mode tool handler.
 *
 * Gets or sets the behavior mode: what claudecode-workflow's reseed gate does
 * at the ouch dart.
 */

import {
  readConfig,
  writeConfig,
  MODE_DESCRIPTIONS,
  type NerfConfig,
} from "./config.ts";
import { resolveSessionId } from "./session.ts";
import { updateStatuslineIndicator } from "./indicator.ts";
import { log } from "./logger.ts";

const VALID_MODES: NerfConfig["mode"][] = [
  "not-too-rough",
  "hurt-me-plenty",
  "ultraviolence",
];

/**
 * Handle the nerf_mode tool call.
 *
 * - No `mode` arg: return current mode name and description
 * - With `mode` arg: validate, write to config, return confirmation
 */
export async function handleMode(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const config = readConfig(sessionId);

  const requestedMode = params.mode as string | undefined;

  // No mode arg — return current mode
  if (requestedMode === undefined) {
    const description = MODE_DESCRIPTIONS[config.mode] ?? "unknown mode";
    return [
      `Current mode: ${config.mode}`,
      `Description: ${description}`,
    ].join("\n");
  }

  // Validate mode
  if (!VALID_MODES.includes(requestedMode as NerfConfig["mode"])) {
    return `Invalid mode: "${requestedMode}". Valid modes: ${VALID_MODES.join(", ")}`;
  }

  // Set mode
  const oldMode = config.mode;
  const newConfig: NerfConfig = {
    ...config,
    mode: requestedMode as NerfConfig["mode"],
  };
  writeConfig(sessionId, newConfig);
  await updateStatuslineIndicator(sessionId, newConfig);
  log.info("state_change", { what: "mode", from: oldMode, to: requestedMode });

  const description =
    MODE_DESCRIPTIONS[requestedMode as NerfConfig["mode"]] ?? "unknown mode";
  return [
    `Mode set: ${requestedMode}`,
    `Description: ${description}`,
  ].join("\n");
}
