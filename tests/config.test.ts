/**
 * Unit tests for config.ts — Config I/O module.
 *
 * Tests use real filesystem operations in a temp directory.
 * No mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  readConfig,
  writeConfig,
  configPath,
  DEFAULTS,
  MODE_DESCRIPTIONS,
  SOFT_RATIO,
  HARD_RATIO,
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
    rmSync(path, { force: true });
    rmSync(`${path}.tmp`, { force: true });
  });

  test("configPath returns correct path", () => {
    expect(configPath("abc123")).toBe("/tmp/nerf-abc123.json");
  });

  test("readConfig returns defaults when no file exists", () => {
    const config = readConfig(testSessionId);
    expect(config.mode).toBe(DEFAULTS.mode);
    expect(config.darts_pct).toEqual(DEFAULTS.darts_pct);
    expect(config.session_id).toBe(testSessionId);
  });

  test("writeConfig creates a valid JSON file under darts_pct", () => {
    const config: NerfConfig = {
      mode: "ultraviolence",
      darts_pct: { soft: 40, hard: 55, ouch: 70 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);

    const path = configPath(testSessionId);
    expect(existsSync(path)).toBe(true);

    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.mode).toBe("ultraviolence");
    expect(parsed.darts_pct.soft).toBe(40);
    // The statusline reads `darts` as token counts; it must never see percentages there.
    expect(parsed.darts).toBeUndefined();
  });

  test("readConfig round-trips with writeConfig", () => {
    const config: NerfConfig = {
      mode: "not-too-rough",
      darts_pct: { soft: 30, hard: 50, ouch: 80 },
      session_id: testSessionId,
    };
    writeConfig(testSessionId, config);
    expect(readConfig(testSessionId)).toEqual(config);
  });

  test("readConfig merges partial config with defaults", () => {
    const partial = {
      darts_pct: { soft: 45, ouch: 90 },
      session_id: testSessionId,
    };
    writeFileSync(configPath(testSessionId), JSON.stringify(partial), "utf-8");

    const config = readConfig(testSessionId);
    expect(config.mode).toBe(DEFAULTS.mode);
    expect(config.darts_pct.soft).toBe(45);
    expect(config.darts_pct.hard).toBe(DEFAULTS.darts_pct.hard);
    expect(config.darts_pct.ouch).toBe(90);
  });

  test("legacy absolute darts are migrated: ignored, percentage defaults apply", () => {
    const legacy = {
      mode: "ultraviolence",
      darts: { soft: 120_000, hard: 150_000, ouch: 200_000 },
      session_id: testSessionId,
    };
    writeFileSync(configPath(testSessionId), JSON.stringify(legacy), "utf-8");

    const config = readConfig(testSessionId);
    expect(config.mode).toBe("ultraviolence");
    expect(config.darts_pct).toEqual(DEFAULTS.darts_pct);
  });

  test("the first write after migration drops the legacy darts key", () => {
    writeFileSync(
      configPath(testSessionId),
      JSON.stringify({ darts: { soft: 1, hard: 2, ouch: 3 }, session_id: testSessionId }),
      "utf-8",
    );
    writeConfig(testSessionId, readConfig(testSessionId));
    const parsed = JSON.parse(readFileSync(configPath(testSessionId), "utf-8"));
    expect(parsed.darts).toBeUndefined();
    expect(parsed.darts_pct).toEqual(DEFAULTS.darts_pct);
  });

  test("writeConfig is atomic (no .tmp file remains)", () => {
    writeConfig(testSessionId, { ...DEFAULTS, session_id: testSessionId });
    expect(existsSync(`${configPath(testSessionId)}.tmp`)).toBe(false);
    expect(existsSync(configPath(testSessionId))).toBe(true);
  });

  test("DEFAULTS are budget(85): the reseed gate's 15% remaining at ouch", () => {
    const { soft, hard, ouch } = DEFAULTS.darts_pct;
    expect(ouch).toBe(85);
    expect(soft).toBe(Math.floor(ouch * SOFT_RATIO));
    expect(hard).toBe(Math.floor(ouch * HARD_RATIO));
    expect(soft).toBeLessThan(hard);
    expect(hard).toBeLessThan(ouch);
  });

  // claudecode-workflow#1352: the reseed gate reads a missing file as ultraviolence,
  // so nerf's own default must agree or a written default would flip it to asking.
  test("a session with no config file reads ultraviolence", () => {
    expect(DEFAULTS.mode).toBe("ultraviolence");
    expect(readConfig(testSessionId).mode).toBe("ultraviolence");
  });

  test("an explicit hurt-me-plenty file still reads back as written", () => {
    writeFileSync(
      configPath(testSessionId),
      JSON.stringify({ mode: "hurt-me-plenty", session_id: testSessionId }),
      "utf-8",
    );
    expect(readConfig(testSessionId).mode).toBe("hurt-me-plenty");
  });

  test("every mode has a description, and none mentions the retired crystallizer", () => {
    for (const mode of ["not-too-rough", "hurt-me-plenty", "ultraviolence"] as const) {
      expect(MODE_DESCRIPTIONS[mode]).toContain("ouch dart");
      expect(MODE_DESCRIPTIONS[mode].toLowerCase()).not.toContain("crystalliz");
    }
  });
});
