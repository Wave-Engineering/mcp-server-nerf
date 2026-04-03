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

/**
 * Tool schemas for the nerf MCP server.
 *
 * Each tool has a name, description, and inputSchema with typed parameters.
 * Handlers are stubs — actual logic comes in later issues (#220-#223).
 */
export const TOOLS: Tool[] = [
  {
    name: "nerf_status",
    description: "Show current mode, dart thresholds, and context usage",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "nerf_mode",
    description:
      "Get or set the behavior mode (not-too-rough, hurt-me-plenty, ultraviolence)",
    inputSchema: {
      type: "object" as const,
      properties: {
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
  nerf_scope: async () => "not implemented",
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

  if (!handler) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const result = await handler((args ?? {}) as Record<string, unknown>);
  return {
    content: [{ type: "text" as const, text: result }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
