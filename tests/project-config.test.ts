/**
 * Tests for the project config file (#45): `<project>/.claude/nerf.json`
 * beside `agent-identity.json`, so mode and darts survive a /clear, a reseed,
 * a compact, a restart and a reboot.
 *
 * Every test builds its own project root and its own NERF_CONFIG_DIR under the
 * OS temp directory and restores the preload's values afterwards. Nothing
 * here reads or writes a live /tmp/nerf-*.json or a real checkout's `.claude`.
 * Real filesystem operations and a real `git`; no mocking of internal modules.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULTS,
  configPath,
  projectConfigPath,
  readConfig,
  selectConfigFile,
  writeConfig,
  type NerfConfig,
} from "../config.ts";
import { handleBudget } from "../budget.ts";
import { handleDarts } from "../darts.ts";
import { handleMode } from "../mode.ts";
import { handleStatus } from "../status.ts";
import { refreshIndicatorCommand, renderWatchFrame } from "../cli.ts";
import { updateStatuslineIndicator } from "../indicator.ts";

const ENV_KEYS = ["NERF_PROJECT_ROOT", "NERF_CONFIG_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"] as const;

let root: string;
let cfgDir: string;
let saved: Record<string, string | undefined>;
let sid: string;
const cleanup: string[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  root = mkdtempSync(join(tmpdir(), "nerf-pc-root-"));
  cfgDir = mkdtempSync(join(tmpdir(), "nerf-pc-config-"));
  process.env.NERF_PROJECT_ROOT = root;
  process.env.NERF_CONFIG_DIR = cfgDir;
  // Keep git hermetic: no user or system config (a global excludes file, a signing key, hooks).
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  sid = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const dir of [root, cfgDir, ...cleanup.splice(0)]) {
    try {
      chmodSync(join(dir, ".claude"), 0o755);
    } catch {
      /* not there */
    }
    try {
      chmodSync(dir, 0o755);
    } catch {
      /* not there */
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const cfg = (over: Partial<NerfConfig> = {}): NerfConfig => ({
  mode: "hurt-me-plenty",
  darts_pct: { soft: 35, hard: 37, ouch: 40 },
  session_id: sid,
  ...over,
});

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

/** Set a file's mtime to `epochSeconds`. */
function setMtime(path: string, epochSeconds: number): void {
  utimesSync(path, epochSeconds, epochSeconds);
}

/** Write a raw config file, creating its directory. */
function put(path: string, body: unknown, mtime?: number): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), "utf-8");
  if (mtime !== undefined) setMtime(path, mtime);
}

const projectBody = { mode: "not-too-rough", darts_pct: { soft: 11, hard: 22, ouch: 33 } };
const legacyBody = () => ({
  mode: "ultraviolence",
  darts_pct: { soft: 44, hard: 55, ouch: 66 },
  session_id: sid,
});

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });

function gitInit(dir: string): void {
  expect(git(dir, "init", "-q").status).toBe(0);
}

const cannotChmodAway = process.getuid?.() === 0;

describe("selecting the file to read (the kit's nerf_config_file rule)", () => {
  test("project file only: its settings are read, session_id comes from the argument", () => {
    put(projectConfigPath(), projectBody);
    const c = readConfig(sid);
    expect(c.mode).toBe("not-too-rough");
    expect(c.darts_pct).toEqual({ soft: 11, hard: 22, ouch: 33 });
    expect(c.session_id).toBe(sid);
  });

  test("legacy file only: read as before", () => {
    put(configPath(sid), legacyBody());
    expect(readConfig(sid).darts_pct).toEqual({ soft: 44, hard: 55, ouch: 66 });
    expect(selectConfigFile(sid)).toBe(configPath(sid));
  });

  test("neither file: the defaults, and nothing is created", () => {
    const c = readConfig(sid);
    expect(c).toEqual({ ...DEFAULTS, session_id: sid });
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(readdirSync(cfgDir)).toEqual([]);
  });

  test("both, the legacy file newer: the legacy file wins", () => {
    put(projectConfigPath(), projectBody, 1_700_000_000);
    put(configPath(sid), legacyBody(), 1_700_000_100);
    expect(selectConfigFile(sid)).toBe(configPath(sid));
    expect(readConfig(sid).darts_pct.ouch).toBe(66);
  });

  test("both, the project file newer: the project file wins", () => {
    put(projectConfigPath(), projectBody, 1_700_000_100);
    put(configPath(sid), legacyBody(), 1_700_000_000);
    expect(selectConfigFile(sid)).toBe(projectConfigPath());
    expect(readConfig(sid).darts_pct.ouch).toBe(33);
  });

  test("a tie goes to the project file", () => {
    put(projectConfigPath(), projectBody, 1_700_000_000);
    put(configPath(sid), legacyBody(), 1_700_000_000);
    expect(selectConfigFile(sid)).toBe(projectConfigPath());
    expect(readConfig(sid).darts_pct.ouch).toBe(33);
  });

  test("a difference under a second still decides (sub-second mtimes)", () => {
    put(projectConfigPath(), projectBody);
    put(configPath(sid), legacyBody());
    utimesSync(projectConfigPath(), 1_700_000_000, 1_700_000_000.2);
    utimesSync(configPath(sid), 1_700_000_000, 1_700_000_000.4);
    expect(selectConfigFile(sid)).toBe(configPath(sid));
  });

  test.skipIf(cannotChmodAway)("an unreadable project file falls back to the legacy file, even an older one", () => {
    put(projectConfigPath(), projectBody, 1_700_000_100);
    put(configPath(sid), legacyBody(), 1_700_000_000);
    chmodSync(projectConfigPath(), 0o000);
    expect(selectConfigFile(sid)).toBe(configPath(sid));
    expect(readConfig(sid).darts_pct.ouch).toBe(66);
  });

  test("a directory at the project path falls back to the legacy file", () => {
    mkdirSync(projectConfigPath(), { recursive: true });
    put(configPath(sid), legacyBody());
    expect(selectConfigFile(sid)).toBe(configPath(sid));
    expect(readConfig(sid).darts_pct.ouch).toBe(66);
  });

  test("a symlink to a regular file counts as the project file", () => {
    const target = join(cfgDir, "elsewhere.json");
    put(target, projectBody);
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync(target, projectConfigPath());
    expect(readConfig(sid).darts_pct.ouch).toBe(33);
  });

  test("an unsafe or empty session id still resolves the project file", () => {
    put(projectConfigPath(), projectBody);
    for (const bad of ["", "../escape", "a/b", "has space", "dot.dot"]) {
      expect(selectConfigFile(bad)).toBe(projectConfigPath());
      const c = readConfig(bad);
      expect(c.darts_pct.ouch).toBe(33);
      expect(c.session_id).toBe(bad);
    }
  });

  test("an unsafe session id never reaches for a legacy file", () => {
    expect(selectConfigFile("../escape")).toBeNull();
    expect(readConfig("../escape")).toEqual({ ...DEFAULTS, session_id: "../escape" });
  });

  test("a malformed project file reads as the defaults, and the next write replaces it", () => {
    put(projectConfigPath(), "{ not json", 1_700_000_100);
    put(configPath(sid), legacyBody(), 1_700_000_000);
    // The chosen file is the malformed project file: the defaults, as the kit reads it.
    expect(readConfig(sid)).toEqual({ ...DEFAULTS, session_id: sid });

    writeConfig(sid, cfg());
    expect(readJson(projectConfigPath())).toEqual({ mode: "hurt-me-plenty", darts_pct: { soft: 35, hard: 37, ouch: 40 } });
    expect(readConfig(sid).darts_pct.ouch).toBe(40);
  });

  test("a project file with missing keys fills them per key from the defaults", () => {
    put(projectConfigPath(), { darts_pct: { soft: 45, ouch: 90 } });
    const c = readConfig(sid);
    expect(c.mode).toBe(DEFAULTS.mode);
    expect(c.darts_pct).toEqual({ soft: 45, hard: DEFAULTS.darts_pct.hard, ouch: 90 });
  });
});

describe("writing: the project file first, then the legacy file", () => {
  test("writeConfig creates .claude/ and writes both files; only the legacy one has a session_id", () => {
    expect(existsSync(join(root, ".claude"))).toBe(false);
    writeConfig(sid, cfg());
    expect(readJson(projectConfigPath())).toEqual({ mode: "hurt-me-plenty", darts_pct: { soft: 35, hard: 37, ouch: 40 } });
    expect(readJson(configPath(sid))).toEqual({
      mode: "hurt-me-plenty",
      darts_pct: { soft: 35, hard: 37, ouch: 40 },
      session_id: sid,
    });
    // Pretty-printed with a trailing newline, like the legacy file always was.
    expect(readFileSync(projectConfigPath(), "utf-8")).toBe(
      JSON.stringify({ mode: "hurt-me-plenty", darts_pct: { soft: 35, hard: 37, ouch: 40 } }, null, 2) + "\n",
    );
  });

  test("the project file is written first, so the legacy file is newer or equal", () => {
    for (let i = 0; i < 5; i++) {
      writeConfig(sid, cfg());
      const p = statSync(projectConfigPath(), { bigint: true }).mtimeNs;
      const l = statSync(configPath(sid), { bigint: true }).mtimeNs;
      expect(l >= p).toBe(true);
    }
  });

  // File times tick every few milliseconds, so two small writes in a row often
  // share one and the order cannot show. A large payload makes each write take
  // several ticks: the file written second is then strictly newer.
  test("the order is project first, legacy second: the legacy file is strictly newer", () => {
    const huge = "x".repeat(32 * 1024 * 1024) as NerfConfig["mode"];
    writeConfig(sid, cfg({ mode: huge }));
    const p = statSync(projectConfigPath(), { bigint: true }).mtimeNs;
    const l = statSync(configPath(sid), { bigint: true }).mtimeNs;
    expect(l > p).toBe(true);
    // And the kit, reading the pair, therefore finds the legacy file, which has the same content.
    expect(selectConfigFile(sid)).toBe(configPath(sid));
  });

  test("a legacy `darts` key is dropped from both files on write", () => {
    put(configPath(sid), { darts: { soft: 1, hard: 2, ouch: 3 }, session_id: sid });
    writeConfig(sid, readConfig(sid));
    expect(readJson(projectConfigPath()).darts).toBeUndefined();
    expect(readJson(configPath(sid)).darts).toBeUndefined();
  });

  test("atomic: no .tmp file is left in either directory", () => {
    writeConfig(sid, cfg());
    writeConfig(sid, cfg({ mode: "not-too-rough" }));
    expect(readdirSync(join(root, ".claude")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(cfgDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(join(root, ".claude"))).toEqual(["nerf.json"]);
  });

  test("a symlinked nerf.json is replaced, not written through", () => {
    const target = join(cfgDir, "shared.json");
    put(target, projectBody);
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync(target, projectConfigPath());

    writeConfig(sid, cfg());

    expect(lstatSync(projectConfigPath()).isSymbolicLink()).toBe(false);
    expect(readJson(projectConfigPath()).darts_pct.ouch).toBe(40);
    expect(readJson(target)).toEqual(projectBody);
  });

  test("an unsafe session id: the project file is written, the legacy file is not, the call succeeds", () => {
    writeConfig("../escape", cfg({ session_id: "../escape" }));
    expect(readJson(projectConfigPath()).darts_pct.ouch).toBe(40);
    expect(readdirSync(cfgDir)).toEqual([]);
    expect(existsSync(join(cfgDir, "..", "nerf-escape.json"))).toBe(false);
  });

  test.skipIf(cannotChmodAway)("project directory unwritable: the legacy file is still written and the call succeeds", () => {
    mkdirSync(join(root, ".claude"));
    chmodSync(join(root, ".claude"), 0o500);
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(existsSync(projectConfigPath())).toBe(false);
    expect(readJson(configPath(sid)).darts_pct.ouch).toBe(40);
  });

  test.skipIf(cannotChmodAway)("project root unwritable and no .claude/: same, the legacy file carries it", () => {
    chmodSync(root, 0o500);
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(readJson(configPath(sid)).darts_pct.ouch).toBe(40);
  });

  test("a directory at the project path: the legacy file is still written and no .tmp is left", () => {
    mkdirSync(projectConfigPath(), { recursive: true });
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(statSync(projectConfigPath()).isDirectory()).toBe(true);
    expect(readdirSync(join(root, ".claude")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readJson(configPath(sid)).darts_pct.ouch).toBe(40);
  });

  test.skipIf(cannotChmodAway)("legacy directory unwritable: the project file is written and the call succeeds", () => {
    chmodSync(cfgDir, 0o500);
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(readJson(projectConfigPath()).darts_pct.ouch).toBe(40);
    expect(existsSync(configPath(sid))).toBe(false);
  });

  test.skipIf(cannotChmodAway)("both unwritable: it throws", () => {
    mkdirSync(join(root, ".claude"));
    chmodSync(join(root, ".claude"), 0o500);
    chmodSync(cfgDir, 0o500);
    expect(() => writeConfig(sid, cfg())).toThrow();
  });

  test("an unsafe session id with an unwritable project file throws (nothing could be written)", () => {
    mkdirSync(projectConfigPath(), { recursive: true });
    expect(() => writeConfig("../escape", cfg())).toThrow();
  });
});

describe("survival across a /clear (a new session id)", () => {
  test("darts set under one session id are read under another", async () => {
    await handleDarts({ session_id: `${sid}-A`, soft: 35, hard: 37, ouch: 40 });
    const c = readConfig(`${sid}-B`);
    expect(c.darts_pct).toEqual({ soft: 35, hard: 37, ouch: 40 });
    expect(c.session_id).toBe(`${sid}-B`);
  });

  test("setting the mode after a /clear keeps the project's darts (no reset to the defaults)", async () => {
    await handleDarts({ session_id: `${sid}-A`, soft: 35, hard: 37, ouch: 40 });
    expect(existsSync(configPath(`${sid}-B`))).toBe(false);

    await handleMode({ session_id: `${sid}-B`, mode: "not-too-rough" });

    expect(readJson(projectConfigPath())).toEqual({ mode: "not-too-rough", darts_pct: { soft: 35, hard: 37, ouch: 40 } });
    // Session B's own legacy file carries the same settings, with B's id.
    expect(readJson(configPath(`${sid}-B`))).toEqual({
      mode: "not-too-rough",
      darts_pct: { soft: 35, hard: 37, ouch: 40 },
      session_id: `${sid}-B`,
    });
  });

  test("setting the darts after a /clear keeps the project's mode", async () => {
    await handleMode({ session_id: `${sid}-A`, mode: "hurt-me-plenty" });
    await handleBudget({ session_id: `${sid}-B`, ouch: 80 });
    const c = readConfig(`${sid}-C`);
    expect(c.mode).toBe("hurt-me-plenty");
    expect(c.darts_pct).toEqual({ soft: 48, hard: 60, ouch: 80 });
  });
});

describe("the three setters write both files", () => {
  test("handleMode", async () => {
    await handleMode({ session_id: sid, mode: "hurt-me-plenty" });
    expect(readJson(projectConfigPath())).toEqual({ mode: "hurt-me-plenty", darts_pct: DEFAULTS.darts_pct });
    expect(readJson(configPath(sid))).toEqual({ mode: "hurt-me-plenty", darts_pct: DEFAULTS.darts_pct, session_id: sid });
  });

  test("handleDarts", async () => {
    await handleDarts({ session_id: sid, soft: 20, hard: 30, ouch: 40 });
    const darts = { soft: 20, hard: 30, ouch: 40 };
    expect(readJson(projectConfigPath())).toEqual({ mode: DEFAULTS.mode, darts_pct: darts });
    expect(readJson(configPath(sid))).toEqual({ mode: DEFAULTS.mode, darts_pct: darts, session_id: sid });
  });

  test("handleBudget", async () => {
    await handleBudget({ session_id: sid, ouch: 80 });
    const darts = { soft: 48, hard: 60, ouch: 80 };
    expect(readJson(projectConfigPath())).toEqual({ mode: DEFAULTS.mode, darts_pct: darts });
    expect(readJson(configPath(sid))).toEqual({ mode: DEFAULTS.mode, darts_pct: darts, session_id: sid });
  });

  test("a rejected set writes nothing", async () => {
    await handleMode({ session_id: sid, mode: "bogus" });
    await handleDarts({ session_id: sid, soft: 50, hard: 40, ouch: 30 });
    await handleDarts({ session_id: sid, soft: 50 });
    await handleBudget({ session_id: sid });
    expect(existsSync(projectConfigPath())).toBe(false);
    expect(readdirSync(cfgDir)).toEqual([]);
  });
});

describe("keeping the project file out of git", () => {
  test("in a git checkout the first write leaves git status clean, with exactly one exclude line", () => {
    gitInit(root);
    writeConfig(sid, cfg());
    expect(git(root, "status", "--porcelain", "-uall").stdout).toBe("");
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf-8");
    expect(exclude.split("\n").filter((l) => l === ".claude/nerf.json")).toHaveLength(1);
  });

  test("a second write adds no duplicate line", () => {
    gitInit(root);
    writeConfig(sid, cfg());
    writeConfig(sid, cfg({ mode: "not-too-rough" }));
    writeConfig(sid, cfg({ mode: "ultraviolence" }));
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf-8");
    expect(exclude.split("\n").filter((l) => l.trim() === ".claude/nerf.json")).toHaveLength(1);
    expect(git(root, "status", "--porcelain", "-uall").stdout).toBe("");
  });

  test("an exclude file without a trailing newline keeps its last line", () => {
    gitInit(root);
    writeFileSync(join(root, ".git", "info", "exclude"), "# mine\nscratch/", "utf-8");
    writeConfig(sid, cfg());
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf-8")).toBe("# mine\nscratch/\n.claude/nerf.json\n");
  });

  test("a missing info/exclude is created", () => {
    gitInit(root);
    rmSync(join(root, ".git", "info"), { recursive: true, force: true });
    writeConfig(sid, cfg());
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf-8")).toBe(".claude/nerf.json\n");
    expect(git(root, "status", "--porcelain", "-uall").stdout).toBe("");
  });

  // check-ignore normally stops a second append. A .gitignore that un-ignores the
  // file outranks info/exclude, so check-ignore says "not ignored" even with the
  // line present: the line itself must still never be added twice.
  test("the exclude line is never duplicated, even when check-ignore cannot see it", () => {
    gitInit(root);
    writeFileSync(join(root, ".gitignore"), "!.claude/nerf.json\n", "utf-8");
    writeFileSync(join(root, ".git", "info", "exclude"), ".claude/nerf.json\n", "utf-8");
    writeConfig(sid, cfg());
    writeConfig(sid, cfg());
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf-8");
    expect(exclude.split("\n").filter((l) => l === ".claude/nerf.json")).toHaveLength(1);
  });

  test("a file the project already ignores is left alone", () => {
    gitInit(root);
    writeFileSync(join(root, ".gitignore"), ".claude/\n", "utf-8");
    writeConfig(sid, cfg());
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf-8");
    expect(exclude).not.toContain(".claude/nerf.json");
  });

  test("not a git checkout: nothing is appended anywhere and the write succeeds", () => {
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(readJson(projectConfigPath()).darts_pct.ouch).toBe(40);
  });

  test("in a linked worktree the file is excluded too", () => {
    gitInit(root);
    const commit = git(
      root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--allow-empty", "-q", "-m", "init",
    );
    expect(commit.status).toBe(0);
    const wt = join(mkdtempSync(join(tmpdir(), "nerf-pc-wt-")), "wt");
    cleanup.push(join(wt, ".."));
    expect(git(root, "worktree", "add", "-q", wt, "-b", "linked").status).toBe(0);

    process.env.NERF_PROJECT_ROOT = wt;
    writeConfig(sid, cfg());

    expect(git(wt, "status", "--porcelain", "-uall").stdout).toBe("");
    // The exclude file is the clone's, shared by every worktree.
    const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf-8");
    expect(exclude.split("\n").filter((l) => l === ".claude/nerf.json")).toHaveLength(1);
    expect(existsSync(join(wt, ".git", "info", "exclude"))).toBe(false);
    writeConfig(sid, cfg({ mode: "not-too-rough" }));
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf-8").split("\n").filter((l) => l === ".claude/nerf.json")).toHaveLength(1);
  });

  test("a project root below the repository top is excluded with its prefix", () => {
    gitInit(root);
    const sub = join(root, "pkg");
    mkdirSync(sub);
    process.env.NERF_PROJECT_ROOT = sub;
    writeConfig(sid, cfg());
    expect(git(root, "status", "--porcelain", "-uall").stdout).toBe("");
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf-8")).toContain("pkg/.claude/nerf.json\n");
  });

  test("a failure to exclude never fails the write", () => {
    gitInit(root);
    // info/exclude as a directory: appending cannot work.
    rmSync(join(root, ".git", "info", "exclude"), { force: true });
    mkdirSync(join(root, ".git", "info", "exclude"), { recursive: true });
    expect(() => writeConfig(sid, cfg())).not.toThrow();
    expect(readJson(projectConfigPath()).darts_pct.ouch).toBe(40);
  });
});

describe("invariant: only the three setters write a config", () => {
  /** Bytes and nanosecond mtime of every config file, or null when absent. */
  function snapshot(): Record<string, { body: string; mtimeNs: bigint } | null> {
    const snap: Record<string, { body: string; mtimeNs: bigint } | null> = {};
    for (const path of [projectConfigPath(), configPath(sid)]) {
      snap[path] = existsSync(path)
        ? { body: readFileSync(path, "utf-8"), mtimeNs: statSync(path, { bigint: true }).mtimeNs }
        : null;
    }
    return snap;
  }

  async function exerciseEveryReader(): Promise<void> {
    process.env.CLAUDE_SESSION_ID = sid;
    try {
      const config = readConfig(sid);
      readConfig("another-session");
      await handleStatus({ session_id: sid });
      await handleMode({ session_id: sid });
      await handleDarts({ session_id: sid });
      await refreshIndicatorCommand(["--session-id", sid]);
      renderWatchFrame(sid, readConfig(sid), { ok: false, reason: "no-reading", detail: "none" });
      await updateStatuslineIndicator(sid, config);
    } finally {
      delete process.env.CLAUDE_SESSION_ID;
    }
  }

  test("reads leave the bytes and mtimes of both files unchanged", async () => {
    put(projectConfigPath(), projectBody, 1_700_000_000);
    put(configPath(sid), legacyBody(), 1_700_000_100);
    const before = snapshot();
    await exerciseEveryReader();
    expect(snapshot()).toEqual(before);
  });

  test("reads create no project file, no .claude/ and no legacy file", async () => {
    await exerciseEveryReader();
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(readdirSync(cfgDir)).toEqual([]);
  });

  test("reads with only a legacy file create no project file", async () => {
    put(configPath(sid), legacyBody());
    await exerciseEveryReader();
    expect(existsSync(projectConfigPath())).toBe(false);
  });

  test("only config.ts and the three setters call writeConfig", () => {
    const repo = join(import.meta.dir, "..");
    const callers = readdirSync(repo)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /\bwriteConfig\s*\(/.test(readFileSync(join(repo, f), "utf-8")))
      .sort();
    expect(callers).toEqual(["budget.ts", "config.ts", "darts.ts", "mode.ts"]);

    // And inside config.ts, only the definition: no reader may call it.
    const own = readFileSync(join(repo, "config.ts"), "utf-8").match(/\bwriteConfig\s*\(/g) ?? [];
    expect(own).toHaveLength(1);
  });
});
