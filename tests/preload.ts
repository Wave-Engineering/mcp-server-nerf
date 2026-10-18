/**
 * Test preload (bunfig.toml `[test] preload`).
 *
 * Every nerf tool handler repaints the statusline indicator, which resolves an
 * agent identity from the project root and writes /tmp/claude-statusline-<name>.json.
 * Run from a real checkout, that is the developer's identity and their LIVE
 * statusline. Point the whole run at an empty temp root instead; suites that
 * need an identity set NERF_PROJECT_ROOT to their own root and restore this
 * one afterwards. tests/preload.guard.test.ts fails the run if this file was
 * not loaded.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "nerf-test-root-"));
process.env.NERF_PROJECT_ROOT = root;
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
