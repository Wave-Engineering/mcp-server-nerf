/**
 * Test preload (bunfig.toml `[test] preload`).
 *
 * Every nerf tool handler repaints the statusline indicator, which resolves an
 * agent identity from the project root and writes /tmp/claude-statusline-<name>.json.
 * Run from a real checkout, that is the developer's identity and their LIVE
 * statusline. Point the whole run at an empty temp root instead; suites that
 * need an identity set NERF_PROJECT_ROOT to their own root and restore this
 * one afterwards.
 *
 * The same goes for the config itself (#45): the setters write
 * `<project>/.claude/nerf.json` and the per-session file
 * `${NERF_CONFIG_DIR:-/tmp}/nerf-<session_id>.json`. NERF_CONFIG_DIR points at a
 * fresh temp directory, so no test touches a live /tmp/nerf-*.json, and the
 * project file lands in the temp root, never in the real checkout's `.claude`.
 * The project file is project-wide state that outlives a session id, so it is
 * removed before every test: one test's settings must not leak into the next.
 *
 * tests/preload.guard.test.ts fails the run if this file was not loaded.
 */

import { afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "nerf-test-root-"));
const configDir = mkdtempSync(join(tmpdir(), "nerf-test-config-"));
process.env.NERF_PROJECT_ROOT = root;
process.env.NERF_CONFIG_DIR = configDir;

beforeEach(() => {
  rmSync(join(root, ".claude", "nerf.json"), { force: true });
});

const removeTempDirs = () => {
  rmSync(root, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
};
// `bun test` does not reliably fire a preload's `exit` listener, so also clean
// up when the last test file is done.
afterAll(removeTempDirs);
process.on("exit", removeTempDirs);
