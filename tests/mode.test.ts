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
  MODE_DESCRIPTIONS,
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
    // Default mode is ultraviolence (claudecode-workflow#1352)
    const result = await handleMode({});

    expect(result).toContain("Current mode: ultraviolence");
    expect(result).toContain("reseed automatically at the ouch dart");
    expect(result).not.toContain("CRYSTALLIZE");
  });

  test("mode uses explicit session_id param over env var", async () => {
    const overrideId = `override-mode-${Date.now()}`;
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts_pct: { soft: 51, hard: 63, ouch: 85 },
      session_id: overrideId,
    };
    writeConfig(overrideId, config);

    // Don't set env — pass session_id in params
    delete process.env.CLAUDE_SESSION_ID;
    const result = await handleMode({ session_id: overrideId });

    expect(result).toContain("Current mode: ultraviolence");

    try { rmSync(configPath(overrideId), { force: true }); } catch { /* ignore */ }
  });

  test("mode returns current mode from existing config", async () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts_pct: { soft: 51, hard: 63, ouch: 85 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const result = await handleMode({});

    expect(result).toContain("Current mode: ultraviolence");
    expect(result).toContain("reseed automatically at the ouch dart");
  });

  test("mode sets valid mode — ultraviolence", async () => {
    writeConfig(testSessionId, {
      ...DEFAULTS,
      mode: "not-too-rough",
      session_id: testSessionId,
    });

    const result = await handleMode({ mode: "ultraviolence" });

    expect(result).toContain("Mode set: ultraviolence");
    expect(result).toContain("reseed automatically at the ouch dart");

    // Verify config was actually written
    const config = readConfig(testSessionId);
    expect(config.mode).toBe("ultraviolence");
  });

  test("mode sets valid mode — not-too-rough", async () => {
    const result = await handleMode({ mode: "not-too-rough" });

    expect(result).toContain("Mode set: not-too-rough");
    expect(result).toContain("at the ouch dart, remind only");

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
    expect(result).toContain("at the ouch dart, ask before reseeding");

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

  test("every mode round-trips and prints its description, with no crystallizer line", async () => {
    for (const [mode, description] of Object.entries(MODE_DESCRIPTIONS)) {
      const result = await handleMode({ mode });
      expect(result).toContain(`Description: ${description}`);
      expect(result).not.toContain("CRYSTALLIZE");
      expect(readConfig(testSessionId).mode).toBe(mode as NerfConfig["mode"]);
    }
  });

  test("mode preserves existing dart config when setting mode", async () => {
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts_pct: { soft: 40, hard: 55, ouch: 70 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    await handleMode({ mode: "ultraviolence" });

    const updated = readConfig(testSessionId);
    expect(updated.mode).toBe("ultraviolence");
    // Darts should be preserved
    expect(updated.darts_pct.soft).toBe(40);
    expect(updated.darts_pct.hard).toBe(55);
    expect(updated.darts_pct.ouch).toBe(70);
  });
});
