# Nerf

MCP server for deterministic context budget management in Claude Code. Nerf
tracks token consumption, enforces soft limits, and triggers doom modes when
context budgets are exceeded.

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

Nerf is an MCP server that communicates over stdio transport. It will expose
tools for:

- Budget declaration and tracking
- Soft-limit enforcement with warnings
- Doom mode activation when budgets are exceeded
- Scope monitoring and reporting

## License

MIT -- see [LICENSE](LICENSE).
