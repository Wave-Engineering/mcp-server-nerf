/**
 * nerf_scope tool handler.
 *
 * Spawns `nerf-server watch --session-id <id>` in a new terminal window: a
 * live view of the session's context reading against its darts. Detects the
 * terminal emulator from $TERM_PROGRAM and launches a detached process that
 * outlives the MCP request.
 *
 * Before #32 this launched context-crystallizer's `cc-context`, which
 * claudecode-workflow #647 removed; the monitor is now nerf's own subcommand.
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { resolveSessionId } from "./session.ts";
import { log } from "./logger.ts";

/** Default and minimum refresh interval for the watch view, in ms. */
export const DEFAULT_INTERVAL_MS = 5000;
export const MIN_INTERVAL_MS = 1000;

/** Terminal emulator launch commands keyed by TERM_PROGRAM value. */
const TERMINAL_COMMANDS: Record<string, (argv: string[]) => string[]> = {
  ghostty: (argv) => ["ghostty", "-e", ...argv],
  alacritty: (argv) => ["alacritty", "-e", ...argv],
  kitty: (argv) => ["kitty", ...argv],
};

/** Fallback terminal launchers tried in order. */
const FALLBACK_TERMINALS = ["x-terminal-emulator", "xterm"];

/**
 * The argv that re-invokes this nerf-server: the compiled binary alone, or
 * `bun <entry script>` when running from source.
 */
export function selfCommand(
  execPath: string = process.execPath,
  mainPath: string = Bun.main,
): string[] {
  return /^bun(\.exe)?$/.test(basename(execPath))
    ? [execPath, mainPath]
    : [execPath];
}

/**
 * The full watch command for a session.
 */
export function watchCommand(sessionId: string, intervalMs: number): string[] {
  return [
    ...selfCommand(),
    "watch",
    "--session-id",
    sessionId,
    "--interval",
    String(intervalMs),
  ];
}

/**
 * Detect the terminal emulator and return the spawn arguments.
 *
 * Returns { terminal, argv } on success, or null if no terminal found.
 */
export function buildTerminalCommand(
  command: string[],
): { terminal: string; argv: string[] } | null {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase();

  // Check known terminals from TERM_PROGRAM
  if (termProgram && TERMINAL_COMMANDS[termProgram]) {
    return { terminal: termProgram, argv: TERMINAL_COMMANDS[termProgram](command) };
  }

  // Try fallbacks (skip in test mode to avoid spawning real terminals)
  if (process.env.NERF_SCOPE_NO_FALLBACK === "1") {
    return null;
  }
  for (const fallback of FALLBACK_TERMINALS) {
    try {
      const which = Bun.spawnSync(["which", fallback]);
      if (which.exitCode === 0) {
        return { terminal: fallback, argv: [fallback, "-e", ...command] };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Normalise the requested interval: default when absent, floor at the minimum.
 */
export function resolveInterval(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(n));
}

/**
 * Handle the nerf_scope tool call.
 *
 * Spawns the watch view in a new terminal window. Returns a confirmation
 * message or a helpful fallback with the manual command.
 */
export async function handleScope(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const intervalMs = resolveInterval(params.interval);
  const command = watchCommand(sessionId, intervalMs);
  const cmdStr = command.join(" ");

  const termCmd = buildTerminalCommand(command);

  if (!termCmd) {
    log.warn("subprocess", { cmd: "terminal", exit_code: -1, ms: 0 }, "No terminal emulator detected");
    return [
      "Could not detect a terminal emulator ($TERM_PROGRAM is not set).",
      "",
      "Run manually in a separate terminal:",
      `  ${cmdStr}`,
    ].join("\n");
  }

  // Spawn the terminal as a detached process (skip in dry-run / test mode)
  if (process.env.NERF_SCOPE_DRY_RUN !== "1") {
    const [cmd, ...args] = termCmd.argv;
    const spawnStart = performance.now();
    try {
      const child = spawn(cmd, args, {
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
      return [
        `Failed to launch ${termCmd.terminal}: ${msg}`,
        "",
        "Run manually in a separate terminal:",
        `  ${cmdStr}`,
      ].join("\n");
    }
  }

  return [
    `Scope monitor launched in ${termCmd.terminal} for session ${sessionId.slice(0, 8)}`,
    `(refreshing every ${intervalMs}ms)`,
  ].join("\n");
}
