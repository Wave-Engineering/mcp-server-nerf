/**
 * Config I/O module for mcp-server-nerf.
 *
 * Manages the nerf configuration (mode and darts). Two files carry it:
 *
 *   - the PROJECT file, `<project>/.claude/nerf.json`, beside
 *     `agent-identity.json`. The settings belong to the project, so they
 *     survive a /clear (a new session id), a reseed, a compact, a restart and
 *     a reboot (#45). Content: `{ mode, darts_pct }`, no `session_id`.
 *   - the LEGACY per-session file, `${NERF_CONFIG_DIR:-/tmp}/nerf-<session_id>.json`
 *     (`configPath`). Hosts that have not taken a kit with the project-file
 *     reader still read only this one, so for now every write goes to both. A
 *     later release drops the legacy write.
 *
 * Which file is read follows claudecode-workflow's `nerf_config_file`
 * (scripts/lib/context-math.sh), so `/nerf` and the reseed gate agree: of the
 * two, the NEWER wins and a tie goes to the project file. Nerf writes a config
 * only on an explicit set (`nerf_mode`, `nerf_darts`, `nerf_budget`), so
 * "newer" means "last set". Nothing else may call `writeConfig`.
 *
 * Known limit: the project is `resolveProjectRoot()` (NERF_PROJECT_ROOT, else
 * the git root, else the cwd). A session launched in a subdirectory of its
 * repo has the kit looking at the launch directory and the server at the git
 * root; they agree in the normal case of a launch at the root.
 *
 * Darts are percentages of the context window USED (#32). They live under
 * `darts_pct`, not `darts`: claudecode-workflow's statusline reads `darts` as
 * absolute token counts, and percentages under that key would paint every
 * session red. A config that still carries the old absolute `darts` is
 * migrated on read: the token counts are ignored and the percentage defaults
 * apply (an absolute count cannot be converted without knowing the window).
 */

import {
  accessSync,
  appendFileSync,
  constants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { log } from "./logger.ts";
import { resolveProjectRoot } from "./statusline.ts";

export interface Darts {
  soft: number;
  hard: number;
  ouch: number;
}

export interface NerfConfig {
  mode: "not-too-rough" | "hurt-me-plenty" | "ultraviolence";
  /** Percent of the context window used, each an integer in 1-99. */
  darts_pct: Darts;
  session_id: string;
}

/** Ratios nerf_budget uses to place soft and hard below ouch. */
export const SOFT_RATIO = 0.6;
export const HARD_RATIO = 0.75;

/**
 * Default darts: nerf_budget's ratios applied to an ouch of 85% used, which is
 * where claudecode-workflow's reseed gate fires (15% remaining).
 */
export const DEFAULTS: NerfConfig = {
  mode: "ultraviolence",
  darts_pct: { soft: 51, hard: 63, ouch: 85 },
  session_id: "",
};

/**
 * What each mode does at the ouch dart. claudecode-workflow's reseed gate reads
 * `mode` and `darts_pct.ouch` from this file (claudecode-workflow#1352), so the mode strings, the
 * field names and the paths are a contract with that hook.
 */
export const MODE_DESCRIPTIONS: Record<NerfConfig["mode"], string> = {
  "not-too-rough": "at the ouch dart, remind only",
  "hurt-me-plenty": "at the ouch dart, ask before reseeding",
  ultraviolence: "reseed automatically at the ouch dart",
};

/** The path of the project file inside the git-ignored `.claude/` directory. */
const PROJECT_FILE_REL = ".claude/nerf.json";

/**
 * Where the legacy per-session files live: NERF_CONFIG_DIR, else /tmp. This is
 * the kit's own override knob (`${NERF_CONFIG_DIR:-/tmp}`), read on every call
 * so tests and the kit agree. An empty value counts as unset, as in bash.
 */
export function legacyConfigDir(): string {
  return process.env.NERF_CONFIG_DIR || "/tmp";
}

/**
 * Returns the LEGACY per-session config file path for a given session ID.
 */
export function configPath(sessionId: string): string {
  return `${legacyConfigDir()}/nerf-${sessionId}.json`;
}

/**
 * Returns the project config file path: `<root>/.claude/nerf.json`. `root`
 * defaults to the resolved project root.
 */
export function projectConfigPath(root: string = resolveProjectRoot()): string {
  return join(root, PROJECT_FILE_REL);
}

/**
 * A session id may become part of a file name only when it is made of
 * [A-Za-z0-9_-], the kit's rule. Anything else (empty, a slash, a dot-dot) is
 * refused for the legacy file; the project file does not need the id.
 */
export function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(sessionId);
}

/** A readable regular file (symlinks followed), as bash's `-f` and `-r`. */
function isReadableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the config file to READ, by the kit's `nerf_config_file` rule: the
 * project file when it is a readable regular file, unless the legacy file
 * exists and is strictly newer (a tie goes to the project file). With no
 * usable project file the legacy path is returned whether or not it exists;
 * with neither (no project file and an unsafe session id) the result is null.
 * Nothing is created or written.
 */
export function selectConfigFile(
  sessionId: string,
  root: string = resolveProjectRoot(),
): string | null {
  const project = projectConfigPath(root);
  const pf = isReadableFile(project) ? project : null;
  const sf = isSafeSessionId(sessionId) ? configPath(sessionId) : null;
  if (pf && sf) {
    try {
      const pm = statSync(project, { bigint: true }).mtimeNs;
      const sm = statSync(sf, { bigint: true }).mtimeNs;
      return sm > pm ? sf : pf;
    } catch {
      // The legacy file is missing or unreadable: not newer.
      return pf;
    }
  }
  return pf ?? sf;
}

/**
 * Reads the config for the given session from the file `selectConfigFile`
 * picks, merging with defaults for any missing keys. Never writes and never
 * creates a directory. A missing, unreadable or malformed file reads as the
 * defaults.
 */
export function readConfig(sessionId: string): NerfConfig {
  const path = selectConfigFile(sessionId);
  if (path === null) return { ...DEFAULTS, session_id: sessionId };
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NerfConfig> & { darts?: unknown };
    if (parsed.darts !== undefined && parsed.darts_pct === undefined) {
      log.info(
        "state_change",
        { what: "darts", from: parsed.darts, to: DEFAULTS.darts_pct },
        "Legacy absolute darts ignored; percentage defaults apply",
      );
    }
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      darts_pct: {
        soft: parsed.darts_pct?.soft ?? DEFAULTS.darts_pct.soft,
        hard: parsed.darts_pct?.hard ?? DEFAULTS.darts_pct.hard,
        ouch: parsed.darts_pct?.ouch ?? DEFAULTS.darts_pct.ouch,
      },
      session_id: parsed.session_id ?? sessionId,
    };
  } catch {
    return { ...DEFAULTS, session_id: sessionId };
  }
}

/**
 * Write `body` to `path` atomically: a temp file in the same directory, then
 * `renameSync`. The rename replaces a symlink at `path` instead of writing
 * through it. A failed write removes its temp file.
 */
function atomicWrite(path: string, body: string): void {
  const tmpPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, body, "utf-8");
    renameSync(tmpPath, path);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

/** Run git in `root`; null when git could not be spawned. */
function git(root: string, args: string[]): { status: number; out: string } | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf-8" });
  if (r.error || r.status === null) return null;
  return { status: r.status, out: (r.stdout ?? "").trim() };
}

/**
 * Keep the project file out of version control: an untracked
 * `.claude/nerf.json` makes the kit's /precheck refuse to mark a PR ready. If
 * `root` is a git checkout where the file is not ignored, append it to the
 * clone's exclude file (`info/exclude`, shared by linked worktrees), once.
 * Best-effort: any failure is logged at warn and never fails the write. Not a
 * git checkout: nothing happens.
 */
function excludeFromGit(root: string): void {
  try {
    const ignored = git(root, ["check-ignore", "-q", PROJECT_FILE_REL]);
    if (ignored === null) {
      log.warn("config_write", { cause: "git_unavailable", root }, "Could not run git to exclude .claude/nerf.json");
      return;
    }
    // 0: already ignored. 128: not a git checkout. Either way, nothing to do.
    if (ignored.status !== 1) return;

    const excludePath = git(root, ["rev-parse", "--git-path", "info/exclude"]);
    if (excludePath === null || excludePath.status !== 0 || !excludePath.out) {
      log.warn("config_write", { cause: "git_exclude_path", root }, "Could not resolve info/exclude");
      return;
    }
    const file = isAbsolute(excludePath.out) ? excludePath.out : resolve(root, excludePath.out);

    // The exclude pattern is anchored at the repository top; a project root
    // below it (a subdirectory) needs its prefix. At the top the prefix is
    // empty and the line is exactly `.claude/nerf.json`.
    const prefix = git(root, ["rev-parse", "--show-prefix"]);
    const line = `${prefix && prefix.status === 0 ? prefix.out : ""}${PROJECT_FILE_REL}`;

    let existing = "";
    try {
      existing = readFileSync(file, "utf-8");
    } catch {
      mkdirSync(dirname(file), { recursive: true });
    }
    if (existing.split("\n").some((l) => l.trim() === line)) return;
    const lead = existing === "" || existing.endsWith("\n") ? "" : "\n";
    appendFileSync(file, `${lead}${line}\n`, "utf-8");
  } catch (err) {
    log.warn("config_write", { cause: "git_exclude", err: String(err) }, "Could not exclude .claude/nerf.json from git");
  }
}

/**
 * Writes the config, atomically, to both files. Call it only for an explicit
 * set (the three setters): the kit reads "newer wins" as "last set".
 *
 *  1. The project file (`.claude/` is created if absent). It goes first so the
 *     legacy file is newer or equal: a kit that reads the legacy file then sees
 *     the same content.
 *  2. The legacy per-session file, as before. Skipped for an unsafe session id.
 *  3. A failure of one is logged at warn and the call succeeds; both failing
 *     throws.
 *  4. After step 1 succeeds, the project file is kept out of git.
 *
 * Only the current schema is written, so a legacy `darts` key is dropped on
 * the first write. The project file carries no `session_id`.
 */
export function writeConfig(sessionId: string, config: NerfConfig): void {
  const root = resolveProjectRoot();
  const projectPath = projectConfigPath(root);
  const darts_pct = config.darts_pct;

  let projectOk = false;
  try {
    mkdirSync(dirname(projectPath), { recursive: true });
    atomicWrite(projectPath, JSON.stringify({ mode: config.mode, darts_pct }, null, 2) + "\n");
    projectOk = true;
  } catch (err) {
    log.warn("config_write", { cause: "project_file", path: projectPath, err: String(err) }, "Could not write the project nerf.json; continuing with the per-session file");
  }

  let legacyError: unknown = null;
  let legacyOk = false;
  if (isSafeSessionId(sessionId)) {
    const legacyPath = configPath(sessionId);
    try {
      atomicWrite(
        legacyPath,
        JSON.stringify({ mode: config.mode, darts_pct, session_id: config.session_id }, null, 2) + "\n",
      );
      legacyOk = true;
    } catch (err) {
      legacyError = err;
      if (projectOk) {
        log.warn("config_write", { cause: "legacy_file", path: legacyPath, err: String(err) }, "Could not write the per-session nerf file; the project file was written");
      }
    }
  } else {
    legacyError = new Error(`unsafe session id, the per-session file is not written: ${JSON.stringify(sessionId)}`);
    if (projectOk) {
      log.warn("config_write", { cause: "unsafe_session_id", session_id: sessionId }, "Per-session nerf file skipped for an unsafe session id; the project file was written");
    }
  }

  if (!projectOk && !legacyOk) throw legacyError;
  if (projectOk) excludeFromGit(root);
}
