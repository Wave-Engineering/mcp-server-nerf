/**
 * Guard: tests/preload.ts must have run. Without it the handler suites resolve
 * the developer's real identity and write into their live statusline, and the
 * setters write the developer's real `.claude/nerf.json` and live
 * /tmp/nerf-*.json. CI would not notice (CI runners have no identity and no
 * live state). Fail loudly instead.
 */

import { test, expect } from "bun:test";
import { configPath, projectConfigPath } from "../config.ts";

test("the test preload pointed nerf at a temp project root", () => {
  expect(process.env.NERF_PROJECT_ROOT ?? "").toMatch(/nerf-test-root-/);
});

test("the test preload pointed nerf at a temp config directory", () => {
  expect(process.env.NERF_CONFIG_DIR ?? "").toMatch(/nerf-test-config-/);
});

test("config paths resolve inside the preload's temp directories", () => {
  expect(configPath("guard")).toBe(`${process.env.NERF_CONFIG_DIR}/nerf-guard.json`);
  expect(projectConfigPath()).toBe(`${process.env.NERF_PROJECT_ROOT}/.claude/nerf.json`);
});
