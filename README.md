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

They're stored under `darts_pct` in `/tmp/nerf-<session_id>.json`. A config
from before this change, with absolute token `darts`, is migrated on read: the
token counts are ignored, and the percentage defaults apply.

### CLI subcommands

The same binary runs as a one-shot CLI:

- `nerf-server clear-indicator`
- `nerf-server refresh-indicator [--session-id ID] [--not-before EPOCH]`. A reading written before `EPOCH` counts as unknown. The SessionStart:compact hook passes it, so a pre-compaction figure is never repainted as current.
- `nerf-server watch [--session-id ID] [--interval MS]` (the `nerf_scope` view)

## License

MIT -- see [LICENSE](LICENSE).
