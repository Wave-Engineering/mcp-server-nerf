# Project Instructions for Claude Code

This is **mcp-server-nerf** — an MCP server for deterministic context budget
management in Claude Code.

## Platform

This project is on **GitHub**. Use `gh` CLI for all operations.

## Project Structure

- `index.ts` — MCP server entry point (stdio transport)
- `tools/` — Tool handlers (none yet — scaffold only)
- `tests/` — Bun test suite
- `scripts/ci/` — CI scripts (validate, lint, test, build, release)
- `.github/workflows/` — GitHub Actions (CI on push, release on tag)

## Toolchain

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict mode)
- **Test runner:** `bun test` (built-in)
- **MCP SDK:** `@modelcontextprotocol/sdk`

## Testing

```bash
bun test                    # Run all tests
bun run lint                # TypeScript strict check
scripts/ci/validate.sh      # Full CI validation (lint + test)
```

## Building

```bash
scripts/ci/build.sh bun-linux-x64      # Build for Linux x64
scripts/ci/build.sh bun-darwin-arm64    # Build for macOS ARM
```

## Release

Tag a version to trigger the release workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow runs tests, builds binaries for 4 targets (linux-x64, linux-arm64,
darwin-x64, darwin-arm64), and creates a GitHub Release with all artifacts.

## Commit Convention

```
type(scope): brief description

Closes #NNN
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Mandatory Rules

1. **Always have an issue** — never begin work without one
2. **Test before push** — run `bun test` and `bun run lint`
3. **Pre-commit gate** — run `/precheck` before committing

Dev-Team: mcp-server-nerf
