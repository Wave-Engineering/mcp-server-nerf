# Nerf

MCP server for deterministic context budget management in Claude Code. Nerf
tracks how much of the context window a session has used, warns at soft
limits, and triggers doom modes when context budgets are exceeded.

## Prerequisites

- [Claude Code](https://claude.ai/code) CLI (`claude`)
- [Bun](https://bun.sh) (for development)

## Installation

> Installation instructions will be added once the server has tools to offer.

## Development

```bash
git clone https://github.com/Wave-Engineering/mcp-server-nerf.git
cd mcp-server-nerf
bun install
```

### Running Tests

```bash
bun test
```

### Linting

```bash
bun run lint
```

### Full CI Validation

```bash
scripts/ci/validate.sh
```

### Building

```bash
scripts/ci/build.sh bun-linux-x64
scripts/ci/build.sh bun-darwin-arm64
```

## Architecture

Nerf is an MCP server that communicates over stdio transport. It exposes:

| Tool | What it does |
|---|---|
| `nerf_status` | Mode, darts, and the session's current context reading |
| `nerf_mode` | Get or set the doom mode |
| `nerf_darts` | Get or set the soft / hard / ouch darts |
| `nerf_budget` | Set ouch; soft and hard follow at 60% and 75% of it |
| `nerf_scope` | Open a live context monitor (`nerf-server watch`) in a new terminal |

### Where the context reading comes from

Claude Code gives the authoritative, window-aware context figure
(`context_window.remaining_percentage`) only to the statusline.
claudecode-workflow's statusline persists it for each session at:

```
${CLAUDE_CONTEXT_STATE_DIR:-~/.claude/state/context}/<session_id>.json
{ "session_id": "...", "remaining_percentage": 42, "ts": 1760000000 }
```

Nerf reads that file. If the file is missing, unreadable, or more than an hour
old, the reading is reported as **unknown, with the reason**. It shows as
`ctx ?` on the statusline, and is never treated as a healthy reading.

### Darts are percentages

Darts are **percent of the context window used**, as integers from 1 to 99,
with soft < hard < ouch. That makes them correct on a 200k window and on a 1M
one. The defaults are soft 51, hard 63 and ouch 85: `nerf_budget(85)`, with
ouch where claudecode-workflow's reseed gate fires (15% remaining).

They're stored under `darts_pct` in the project's `.claude/nerf.json` (see
[Where the settings are kept](#where-the-settings-are-kept)). A config from
before this change, with absolute token `darts`, is migrated on read: the token
counts are ignored, and the percentage defaults apply.

### Modes

The mode sets what claudecode-workflow's context reseed gate does when the
session reaches the ouch dart:

| Mode | At the ouch dart |
|---|---|
| `ultraviolence` (default) | the agent runs `/reseed` at once |
| `hurt-me-plenty` | the agent asks the user before it reseeds |
| `not-too-rough` | a reminder only, no block |

**These files are a contract with that hook.** The gate reads `mode` and
`darts_pct.ouch` from the config file picked by the rule below, and takes its
threshold as `100 - ouch` percent remaining. Keep the paths, those field names
and the three mode strings stable. A missing or unreadable file means
`ultraviolence` and a 15% threshold to the gate.

### Where the settings are kept

The mode and the darts belong to the project, not to a session. A reseed ends
in `/clear`, which starts a new session id, and `/tmp` is wiped at reboot, so a
per-session file lost them. They now live in

```
<project>/.claude/nerf.json
{ "mode": "hurt-me-plenty", "darts_pct": { "soft": 35, "hard": 37, "ouch": 40 } }
```

beside `agent-identity.json`, and survive a `/clear`, a reseed, a compact, a
restart and a reboot. The project is the same root the identity file is read
from: `NERF_PROJECT_ROOT`, else `git rev-parse --show-toplevel`, else the
working directory. (A session launched in a subdirectory of its repo has the
kit looking at the launch directory and the server at the git root; they agree
for a launch at the root, the normal case.)

**Which file is read.** The same rule as the kit's `nerf_config_file`
(claudecode-workflow, `scripts/lib/context-math.sh`), so `/nerf` and the reseed
gate always agree. Of the project file (a readable regular file) and the legacy
per-session file `${NERF_CONFIG_DIR:-/tmp}/nerf-<session_id>.json`, **the newer
one wins, and a tie goes to the project file**. A malformed file reads as the
defaults, and a missing key falls back to its default on its own. Reading never
writes and never creates a directory.

**When a config is written.** Only on an explicit set: `nerf_mode` with a mode,
`nerf_darts` with all three darts, and `nerf_budget`. Never on a read,
`nerf_status`, a CLI command, an indicator refresh or a session start. That is
what makes "newer" mean "last set".

**Dual write, for now.** Hosts that have not taken a kit with the project-file
reader still read only the legacy per-session file, so each set writes both:
the project file first (atomically, creating `.claude/` if needed), then the
legacy file, so the legacy file is never older and the kit sees the same
content either way. The legacy file keeps its `session_id`; the project file
has none. If one write fails (a read-only checkout, say) it is logged at
`warn` and the set still succeeds through the other; if both fail, the set
fails. A later release drops the legacy write.

**Out of git.** After the project file is written in a git checkout, the line
`.claude/nerf.json` is added once to the clone's `info/exclude` (shared by
linked worktrees), unless git already ignores the file. An untracked file
there would make the kit's `/precheck` refuse to mark a PR ready. This is
best-effort and never fails a set; outside a git checkout nothing is done.

`NERF_CONFIG_DIR` is the kit's own override for the directory of the legacy
files (default `/tmp`); the server honours it, and the test suite points it at
a temp directory so no test touches a live `/tmp/nerf-*.json`.

### CLI subcommands

The same binary runs as a one-shot CLI:

- `nerf-server clear-indicator`
- `nerf-server refresh-indicator [--session-id ID] [--not-before EPOCH]`. A reading written before `EPOCH` counts as unknown. The SessionStart:compact hook passes it, so a pre-compaction figure is never repainted as current.
- `nerf-server watch [--session-id ID] [--interval MS]` (the `nerf_scope` view)

## License

MIT -- see [LICENSE](LICENSE).
