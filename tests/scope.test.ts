/**
 * Unit tests for scope.ts — nerf_scope tool handler.
 *
 * handleScope tests use NERF_SCOPE_DRY_RUN=1 to prevent actual terminal spawns.
 * buildTerminalCommand / selfCommand / watchCommand tests are pure.
 *
 * nerf_scope no longer depends on context-crystallizer's cc-context (removed by
 * claudecode-workflow #647); it opens nerf's own `watch` subcommand.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleScope,
  buildTerminalCommand,
  selfCommand,
  watchCommand,
  resolveInterval,
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
} from "../scope.ts";

describe("nerf_scope", () => {
  beforeEach(() => {
    process.env.NERF_SCOPE_DRY_RUN = "1";
    process.env.CLAUDE_SESSION_ID = "abcdef01-2345-6789-abcd-ef0123456789";
  });

  afterEach(() => {
    delete process.env.NERF_SCOPE_DRY_RUN;
    delete process.env.TERM_PROGRAM;
    delete process.env.NERF_SCOPE_NO_FALLBACK;
    delete process.env.CLAUDE_SESSION_ID;
  });

  test("scope returns the manual watch command when no terminal detected", async () => {
    delete process.env.TERM_PROGRAM;
    process.env.NERF_SCOPE_NO_FALLBACK = "1";

    const result = await handleScope({});

    expect(result).toContain("Could not detect a terminal emulator");
    expect(result).toContain("watch --session-id abcdef01-2345-6789-abcd-ef0123456789");
    expect(result).not.toContain("cc-context");
  });

  test("scope passes an explicit session_id through", async () => {
    delete process.env.TERM_PROGRAM;
    process.env.NERF_SCOPE_NO_FALLBACK = "1";

    const result = await handleScope({ session_id: "abc-123-def" });

    expect(result).toContain("watch --session-id abc-123-def");
  });

  test("scope launches with the resolved session label", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({});

    expect(result).toContain("Scope monitor launched in ghostty for session abcdef01");
  });

  test("scope honours the interval param", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({ interval: 15000 });

    expect(result).toContain("refreshing every 15000ms");
  });

  test("scope uses the default interval when none is given", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({});

    expect(result).toContain(`refreshing every ${DEFAULT_INTERVAL_MS}ms`);
  });

  test("no dependency on context-crystallizer remains in scope.ts", () => {
    const source = readFileSync(join(import.meta.dir, "..", "scope.ts"), "utf-8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    expect(source).not.toContain("context-crystallizer");
    expect(source).not.toContain("cc-context");
  });
});

describe("selfCommand", () => {
  test("a compiled binary re-invokes itself alone", () => {
    expect(selfCommand("/home/u/.local/bin/nerf-server", "/$bunfs/root/nerf-server")).toEqual([
      "/home/u/.local/bin/nerf-server",
    ]);
  });

  test("running from source re-invokes bun with the entry script", () => {
    expect(selfCommand("/usr/local/bin/bun", "/repo/index.ts")).toEqual([
      "/usr/local/bin/bun",
      "/repo/index.ts",
    ]);
  });
});

describe("watchCommand", () => {
  test("ends with the watch subcommand, session and interval in order", () => {
    const argv = watchCommand("my-session-id", 5000);
    const tail = argv.slice(-5);
    expect(tail).toEqual(["watch", "--session-id", "my-session-id", "--interval", "5000"]);
  });
});

describe("resolveInterval", () => {
  test("defaults, floors and coerces", () => {
    expect(resolveInterval(undefined)).toBe(DEFAULT_INTERVAL_MS);
    expect(resolveInterval("abc")).toBe(DEFAULT_INTERVAL_MS);
    expect(resolveInterval(200)).toBe(MIN_INTERVAL_MS);
    expect(resolveInterval("15000")).toBe(15000);
  });
});

describe("buildTerminalCommand", () => {
  const command = ["/usr/bin/nerf-server", "watch", "--session-id", "sess-123", "--interval", "5000"];

  afterEach(() => {
    delete process.env.TERM_PROGRAM;
  });

  test("builds ghostty command with -e flag", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const result = buildTerminalCommand(command);

    expect(result).not.toBeNull();
    expect(result!.terminal).toBe("ghostty");
    expect(result!.argv).toEqual(["ghostty", "-e", ...command]);
  });

  test("builds kitty command without -e flag", () => {
    process.env.TERM_PROGRAM = "kitty";
    const result = buildTerminalCommand(command);

    expect(result!.argv).toEqual(["kitty", ...command]);
  });

  test("builds alacritty command with -e flag", () => {
    process.env.TERM_PROGRAM = "alacritty";
    const result = buildTerminalCommand(command);

    expect(result!.argv).toEqual(["alacritty", "-e", ...command]);
  });

  test("unknown TERM_PROGRAM tries fallbacks", () => {
    process.env.TERM_PROGRAM = "some-unknown-terminal";
    const result = buildTerminalCommand(command);

    // Result depends on what's installed — either a fallback or null
    if (result !== null) {
      expect(result.argv.slice(-command.length)).toEqual(command);
    }
  });
});
