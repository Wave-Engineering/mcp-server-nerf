/**
 * Unit tests for the Nerf MCP server tool registration.
 *
 * Verifies that the server initializes correctly and returns
 * the registered tool schemas.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "../index.ts";

function createServer(): Server {
  const server = new Server(
    { name: "nerf-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const HANDLERS: Record<
    string,
    (params: Record<string, unknown>) => Promise<string>
  > = {
    nerf_status: async () => "not implemented",
    nerf_mode: async () => "not implemented",
    nerf_darts: async () => "not implemented",
    nerf_budget: async () => "not implemented",
    nerf_scope: async () => "not implemented",
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLERS[name];

    if (!handler) {
      return {
        content: [
          { type: "text" as const, text: `Unknown tool: ${name}` },
        ],
        isError: true,
      };
    }

    const result = await handler((args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: result }],
    };
  });

  return server;
}

describe("nerf server", () => {
  let server: Server;
  let client: Client;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connectPair() {
    server = createServer();
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  test("server starts without error", async () => {
    await connectPair();
    expect(server).toBeDefined();
    expect(client).toBeDefined();
  });

  test("list tools returns 5 tools", async () => {
    await connectPair();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(5);
  });

  test("tool names are correct", async () => {
    await connectPair();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "nerf_budget",
      "nerf_darts",
      "nerf_mode",
      "nerf_scope",
      "nerf_status",
    ]);
  });

  test("calling a registered tool returns not implemented", async () => {
    await connectPair();
    const result = await client.callTool({ name: "nerf_status", arguments: {} });
    expect(result.content).toEqual([
      { type: "text", text: "not implemented" },
    ]);
    expect(result.isError).toBeFalsy();
  });

  test("calling an unknown tool returns error", async () => {
    await connectPair();
    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(result.content).toEqual([
      { type: "text", text: "Unknown tool: nonexistent_tool" },
    ]);
    expect(result.isError).toBe(true);
  });
});
