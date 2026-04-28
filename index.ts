#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { handleStatus } from "./status.ts";
import { handleMode } from "./mode.ts";
import { handleDarts } from "./darts.ts";
import { handleBudget } from "./budget.ts";
import { handleScope } from "./scope.ts";
import { removeIndicator } from "./statusline.ts";
import { NERF_INDICATOR_PREFIX } from "./indicator.ts";
import { isSubcommand, runSubcommand } from "./cli.ts";
import { log } from "./logger.ts";

// Subcommand dispatch — one-shot CLI mode for hook integrations. When argv[2]
// is a known subcommand we run it and exit before any MCP setup happens, so
// the binary doesn't try to read stdin or register signal handlers.
const argv = process.argv.slice(2);
if (argv.length > 0 && isSubcommand(argv[0])) {
  await runSubcommand(argv[0], argv.slice(1));
  process.exit(0);
}

/**
 * Shared optional parameter included in every tool schema.
 */
const SESSION_ID_PROP = {
  session_id: {
    type: "string",
    description: "Claude Code session ID. If omitted, resolved automatically.",
  },
} as const;

/**
 * Tool schemas for the nerf MCP server.
 *
 * Each tool has a name, description, and inputSchema with typed parameters.
 * All tools accept an optional `session_id` for explicit session targeting.
 */
export const TOOLS: Tool[] = [
  {
    name: "nerf_status",
    description: "Show current mode, dart thresholds, and context usage",
    inputSchema: {
      type: "object" as const,
      properties: { ...SESSION_ID_PROP },
    },
  },
  {
    name: "nerf_mode",
    description:
      "Get or set the behavior mode (not-too-rough, hurt-me-plenty, ultraviolence)",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...SESSION_ID_PROP,
        mode: {
          type: "string",
          enum: ["not-too-rough", "hurt-me-plenty", "ultraviolence"],
          description:
            "The mode to set. Omit to return current mode.",
        },
      },
    },
  },
  {
    name: "nerf_darts",
    description: "Get or set individual dart thresholds (soft, hard, ouch)",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...SESSION_ID_PROP,
        soft: {
          type: "number",
          description: "Soft dart threshold (token count)",
        },
        hard: {
          type: "number",
          description: "Hard dart threshold (token count)",
        },
        ouch: {
          type: "number",
          description: "Ouch dart threshold (token count)",
        },
      },
    },
  },
  {
    name: "nerf_budget",
    description:
      "Set the ouch dart with proportional scaling of soft and hard thresholds",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...SESSION_ID_PROP,
        ouch: {
          type: "number",
          description: "The ouch (max) dart threshold to set",
        },
      },
      required: ["ouch"],
    },
  },
  {
    name: "nerf_scope",
    description: "Launch the context monitor to track token usage over time",
    inputSchema: {
      type: "object" as const,
      properties: {
        ...SESSION_ID_PROP,
        interval: {
          type: "number",
          description: "Polling interval in milliseconds (default: 30000)",
        },
      },
    },
  },
];

/**
 * Stub handler map — routes tool name to a handler function.
 * Returns "not implemented" for all tools until later issues add logic.
 */
const HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => Promise<string>
> = {
  nerf_status: async (params) => handleStatus(params),
  nerf_mode: async (params) => handleMode(params),
  nerf_darts: async (params) => handleDarts(params),
  nerf_budget: async (params) => handleBudget(params),
  nerf_scope: async (params) => handleScope(params),
};

const server = new Server(
  { name: "nerf-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  const start = performance.now();

  if (!handler) {
    const ms = Math.round(performance.now() - start);
    log.warn("tool_call", { tool: name, ok: false, ms }, "Unknown tool");
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await handler((args ?? {}) as Record<string, unknown>);
    const ms = Math.round(performance.now() - start);
    log.info("tool_call", { tool: name, ok: true, ms });
    return {
      content: [{ type: "text" as const, text: result }],
    };
  } catch (err: unknown) {
    const ms = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    log.error("tool_call", { tool: name, ok: false, ms, error });
    return {
      content: [{ type: "text" as const, text: `Error: ${error}` }],
      isError: true,
    };
  }
});

// Clean up nerf indicator from statusline on process exit
process.on("SIGTERM", () => {
  log.info("state_change", { what: "shutdown", to: "exiting", reason: "SIGTERM" });
  try { removeIndicator(NERF_INDICATOR_PREFIX); } catch { /* best-effort cleanup */ }
  process.exit(0);
});
process.on("SIGINT", () => {
  log.info("state_change", { what: "shutdown", to: "exiting", reason: "SIGINT" });
  try { removeIndicator(NERF_INDICATOR_PREFIX); } catch { /* best-effort cleanup */ }
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
log.info("startup", { version: "1.0.0", config: { tools: TOOLS.length } });
