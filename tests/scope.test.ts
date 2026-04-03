/**
 * Unit tests for scope.ts — nerf_scope tool handler.
 *
 * handleScope tests use NERF_SCOPE_DRY_RUN=1 to prevent actual terminal spawns.
 * buildTerminalCommand tests are pure (no side effects).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { handleScope, buildTerminalCommand } from "../scope.ts";

describe("nerf_scope", () => {
  let fakeCcContext: string;

  beforeEach(() => {
    // Create a fake cc-context script so existsSync passes
    fakeCcContext = `/tmp/fake-cc-context-${Date.now()}`;
    writeFileSync(fakeCcContext, "#!/bin/bash\nexit 0\n");
    chmodSync(fakeCcContext, 0o755);
    process.env.NERF_CC_CONTEXT_PATH = fakeCcContext;
    // Prevent actual terminal spawns during tests
    process.env.NERF_SCOPE_DRY_RUN = "1";
  });

  afterEach(() => {
    delete process.env.NERF_CC_CONTEXT_PATH;
    delete process.env.NERF_SCOPE_DRY_RUN;
    delete process.env.TERM_PROGRAM;
    delete process.env.NERF_SCOPE_NO_FALLBACK;
    try { unlinkSync(fakeCcContext); } catch { /* ignore */ }
  });

  test("scope returns error when cc-context not found", async () => {
    process.env.NERF_CC_CONTEXT_PATH = "/nonexistent/cc-context";

    const result = await handleScope({});

    expect(result).toContain("Error: cc-context not found");
    expect(result).toContain("install.sh --crystallizer");
  });

  test("scope returns fallback when no terminal detected", async () => {
    delete process.env.TERM_PROGRAM;
    process.env.NERF_SCOPE_NO_FALLBACK = "1";

    const result = await handleScope({});

    expect(result).toContain("Could not detect a terminal emulator");
    expect(result).toContain("cc-context watch");
    // Without explicit session_id, should NOT include --session
    expect(result).not.toContain("--session");
  });

  test("scope fallback includes --session when explicitly provided", async () => {
    delete process.env.TERM_PROGRAM;
    process.env.NERF_SCOPE_NO_FALLBACK = "1";

    const result = await handleScope({ session_id: "abc-123-def" });

    expect(result).toContain("cc-context watch --session abc-123-def");
  });

  test("scope launches without --session when no explicit ID", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({});

    expect(result).toContain("Scope monitor launched");
    expect(result).toContain("ghostty");
    expect(result).toContain("current session");
  });

  test("scope launches with session label when explicit ID provided", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({ session_id: "abcdef01-2345-6789" });

    expect(result).toContain("Scope monitor launched");
    expect(result).toContain("ghostty");
    expect(result).toContain("session abcdef01");
  });

  test("scope acknowledges interval param", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({ interval: 15000 });

    expect(result).toContain("15000ms");
  });

  test("scope without interval does not mention interval", async () => {
    process.env.TERM_PROGRAM = "ghostty";

    const result = await handleScope({});

    expect(result).not.toContain("Requested interval");
    expect(result).not.toContain("poll");
  });
});

describe("buildTerminalCommand", () => {
  afterEach(() => {
    delete process.env.TERM_PROGRAM;
  });

  test("builds ghostty command with -e flag", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const result = buildTerminalCommand("/usr/bin/cc-context", "sess-123");

    expect(result).not.toBeNull();
    expect(result!.terminal).toBe("ghostty");
    expect(result!.argv[0]).toBe("ghostty");
    expect(result!.argv).toContain("-e");
    expect(result!.argv).toContain("/usr/bin/cc-context");
    expect(result!.argv).toContain("watch");
    expect(result!.argv).toContain("--session");
    expect(result!.argv).toContain("sess-123");
  });

  test("builds kitty command without -e flag", () => {
    process.env.TERM_PROGRAM = "kitty";
    const result = buildTerminalCommand("/usr/bin/cc-context", "sess-456");

    expect(result).not.toBeNull();
    expect(result!.terminal).toBe("kitty");
    expect(result!.argv[0]).toBe("kitty");
    expect(result!.argv).not.toContain("-e");
    expect(result!.argv).toContain("/usr/bin/cc-context");
    expect(result!.argv).toContain("sess-456");
  });

  test("builds alacritty command with -e flag", () => {
    process.env.TERM_PROGRAM = "alacritty";
    const result = buildTerminalCommand("/usr/bin/cc-context", "sess-789");

    expect(result).not.toBeNull();
    expect(result!.terminal).toBe("alacritty");
    expect(result!.argv[0]).toBe("alacritty");
    expect(result!.argv).toContain("-e");
    expect(result!.argv).toContain("sess-789");
  });

  test("omits --session when sessionId is null", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const result = buildTerminalCommand("/usr/bin/cc-context", null);

    expect(result).not.toBeNull();
    expect(result!.argv).toContain("watch");
    expect(result!.argv).not.toContain("--session");
  });

  test("includes --session when sessionId provided", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const result = buildTerminalCommand("/usr/bin/cc-context", "my-session");

    expect(result).not.toBeNull();
    expect(result!.argv).toContain("--session");
    expect(result!.argv).toContain("my-session");
  });

  test("unknown TERM_PROGRAM tries fallbacks", () => {
    process.env.TERM_PROGRAM = "some-unknown-terminal";
    const result = buildTerminalCommand("/usr/bin/cc-context", "sess-000");

    // Result depends on what's installed — either a fallback or null
    if (result !== null) {
      expect(result.argv).toContain("/usr/bin/cc-context");
      expect(result.argv).toContain("watch");
    }
  });

  test("includes all required watch args in correct order", () => {
    process.env.TERM_PROGRAM = "ghostty";
    const result = buildTerminalCommand("/path/to/cc-context", "my-session-id");

    expect(result).not.toBeNull();
    const argv = result!.argv;
    const watchIdx = argv.indexOf("watch");
    const sessionIdx = argv.indexOf("--session");
    const idIdx = argv.indexOf("my-session-id");

    expect(watchIdx).toBeGreaterThan(0);
    expect(sessionIdx).toBeGreaterThan(watchIdx);
    expect(idIdx).toBe(sessionIdx + 1);
  });
});
