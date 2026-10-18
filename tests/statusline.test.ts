/**
 * Unit tests for statusline.ts — Statusline indicator helpers.
 *
 * Tests use real filesystem operations with temp files.
 * The addIndicatorToFile/removeIndicatorFromFile overloads are tested
 * directly to avoid needing agent identity files for every test.
 * resolveDevName is tested with a mock agent file.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  addIndicatorToFile,
  removeIndicatorFromFile,
  resolveDevName,
  resolveProjectRoot,
  resolveStatuslineFile,
} from "../statusline.ts";

describe("statusline", () => {
  let tempDir: string;
  let statusFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nerf-statusline-test-"));
    statusFile = join(tempDir, "statusline.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("addIndicatorToFile creates file with indicator array", () => {
    addIndicatorToFile(statusFile, "nerf:active");

    expect(existsSync(statusFile)).toBe(true);
    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual(["nerf:active"]);
  });

  test("addIndicatorToFile is idempotent", () => {
    addIndicatorToFile(statusFile, "nerf:active");
    addIndicatorToFile(statusFile, "nerf:active");

    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual(["nerf:active"]);
  });

  test("removeIndicatorFromFile cleans up matching indicators", () => {
    addIndicatorToFile(statusFile, "nerf:active");
    addIndicatorToFile(statusFile, "nerf:scope");
    removeIndicatorFromFile(statusFile, "nerf:active");

    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual(["nerf:scope"]);
  });

  test("removeIndicatorFromFile removes by prefix", () => {
    addIndicatorToFile(statusFile, "nerf:active");
    addIndicatorToFile(statusFile, "nerf:scope");
    addIndicatorToFile(statusFile, "wtf:investigating");
    removeIndicatorFromFile(statusFile, "nerf:");

    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual(["wtf:investigating"]);
  });

  test("multiple indicators from different sources coexist", () => {
    addIndicatorToFile(statusFile, "nerf:active");
    addIndicatorToFile(statusFile, "wtf:investigating");
    addIndicatorToFile(statusFile, "cryo:freezing");

    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toHaveLength(3);
    expect(data.indicators).toContain("nerf:active");
    expect(data.indicators).toContain("wtf:investigating");
    expect(data.indicators).toContain("cryo:freezing");
  });

  test("removeIndicatorFromFile on empty file is safe", () => {
    // File doesn't exist yet — should not throw
    removeIndicatorFromFile(statusFile, "nerf:");
    expect(existsSync(statusFile)).toBe(true);
    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual([]);
  });

  test("addIndicatorToFile preserves existing indicators from other sources", () => {
    // Pre-populate with an existing indicator
    writeFileSync(
      statusFile,
      JSON.stringify({ indicators: ["wtf:active"] }),
      "utf-8"
    );

    addIndicatorToFile(statusFile, "nerf:monitoring");

    const data = JSON.parse(readFileSync(statusFile, "utf-8"));
    expect(data.indicators).toEqual(["wtf:active", "nerf:monitoring"]);
  });

  test("resolveProjectRoot returns a string", () => {
    const root = resolveProjectRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  test("NERF_PROJECT_ROOT overrides the git root, and resolveDevName() follows it", () => {
    const root = mkdtempSync(join(tmpdir(), "nerf-override-root-"));
    const tmpAgentFile = `/tmp/claude-agent-${createHash("md5").update(root).digest("hex")}.json`;
    const suiteRootBefore = process.env.NERF_PROJECT_ROOT;
    process.env.NERF_PROJECT_ROOT = root;
    try {
      expect(resolveProjectRoot()).toBe(root);
      expect(resolveDevName()).toBeNull();
      writeFileSync(tmpAgentFile, JSON.stringify({ dev_name: "test-nerf-agent" }), "utf-8");
      expect(resolveDevName()).toBe("test-nerf-agent");
    } finally {
      process.env.NERF_PROJECT_ROOT = suiteRootBefore;
      rmSync(tmpAgentFile, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe("identity resolution order (#35)", () => {
    let root: string;
    let tmpAgentFile: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "nerf-ident-"));
      tmpAgentFile = `/tmp/claude-agent-${createHash("md5").update(root).digest("hex")}.json`;
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(tmpAgentFile, { force: true });
    });

    function writeDurable(devName: string): void {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", "agent-identity.json"), JSON.stringify({ dev_name: devName }));
    }

    test("durable .claude/agent-identity.json alone is enough (after a reboot wipes /tmp)", () => {
      writeDurable("durable-agent");
      expect(resolveDevName(root)).toBe("durable-agent");
    });

    test("durable wins over a disagreeing /tmp copy", () => {
      writeDurable("durable-agent");
      writeFileSync(tmpAgentFile, JSON.stringify({ dev_name: "stale-tmp-agent" }));
      expect(resolveDevName(root)).toBe("durable-agent");
    });

    test("falls back to the /tmp copy when there is no durable file", () => {
      writeFileSync(tmpAgentFile, JSON.stringify({ dev_name: "tmp-agent" }));
      expect(resolveDevName(root)).toBe("tmp-agent");
    });

    test("neither file → null", () => {
      expect(resolveDevName(root)).toBeNull();
    });

    test("an empty dev_name is null, not an empty-string statusline path", () => {
      writeDurable("");
      expect(resolveDevName(root)).toBeNull();
    });
  });

  test("resolveStatuslineFile returns path or null", () => {
    const result = resolveStatuslineFile();
    if (result !== null) {
      expect(result).toMatch(/^\/tmp\/claude-statusline-.+\.json$/);
    }
    // null is also acceptable if no agent file exists
    expect(result === null || typeof result === "string").toBe(true);
  });
});
