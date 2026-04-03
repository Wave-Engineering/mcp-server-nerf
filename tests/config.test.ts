/**
 * Unit tests for config.ts — Config I/O module.
 *
 * Tests use real filesystem operations in a temp directory.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readConfig,
  writeConfig,
  configPath,
  DEFAULTS,
  MODE_MAP,
  type NerfConfig,
} from "../config.ts";

/**
 * We test readConfig/writeConfig by creating a unique session ID per test
 * that maps to /tmp/nerf-<id>.json. After each test we clean up.
 */
describe("config", () => {
  let testSessionId: string;

  beforeEach(() => {
    testSessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(() => {
    const path = configPath(testSessionId);
    try {
      rmSync(path, { force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(`${path}.tmp`, { force: true });
    } catch {
      // ignore
    }
  });

  test("configPath returns correct path", () => {
    expect(configPath("abc123")).toBe("/tmp/nerf-abc123.json");
  });

  test("readConfig returns defaults when no file exists", () => {
    const config = readConfig(testSessionId);
    expect(config.mode).toBe(DEFAULTS.mode);
    expect(config.darts.soft).toBe(DEFAULTS.darts.soft);
    expect(config.darts.hard).toBe(DEFAULTS.darts.hard);
    expect(config.darts.ouch).toBe(DEFAULTS.darts.ouch);
    expect(config.session_id).toBe(testSessionId);
  });

  test("writeConfig creates a valid JSON file", () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts: { soft: 100_000, hard: 130_000, ouch: 180_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const path = configPath(testSessionId);
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.mode).toBe("ultraviolence");
    expect(parsed.darts.soft).toBe(100_000);
  });

  test("readConfig round-trips with writeConfig", () => {
    const config: NerfConfig = {
      mode: "not-too-rough",
      darts: { soft: 80_000, hard: 100_000, ouch: 150_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);
    const read = readConfig(testSessionId);
    expect(read).toEqual(config);
  });

  test("readConfig merges partial config with defaults", () => {
    // Write a partial config (missing darts.hard and mode)
    const path = configPath(testSessionId);
    const partial = {
      darts: { soft: 90_000, ouch: 170_000 },
      session_id: testSessionId,
    };
    const { writeFileSync } = require("node:fs");
    writeFileSync(path, JSON.stringify(partial), "utf-8");

    const config = readConfig(testSessionId);
    expect(config.mode).toBe(DEFAULTS.mode); // filled from defaults
    expect(config.darts.soft).toBe(90_000); // from file
    expect(config.darts.hard).toBe(DEFAULTS.darts.hard); // filled from defaults
    expect(config.darts.ouch).toBe(170_000); // from file
  });

  test("writeConfig is atomic (no .tmp file remains)", () => {
    const config: NerfConfig = {
      mode: "hurt-me-plenty",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const tmpPath = `${configPath(testSessionId)}.tmp`;
    expect(existsSync(tmpPath)).toBe(false);
    expect(existsSync(configPath(testSessionId))).toBe(true);
  });

  test("DEFAULTS match crystallizer schema shape", () => {
    // Verify the config shape has the fields the crystallizer expects
    expect(DEFAULTS).toHaveProperty("mode");
    expect(DEFAULTS).toHaveProperty("darts");
    expect(DEFAULTS).toHaveProperty("session_id");
    expect(DEFAULTS.darts).toHaveProperty("soft");
    expect(DEFAULTS.darts).toHaveProperty("hard");
    expect(DEFAULTS.darts).toHaveProperty("ouch");
    expect(typeof DEFAULTS.mode).toBe("string");
    expect(typeof DEFAULTS.darts.soft).toBe("number");
    expect(typeof DEFAULTS.darts.hard).toBe("number");
    expect(typeof DEFAULTS.darts.ouch).toBe("number");
  });

  test("MODE_MAP has correct mappings", () => {
    expect(MODE_MAP["not-too-rough"]).toBe("manual");
    expect(MODE_MAP["hurt-me-plenty"]).toBe("prompt");
    expect(MODE_MAP["ultraviolence"]).toBe("yolo");
  });
});
