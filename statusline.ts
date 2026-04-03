/**
 * Statusline indicator helpers for mcp-server-nerf.
 *
 * Manages indicators in the Claude Code statusline JSON file.
 * Follows the same pattern as mcp-server-wtf for atomic read-modify-write.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

interface StatuslineData {
  indicators: string[];
}

/**
 * Resolve the project root via git.
 */
export function resolveProjectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Resolve the dev name from the agent identity file.
 * Reads /tmp/claude-agent-<dir_hash>.json where dir_hash is md5 of project root.
 */
export function resolveDevName(): string | null {
  try {
    const projectRoot = resolveProjectRoot();
    const dirHash = createHash("md5").update(projectRoot).digest("hex");
    const agentFile = `/tmp/claude-agent-${dirHash}.json`;
    const raw = readFileSync(agentFile, "utf-8");
    const data = JSON.parse(raw) as { dev_name?: string };
    return data.dev_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the statusline file path for the current agent.
 * Returns /tmp/claude-statusline-<dev_name>.json or null if dev name cannot be resolved.
 */
export function resolveStatuslineFile(): string | null {
  const devName = resolveDevName();
  if (!devName) return null;
  return `/tmp/claude-statusline-${devName}.json`;
}

/**
 * Read the statusline data from the given file path.
 */
function readStatusline(filePath: string): StatuslineData {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Partial<StatuslineData>;
    return { indicators: Array.isArray(data.indicators) ? data.indicators : [] };
  } catch {
    return { indicators: [] };
  }
}

/**
 * Write statusline data atomically (write to .tmp, rename).
 */
function writeStatusline(filePath: string, data: StatuslineData): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmpPath, filePath);
}

/**
 * Add an indicator to the statusline. Idempotent — will not add duplicates.
 * If the statusline file cannot be resolved, this is a no-op.
 */
export function addIndicator(indicator: string): void {
  const filePath = resolveStatuslineFile();
  if (!filePath) return;

  const data = readStatusline(filePath);
  if (!data.indicators.includes(indicator)) {
    data.indicators.push(indicator);
  }
  writeStatusline(filePath, data);
}

/**
 * Remove indicators matching the given prefix from the statusline.
 * If the statusline file cannot be resolved, this is a no-op.
 */
export function removeIndicator(prefix: string): void {
  const filePath = resolveStatuslineFile();
  if (!filePath) return;

  const data = readStatusline(filePath);
  data.indicators = data.indicators.filter((ind) => !ind.startsWith(prefix));
  writeStatusline(filePath, data);
}

// --- Overloads for testing with explicit file paths ---

/**
 * Add an indicator to a specific statusline file. Idempotent.
 */
export function addIndicatorToFile(filePath: string, indicator: string): void {
  const data = readStatusline(filePath);
  if (!data.indicators.includes(indicator)) {
    data.indicators.push(indicator);
  }
  writeStatusline(filePath, data);
}

/**
 * Remove indicators matching the given prefix from a specific statusline file.
 */
export function removeIndicatorFromFile(
  filePath: string,
  prefix: string,
): void {
  const data = readStatusline(filePath);
  data.indicators = data.indicators.filter((ind) => !ind.startsWith(prefix));
  writeStatusline(filePath, data);
}
