/**
 * Guard: tests/preload.ts must have run. Without it the handler suites resolve
 * the developer's real identity and write into their live statusline, and CI
 * would not notice (CI runners have no identity). Fail loudly instead.
 */

import { test, expect } from "bun:test";

test("the test preload pointed nerf at a temp project root", () => {
  expect(process.env.NERF_PROJECT_ROOT ?? "").toMatch(/nerf-test-root-/);
});
