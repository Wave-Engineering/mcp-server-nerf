/**
 * Regression tests for session.ts — session ID resolution.
 *
 * Covers issue #24: the previous /tmp self-debris scan returned a fake
 * 12-char-hex md5(pid-ppid) ID forever once written. The new resolver reads
 * from the per-project transcript dir under ~/.claude/projects/ — Claude Code
 * writes those files itself, so the source of truth cannot be self-poisoned.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSessionId, resolveFromTranscripts, projectSlug } from "../session.ts";

const SESSION_A = "991053c7-f9e4-4840-b906-d0252650793e";
const SESSION_B = "44c9b97f-ac26-4fe8-be6f-45466b0b265e";
const SESSION_C = "5044048d-1cf7-4497-b9d7-66b78bc9d188";

function writeTranscript(projectsDir: string, project: string, sessionId: string, mtimeMs: number): void {
  const projDir = join(projectsDir, project);
  mkdirSync(projDir, { recursive: true });
  const path = join(projDir, `${sessionId}.jsonl`);
  writeFileSync(path, "");
  const seconds = mtimeMs / 1000;
  utimesSync(path, seconds, seconds);
}

describe("projectSlug", () => {
  test("replaces all forward slashes with dashes", () => {
    expect(projectSlug("/home/bakerb/sandbox/github/foo")).toBe("-home-bakerb-sandbox-github-foo");
  });

  test("handles single-component absolute path", () => {
    expect(projectSlug("/foo")).toBe("-foo");
  });

  test("preserves dashes already in the path", () => {
    expect(projectSlug("/home/user/my-project")).toBe("-home-user-my-project");
  });
});

describe("resolveFromTranscripts (issue #24)", () => {
  let projectsDir: string;
  const CWD = "/home/test/project-a";
  const SLUG = "-home-test-project-a";

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "nerf-session-projects-"));
  });

  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test("returns null when project dir does not exist for this cwd", () => {
    expect(resolveFromTranscripts(projectsDir, CWD)).toBeNull();
  });

  test("returns null when project dir is empty", () => {
    mkdirSync(join(projectsDir, SLUG), { recursive: true });
    expect(resolveFromTranscripts(projectsDir, CWD)).toBeNull();
  });

  test("returns the session ID from a single transcript", () => {
    writeTranscript(projectsDir, SLUG, SESSION_A, Date.now());
    expect(resolveFromTranscripts(projectsDir, CWD)).toBe(SESSION_A);
  });

  test("returns newest by mtime within this project", () => {
    const now = Date.now();
    writeTranscript(projectsDir, SLUG, SESSION_A, now - 30_000);
    writeTranscript(projectsDir, SLUG, SESSION_B, now);
    writeTranscript(projectsDir, SLUG, SESSION_C, now - 60_000);
    expect(resolveFromTranscripts(projectsDir, CWD)).toBe(SESSION_B);
  });

  test("ignores transcripts in other project directories (multi-session isolation)", () => {
    // Critical regression check: when the user has concurrent CC sessions
    // in different projects, the resolver MUST scope to its own cwd, not pick
    // up the freshest transcript across the entire fleet.
    const now = Date.now();
    writeTranscript(projectsDir, SLUG, SESSION_A, now - 60_000);
    writeTranscript(projectsDir, "-home-test-other-project", SESSION_B, now); // newer but wrong project
    expect(resolveFromTranscripts(projectsDir, CWD)).toBe(SESSION_A);
  });

  test("ignores non-UUID-shaped basenames (debris)", () => {
    // Old fallback IDs were 12-char hex like 81457c8d97e2 — must not be picked up
    // even if a stray file ends up in a project dir.
    writeTranscript(projectsDir, SLUG, "81457c8d97e2", Date.now());
    expect(resolveFromTranscripts(projectsDir, CWD)).toBeNull();
  });

  test("ignores non-jsonl files", () => {
    const projDir = join(projectsDir, SLUG);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, `${SESSION_A}.json`), "");
    writeFileSync(join(projDir, `${SESSION_A}.txt`), "");
    expect(resolveFromTranscripts(projectsDir, CWD)).toBeNull();
  });

  test("UUID-shaped match wins over debris with newer mtime", () => {
    const now = Date.now();
    writeTranscript(projectsDir, SLUG, SESSION_A, now - 60_000);
    writeTranscript(projectsDir, SLUG, "abcd1234ef56", now); // newer debris, ignored
    expect(resolveFromTranscripts(projectsDir, CWD)).toBe(SESSION_A);
  });
});

describe("resolveSessionId (issue #24)", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.CLAUDE_SESSION_ID;
    delete process.env.CLAUDE_SESSION_ID;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CLAUDE_SESSION_ID;
    } else {
      process.env.CLAUDE_SESSION_ID = savedEnv;
    }
  });

  test("explicit override beats env var", () => {
    process.env.CLAUDE_SESSION_ID = SESSION_B;
    expect(resolveSessionId(SESSION_A)).toBe(SESSION_A);
  });

  test("env var beats transcript scan", () => {
    process.env.CLAUDE_SESSION_ID = SESSION_A;
    expect(resolveSessionId()).toBe(SESSION_A);
  });

  test("fallback fires with 12-char hex ID when no transcript exists for this cwd", () => {
    // Force the resolver into the fallback path with an empty projectsDir +
    // a cwd that has no transcripts. This is the path that USED to be the
    // only thing that fired (the bug); now it must be a true last resort.
    const emptyProjectsDir = mkdtempSync(join(tmpdir(), "nerf-fallback-empty-"));
    try {
      const id = resolveSessionId(undefined, emptyProjectsDir, "/home/test/no-transcripts");
      expect(id).toMatch(/^[0-9a-f]{12}$/);
    } finally {
      try { rmSync(emptyProjectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test("transcript scan beats fallback when a transcript is present", () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "nerf-resolve-"));
    const cwd = "/home/test/project-x";
    const slug = "-home-test-project-x";
    try {
      writeTranscript(projectsDir, slug, SESSION_A, Date.now());
      const id = resolveSessionId(undefined, projectsDir, cwd);
      expect(id).toBe(SESSION_A);
    } finally {
      try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
