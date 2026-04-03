/**
 * Unit tests for mode.ts — nerf_mode tool handler.
 *
 * Tests use real filesystem operations with temp config files.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import {
  configPath,
  readConfig,
  writeConfig,
  DEFAULTS,
  MODE_MAP,
  type NerfConfig,
} from "../config.ts";
import { handleMode } from "../mode.ts";

describe("nerf_mode", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-mode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Set env so resolveSessionId() returns our test session ID
    process.env.CLAUDE_SESSION_ID = testSessionId;
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    const path = configPath(testSessionId);
    try { rmSync(path, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${path}.tmp`, { force: true }); } catch { /* ignore */ }
  });

  test("mode returns current mode when no arg provided", async () => {
    // Default mode is hurt-me-plenty
    const result = await handleMode({});

    expect(result).toContain("Current mode: hurt-me-plenty");
    expect(result).toContain("prompted crystallization");
    expect(result).toContain("CRYSTALLIZE_MODE: prompt");
  });

  test("mode returns current mode from existing config", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleMode({});

    expect(result).toContain("Current mode: ultraviolence");
    expect(result).toContain("auto-crystallize");
    expect(result).toContain("CRYSTALLIZE_MODE: yolo");
  });

  test("mode sets valid mode — ultraviolence", async () => {
    const result = await handleMode({ mode: "ultraviolence" });

    expect(result).toContain("Mode set: ultraviolence");
    expect(result).toContain("auto-crystallize");
    expect(result).toContain("CRYSTALLIZE_MODE: yolo");

    // Verify config was actually written
    const config = readConfig(testSessionId);
    expect(config.mode).toBe("ultraviolence");
  });

  test("mode sets valid mode — not-too-rough", async () => {
    const result = await handleMode({ mode: "not-too-rough" });

    expect(result).toContain("Mode set: not-too-rough");
    expect(result).toContain("manual crystallization");
    expect(result).toContain("CRYSTALLIZE_MODE: manual");

    const config = readConfig(testSessionId);
    expect(config.mode).toBe("not-too-rough");
  });

  test("mode sets valid mode — hurt-me-plenty", async () => {
    // First set to something else
    writeConfig(testSessionId, {
      ...DEFAULTS,
      mode: "ultraviolence",
      session_id: testSessionId,
    });

    const result = await handleMode({ mode: "hurt-me-plenty" });

    expect(result).toContain("Mode set: hurt-me-plenty");
    expect(result).toContain("CRYSTALLIZE_MODE: prompt");

    const config = readConfig(testSessionId);
    expect(config.mode).toBe("hurt-me-plenty");
  });

  test("mode rejects invalid mode with error message", async () => {
    const result = await handleMode({ mode: "nightmare" });

    expect(result).toContain('Invalid mode: "nightmare"');
    expect(result).toContain("Valid modes:");
    expect(result).toContain("not-too-rough");
    expect(result).toContain("hurt-me-plenty");
    expect(result).toContain("ultraviolence");
  });

  test("mode rejects empty string as mode", async () => {
    const result = await handleMode({ mode: "" });

    expect(result).toContain("Invalid mode:");
  });

  test("mode maps correctly to CRYSTALLIZE_MODE", async () => {
    // Test each mode maps to the right crystallizer mode
    for (const [doom, crystallizer] of Object.entries(MODE_MAP)) {
      const result = await handleMode({ mode: doom });
      expect(result).toContain(`CRYSTALLIZE_MODE: ${crystallizer}`);
    }
  });

  test("mode preserves existing dart config when setting mode", async () => {
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 80_000, hard: 100_000, ouch: 150_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    await handleMode({ mode: "ultraviolence" });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    // Darts should be preserved
    expect(updated.darts.soft).toBe(80_000);
    expect(updated.darts.hard).toBe(100_000);
    expect(updated.darts.ouch).toBe(150_000);
  });
});
