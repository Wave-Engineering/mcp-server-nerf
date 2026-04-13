/**
 * nerf_scope tool handler.
 *
 * Spawns `cc-context watch --session <id>` in a new terminal window.
 * Detects the terminal emulator from $TERM_PROGRAM and launches a
 * detached process that outlives the MCP request.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "./logger.ts";
/** Path to the cc-context CLI script. */
const CC_CONTEXT_PATH = join(
  homedir(),
  ".claude",
  "context-crystallizer",
  "bin",
  "cc-context",
);

/** Terminal emulator launch commands keyed by TERM_PROGRAM value. */
const TERMINAL_COMMANDS: Record<string, (cmd: string, args: string[]) => string[]> = {
  ghostty: (cmd, args) => ["ghostty", "-e", cmd, ...args],
  alacritty: (cmd, args) => ["alacritty", "-e", cmd, ...args],
  kitty: (cmd, args) => ["kitty", cmd, ...args],
};

/** Fallback terminal launchers tried in order. */
const FALLBACK_TERMINALS = ["x-terminal-emulator", "xterm"];

/**
 * Detect the terminal emulator and return the spawn arguments.
 *
 * Returns { terminal, argv } on success, or null if no terminal found.
 */
export function buildTerminalCommand(
  ccContextPath: string,
  sessionId: string | null,
): { terminal: string; argv: string[] } | null {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase();
  const watchArgs = sessionId
    ? ["watch", "--session", sessionId]
    : ["watch"];

  // Check known terminals from TERM_PROGRAM
  if (termProgram && TERMINAL_COMMANDS[termProgram]) {
    const argv = TERMINAL_COMMANDS[termProgram](ccContextPath, watchArgs);
    return { terminal: termProgram, argv };
  }

  // Try fallbacks (skip in test mode to avoid spawning real terminals)
  if (process.env.NERF_SCOPE_NO_FALLBACK === "1") {
    return null;
  }
  for (const fallback of FALLBACK_TERMINALS) {
    try {
      const which = Bun.spawnSync(["which", fallback]);
      if (which.exitCode === 0) {
        return {
          terminal: fallback,
          argv: [fallback, "-e", ccContextPath, ...watchArgs],
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Handle the nerf_scope tool call.
 *
 * Spawns cc-context watch in a new terminal window. Returns a
 * confirmation message or a helpful fallback with the manual command.
 */
export async function handleScope(
  params: Record<string, unknown>,
): Promise<string> {
  // Only use session_id for cc-context when explicitly provided by the caller.
  // Auto-resolved IDs (PID hashes) are synthetic and won't match real transcripts.
  // When null, cc-context falls back to history.jsonl (most recent session).
  const explicitSessionId = params.session_id as string | undefined ?? null;
  const interval = params.interval as number | undefined;

  // Resolve cc-context path (allow override for testing)
  const ccContextPath = process.env.NERF_CC_CONTEXT_PATH ?? CC_CONTEXT_PATH;

  if (!existsSync(ccContextPath)) {
    log.warn("subprocess", { cmd: "cc-context", exit_code: -1, ms: 0 }, "cc-context binary not found");
    return [
      "Error: cc-context not found at expected path.",
      `Expected: ${ccContextPath}`,
      "",
      "Install the context-crystallizer first:",
      "  cd <claudecode-workflow> && ./install.sh --crystallizer",
    ].join("\n");
  }

  const termCmd = buildTerminalCommand(ccContextPath, explicitSessionId);

  if (!termCmd) {
    log.warn("subprocess", { cmd: "terminal", exit_code: -1, ms: 0 }, "No terminal emulator detected");
    // No terminal detected — return manual command
    const cmdStr = explicitSessionId
      ? `cc-context watch --session ${explicitSessionId}`
      : "cc-context watch";
    const lines = [
      "Could not detect a terminal emulator ($TERM_PROGRAM is not set).",
      "",
      "Run manually in a separate terminal:",
      `  ${cmdStr}`,
    ];
    if (interval !== undefined) {
      lines.push("");
      lines.push(`(Requested interval: ${interval}ms — cc-context uses a fixed 5s poll)`);
    }
    return lines.join("\n");
  }

  // Spawn the terminal as a detached process (skip in dry-run / test mode)
  if (process.env.NERF_SCOPE_DRY_RUN !== "1") {
    const [command, ...args] = termCmd.argv;
    const spawnStart = performance.now();
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      const ms = Math.round(performance.now() - spawnStart);
      log.info("subprocess", { cmd: termCmd.terminal, exit_code: 0, ms });
    } catch (err: unknown) {
      const ms = Math.round(performance.now() - spawnStart);
      const msg = err instanceof Error ? err.message : String(err);
      log.error("subprocess", { cmd: termCmd.terminal, exit_code: 1, ms, stderr: msg.slice(0, 200) });
      const cmdStr = explicitSessionId
        ? `cc-context watch --session ${explicitSessionId}`
        : "cc-context watch";
      return [
        `Failed to launch ${termCmd.terminal}: ${msg}`,
        "",
        "Run manually in a separate terminal:",
        `  ${cmdStr}`,
      ].join("\n");
    }
  }

  const label = explicitSessionId
    ? `session ${explicitSessionId.slice(0, 8)}`
    : "current session";
  const lines = [
    `Scope monitor launched in ${termCmd.terminal} for ${label}`,
  ];
  if (interval !== undefined) {
    lines.push(`(Requested interval: ${interval}ms — cc-context uses a fixed 5s poll)`);
  }
  return lines.join("\n");
}
