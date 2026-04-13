/**
 * nerf_mode tool handler.
 *
 * Gets or sets the behavior mode. Validates mode names and maps
 * doom-style names to crystallizer mode names.
 */

import {
  readConfig,
  writeConfig,
  MODE_MAP,
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
 * Mode descriptions for display.
 */
const MODE_DESCRIPTIONS: Record<string, string> = {
  "not-too-rough": "manual crystallization — you decide when to save state",
  "hurt-me-plenty": "prompted crystallization — reminders at thresholds",
  ultraviolence: "auto-crystallize — yolo mode, saves state automatically",
};

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
    const crystallizerMode = MODE_MAP[config.mode] ?? "unknown";
    return [
      `Current mode: ${config.mode}`,
      `Description: ${description}`,
      `CRYSTALLIZE_MODE: ${crystallizerMode}`,
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

  const description = MODE_DESCRIPTIONS[requestedMode] ?? "unknown mode";
  const crystallizerMode = MODE_MAP[requestedMode] ?? "unknown";
  return [
    `Mode set: ${requestedMode}`,
    `Description: ${description}`,
    `CRYSTALLIZE_MODE: ${crystallizerMode}`,
  ].join("\n");
}
