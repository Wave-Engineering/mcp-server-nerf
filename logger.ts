/**
 * logger.ts — MCP structured logger for mcp-server-nerf
 *
 * Emits structured JSON lines to stderr, optionally appends to LOG_FILE.
 * Respects LOG_LEVEL env var (default: info).
 *
 * Usage:
 *   import { log } from './logger.ts';
 *   log.info('tool_call', { tool: 'nerf_status', ok: true, ms: 42 });
 *   log.warn('state_change', { what: 'mode', from: 'manual', to: 'yolo' });
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const SERVER_NAME = process.env.MCP_SERVER_NAME || "nerf";
const LOG_LEVEL: Level = (process.env.LOG_LEVEL as Level) || "info";
const LOG_FILE = process.env.LOG_FILE; // e.g., ~/.claude/logs/nerf.jsonl

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function emit(
  level: Level,
  event: string,
  fields: Record<string, unknown>,
  msg?: string,
): void {
  if (!shouldLog(level)) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    server: SERVER_NAME,
    level,
    event,
    ...fields,
  };
  if (msg) line.msg = msg;

  const json = JSON.stringify(line);

  // Always stderr
  process.stderr.write(json + "\n");

  // Optional file output
  if (LOG_FILE) {
    try {
      const resolved = LOG_FILE.replace(/^~/, homedir());
      const dir = join(resolved, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(resolved, json + "\n");
    } catch {
      // Best-effort — don't crash the server over logging
    }
  }
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}, msg?: string) =>
    emit("debug", event, fields, msg),
  info: (event: string, fields: Record<string, unknown> = {}, msg?: string) =>
    emit("info", event, fields, msg),
  warn: (event: string, fields: Record<string, unknown> = {}, msg?: string) =>
    emit("warn", event, fields, msg),
  error: (event: string, fields: Record<string, unknown> = {}, msg?: string) =>
    emit("error", event, fields, msg),
};
